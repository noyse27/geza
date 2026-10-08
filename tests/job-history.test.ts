import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { query, pool } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';
import { runContext, mediaSnapshot, changeOutcome, reportProgress } from '../src/lib/job-history';
import { jobState, relativeTime } from '../src/lib/job-display';
import { jobOverview } from '../src/lib/job-overview';
import { processPlexScan } from '../src/lib/plex-scan';
import { processPlexReviewSync } from '../src/lib/plex';
import { scheduleNextScan } from '../src/lib/plex-jobs';

after(() => pool.end());
test('job history: committed scan results, rollback, retry, review deltas and live worker', async () => {
  assert.match(process.env.DATABASE_URL || '', /geza_test_jobs_/);
  await setSetting('PLEX_URL', 'http://plex.test');
  await setSetting('PLEX_TOKEN', 'test');
  await setSetting('PLEX_SCAN_WATCHED_ONLY', '1');
  const [job] = await query(
    "INSERT INTO jobs(kind,dedupe_key,status) VALUES('plex-scan','history-test','running') RETURNING *",
  );
  assert.ok(job.queued_at);
  const run = async () =>
    (
      await query("INSERT INTO job_runs(job_id,kind,attempt) VALUES($1,'plex-scan',1) RETURNING *", [job.id])
    )[0];
  const originalFetch = globalThis.fetch;
  let conflict = false,
    body = 'Ein Testreview';
  globalThis.fetch = (async (input) => {
    const u = new URL(String(input));
    if (u.hostname === 'community.plex.tv')
      return Response.json({ data: { metadataReviewV2: { message: body, hasSpoilers: false } } });
    if (u.pathname === '/library/sections')
      return Response.json({ MediaContainer: { Directory: [{ key: '1', title: '#NEU', type: 'movie' }] } });
    const movies = [
      { type: 'movie', title: 'Dick und Jane', ratingKey: '123', Guid: [{ id: 'tmdb://9591' }] },
    ];
    if (conflict)
      movies.push({
        type: 'movie',
        title: 'Konfliktfilm',
        ratingKey: '124',
        Guid: [{ id: 'tmdb://222' }, { id: 'imdb://tt111' }],
      });
    return Response.json({ MediaContainer: { totalSize: movies.length, Metadata: movies } });
  }) as typeof fetch;
  try {
    const first = await run();
    await runContext.run({ id: first.id, lastProgress: 0 }, () => processPlexScan({ manual: true }));
    const [result] = await query('SELECT * FROM job_results WHERE run_id=$1', [first.id]);
    assert.equal(result.title, 'Dick und Jane');
    assert.equal(result.outcome, 'new');
    assert.equal(result.destination, 'Bucketliste');
    assert.ok((await query('SELECT progress_at FROM job_runs WHERE id=$1', [first.id]))[0].progress_at);
    await query("UPDATE job_runs SET status='done',finished_at=now() WHERE id=$1", [first.id]);
    const second = await run();
    await runContext.run({ id: second.id, lastProgress: 0 }, () => processPlexScan({ manual: true }));
    assert.equal(
      (await query('SELECT outcome FROM job_results WHERE run_id=$1', [second.id]))[0].outcome,
      'unchanged',
    );
    await query("UPDATE job_runs SET status='done',finished_at=now() WHERE id=$1", [second.id]);
    await query(
      'INSERT INTO media(kind,title,ids) VALUES(\'movie\',\'A\',\'{"tmdb":"222","imdb":"tt333"}\'),(\'movie\',\'B\',\'{"imdb":"tt111","tmdb":"444"}\')',
    );
    // The first title changes classification before a later conflict rolls everything back.
    await query("UPDATE media SET bucket_preference='exclude' WHERE id=$1", [result.media_id]);
    const before = (
      await query('SELECT ids,bucketlist,plex_checked_at FROM media WHERE id=$1', [result.media_id])
    )[0];
    conflict = true;
    const failed = await run();
    await assert.rejects(
      runContext.run({ id: failed.id, lastProgress: 0 }, () => processPlexScan({ manual: true })),
      /Mehrdeutige Provider/,
    );
    assert.equal((await query('SELECT * FROM job_results WHERE run_id=$1', [failed.id])).length, 0);
    assert.deepEqual(
      (await query('SELECT ids,bucketlist,plex_checked_at FROM media WHERE id=$1', [result.media_id]))[0],
      before,
    );
    await query("UPDATE job_runs SET status='failed',finished_at=now(),error='Konflikt' WHERE id=$1", [
      failed.id,
    ]);
    await scheduleNextScan(job.id);
    const [scheduled] = await query('SELECT * FROM jobs WHERE id=$1', [job.id]);
    assert.equal(jobState(scheduled), 'Geplant');
    assert.equal((await query('SELECT status FROM job_runs WHERE id=$1', [first.id]))[0].status, 'done');
    await query('UPDATE media SET ids=ids||\'{"plex":"0123456789abcdef01234567"}\'::jsonb WHERE id=$1', [
      result.media_id,
    ]);
    const beforeReview = await mediaSnapshot(result.media_id, 'plex-review-sync');
    await processPlexReviewSync({ mediaId: result.media_id });
    const review = await mediaSnapshot(result.media_id, 'plex-review-sync');
    assert.equal(changeOutcome(beforeReview, review), 'new');
    await processPlexReviewSync({ mediaId: result.media_id });
    assert.equal(
      changeOutcome(review, await mediaSnapshot(result.media_id, 'plex-review-sync')),
      'unchanged',
    );
    body = '';
    await processPlexReviewSync({ mediaId: result.media_id });
    assert.equal(changeOutcome(review, await mediaSnapshot(result.media_id, 'plex-review-sync')), 'removed');
    assert.equal(
      jobState({ status: 'running', heartbeat_at: new Date(Date.now() - 120000) }),
      'Keine aktuelle Rückmeldung',
    );
    assert.match(relativeTime(new Date(Date.now() - 3 * 86400000)), /3 Tagen/);
    await runContext.run({ id: failed.id, lastProgress: 0 }, () =>
      reportProgress('Darf nicht überschreiben', 1, 1, true),
    );
    assert.notEqual(
      (await query('SELECT phase FROM job_runs WHERE id=$1', [failed.id]))[0].phase,
      'Darf nicht überschreiben',
    );
    assert.ok((await jobOverview()).today.some((x) => x.outcome === 'new' && x.count === 1));
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Exercise the actual claim/finish/retry path in the worker without external requests.
  await query("UPDATE jobs SET status='done' WHERE status IN ('pending','running')");
  await setSetting('TMDB_TOKEN', '');
  await setSetting('TVDB_API_KEY', '');
  await setSetting('PLEX_URL', '');
  await setSetting('PLEX_TOKEN', '');
  await query("INSERT INTO admin_account(id,username,password_hash) VALUES(1,'test','unused')");
  const [bad] = await query("INSERT INTO jobs(kind,attempts) VALUES('invalid-test-job',2) RETURNING id");
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/worker.ts'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  worker.stdout.on('data', (x) => (output += x));
  worker.stderr.on('data', (x) => (output += x));
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const [row] = await query('SELECT status FROM jobs WHERE id=$1', [bad.id]);
      if (row.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const [row] = await query(
      'SELECT j.status,j.active_run_id,r.status AS run_status,r.attempt,r.finished_at FROM jobs j JOIN job_runs r ON r.id=j.active_run_id WHERE j.id=$1',
      [bad.id],
    );
    assert.ok(row, output);
    assert.equal(row.status, 'failed', output);
    assert.equal(row.run_status, 'failed');
    assert.equal(row.attempt, 3);
    assert.ok(row.finished_at);
  } finally {
    const exited = once(worker, 'exit');
    worker.kill();
    await exited;
  }
});

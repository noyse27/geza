import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { query, pool } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';
import {
  runContext,
  mediaSnapshot,
  changeOutcome,
  reportProgress,
  saveJobResults,
} from '../src/lib/job-history';
import { jobState, relativeTime } from '../src/lib/job-display';
import { jobOverview } from '../src/lib/job-overview';
import { processPlexScan } from '../src/lib/plex-scan';
import { ensurePlexMedia, plexIds, processPlex, processPlexReviewSync } from '../src/lib/plex';
import { plexServerScope } from '../src/lib/plex-decisions';
import { scheduleNextScan } from '../src/lib/plex-jobs';
import pg from 'pg';

after(() => pool.end());
test('batched results preserve ordering, redaction and transaction rollback across chunks', async () => {
  const [job] = await query("INSERT INTO jobs(kind) VALUES('plex-scan') RETURNING id");
  const [run] = await query(
    "INSERT INTO job_runs(job_id,kind,attempt) VALUES($1,'plex-scan',1) RETURNING id",
    [job.id],
  );
  const results = Array.from({ length: 205 }, (_, i) => ({
    title: `Result ${i}`,
    outcome: 'unchanged',
    details: { token: 'must-not-leak' },
  }));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await runContext.run({ id: run.id, lastProgress: 0 }, () => saveJobResults(results, client));
    await client.query('ROLLBACK');
    assert.equal((await query('SELECT 1 FROM job_results WHERE run_id=$1', [run.id])).length, 0);
    await client.query('BEGIN');
    await runContext.run({ id: run.id, lastProgress: 0 }, () => saveJobResults(results, client));
    await client.query('COMMIT');
    const saved = await query('SELECT title,details FROM job_results WHERE run_id=$1 ORDER BY id', [run.id]);
    assert.deepEqual(
      saved.map((r) => r.title),
      results.map((r) => r.title),
    );
    assert.ok(!JSON.stringify(saved).includes('must-not-leak'));
  } finally {
    client.release();
  }
});
test('scan query budget for 40 unchanged films', async () => {
  await setSetting('PLEX_URL', 'http://plex.test');
  await setSetting('PLEX_TOKEN', 'test');
  const films = Array.from({ length: 40 }, (_, i) => ({
    type: 'movie',
    title: `Budget ${i}`,
    ratingKey: String(70000 + i),
    guid: `plex://movie/${String(70000 + i).padStart(24, '0')}`,
    Guid: [{ id: `tmdb://${70000 + i}` }],
    Country: [{ tag: 'USA' }],
    Genre: [{ tag: 'Drama' }],
  }));
  const originalFetch = globalThis.fetch;
  const originalQuery = pg.Client.prototype.query;
  let count = 0;
  globalThis.fetch = (async (input) =>
    Response.json({
      MediaContainer:
        new URL(String(input)).pathname === '/library/sections'
          ? { Directory: [{ key: '1', title: 'Budget', type: 'movie' }] }
          : { totalSize: films.length, Metadata: films },
    })) as typeof fetch;
  try {
    await processPlexScan({ manual: true });
    const before = await query("SELECT id,updated_at FROM media WHERE title LIKE 'Budget %' ORDER BY id");
    const [job] = await query("INSERT INTO jobs(kind) VALUES('plex-scan') RETURNING id");
    const [run] = await query(
      "INSERT INTO job_runs(job_id,kind,attempt) VALUES($1,'plex-scan',1) RETURNING id",
      [job.id],
    );
    pg.Client.prototype.query = function (this: pg.Client, ...args: any[]) {
      count++;
      return (originalQuery as any).apply(this, args);
    } as typeof originalQuery;
    await runContext.run({ id: run.id, lastProgress: 0 }, () => processPlexScan({ manual: true }));
    pg.Client.prototype.query = originalQuery;
    const results = await query('SELECT outcome FROM job_results WHERE run_id=$1', [run.id]);
    assert.equal(results.length, 40);
    assert.ok(results.every((r) => r.outcome === 'unchanged'));
    assert.deepEqual(
      await query("SELECT id,updated_at FROM media WHERE title LIKE 'Budget %' ORDER BY id"),
      before,
      'unchanged metadata retains its modification timestamp',
    );
    console.log(`SYNC_QUERY_BUDGET: ${count} database calls for 40 unchanged films including results`);
    assert.ok(count < 400, `query budget regressed: ${count}`);
    await query("INSERT INTO facet_aliases(category,alias,canonical) VALUES('country','USA','Testland')");
    await processPlexScan({ manual: true });
    assert.ok(
      (await query("SELECT countries FROM media WHERE title LIKE 'Budget %'")).every((r) =>
        r.countries.includes('Testland'),
      ),
      'next scan loads new facet rules rather than reusing stale projections',
    );
  } finally {
    pg.Client.prototype.query = originalQuery;
    globalThis.fetch = originalFetch;
    await query(
      "DELETE FROM facet_aliases WHERE category='country' AND alias='USA' AND canonical='Testland'",
    );
    await query("DELETE FROM media WHERE title LIKE 'Budget %'");
  }
});
test('selected library sync: details fallback, missing IDs, preview and unselected evidence', async () => {
  await setSetting('PLEX_URL', 'http://plex.test');
  await setSetting('PLEX_TOKEN', 'test');
  await setSetting('PLEX_SCAN_SECTIONS', '1');
  await setSetting('PLEX_SCAN_WATCHED_ONLY', '1');
  await query(`INSERT INTO media(kind,title,ids,plex_libraries,plex_checked_at,plex_automatic,origins) VALUES
    ('movie','Sync outside','{"tmdb":"811"}',ARRAY['Andere'],now()-interval '1 day',true,ARRAY['plex']),
    ('movie','Sync old','{"tmdb":"812"}',ARRAY['#NEU'],now()-interval '1 day',true,ARRAY['plex'])`);
  await query("UPDATE media SET plex_watched=false WHERE title LIKE 'Sync %'");
  const before = await query(
    "SELECT id,title,plex_libraries,plex_checked_at,bucketlist,plex_automatic FROM media WHERE title LIKE 'Sync %' ORDER BY id",
  );
  const original = globalThis.fetch;
  let missing = true;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes('/sections/2/')) throw Error('UNSELECTED LIBRARY MUST NOT BE READ');
    if (path === '/library/sections')
      return Response.json({
        MediaContainer: {
          Directory: [
            { key: '1', title: '#NEU', type: 'movie' },
            { key: '2', title: 'Andere', type: 'movie' },
          ],
        },
      });
    if (path === '/library/metadata/82')
      return Response.json({
        MediaContainer: {
          Metadata: [
            { ratingKey: '82', type: 'movie', title: 'Sync hydrated', Guid: [{ id: 'tmdb://822' }] },
          ],
        },
      });
    if (path === '/library/metadata/83') return new Response('{}', { status: 404 });
    const entries = [
      { ratingKey: '81', type: 'movie', title: 'Sync good', Guid: [{ id: 'tmdb://821' }] },
      { ratingKey: '82', type: 'movie', title: 'Sync hydrated' },
      ...(missing ? [{ ratingKey: '83', type: 'movie', title: 'Sync no ID', guid: 'local://unknown' }] : []),
    ];
    return Response.json({ MediaContainer: { totalSize: entries.length, Metadata: entries } });
  }) as typeof fetch;
  try {
    const preview = await processPlexScan({ manual: true, preview: true });
    assert.deepEqual(preview?.scannedLibraries, ['#NEU']);
    assert.equal(preview?.conflicts, 1);
    assert.equal(preview?.issues[0].title, 'Sync no ID');
    assert.deepEqual(
      await query(
        "SELECT id,title,plex_libraries,plex_checked_at,bucketlist,plex_automatic FROM media WHERE title LIKE 'Sync %' ORDER BY id",
      ),
      before,
    );
    await processPlexScan({ manual: true });
    const fresh = await query(
      "SELECT bucketlist,plex_checked_at FROM media WHERE title IN ('Sync good','Sync hydrated')",
    );
    assert.equal(fresh.length, 2);
    assert.ok(fresh.every((r) => r.bucketlist && r.plex_checked_at));
    assert.deepEqual(
      await query(
        "SELECT id,title,plex_libraries,plex_checked_at,bucketlist,plex_automatic FROM media WHERE title IN ('Sync outside','Sync old') ORDER BY id",
      ),
      before,
      'unselected library and uncertain absence evidence are preserved',
    );
    missing = false;
    await processPlexScan({ manual: true });
    assert.equal((await query("SELECT bucketlist FROM media WHERE title='Sync old'"))[0].bucketlist, false);
    assert.equal(
      (await query("SELECT bucketlist FROM media WHERE title='Sync outside'"))[0].bucketlist,
      true,
    );
    assert.deepEqual(plexIds({ guid: 'com.plexapp.agents.imdb://tt12345?lang=de' }), { imdb: 'tt12345' });
    assert.deepEqual(plexIds({ guid: 'tv.plex.agents.nfo.movie://movie/imdb_tt12345' }), { imdb: 'tt12345' });
    await setSetting('PLEX_RESTORE_WATCHED', '0');
    await query("DELETE FROM jobs WHERE dedupe_key IN ('plex-scan-manual','plex-scan-followup')");
    const newEvent = {
      event: 'library.new',
      eventId: 'new-sync-test',
      receivedAt: new Date().toISOString(),
      metadata: { librarySectionID: '2' },
    };
    await processPlex(newEvent);
    assert.equal((await query("SELECT 1 FROM jobs WHERE dedupe_key='plex-scan-manual'")).length, 0);
    await processPlex({ ...newEvent, metadata: { librarySectionID: '1' } });
    assert.equal(
      (await query("SELECT 1 FROM jobs WHERE dedupe_key='plex-scan-manual' AND status='pending'")).length,
      1,
      'library.new queues a selected-library scan even when watched restoration is off',
    );
    await setSetting('PLEX_SCAN_SECTIONS', 'none');
    await assert.rejects(processPlexScan({ manual: true }), /Keine ausgewählte/);
  } finally {
    globalThis.fetch = original;
    await setSetting('PLEX_SCAN_SECTIONS', '');
    await query("DELETE FROM media WHERE title LIKE 'Sync %'");
  }
});
test('episode conflict rolls back its series only and protects the existing family', async () => {
  await setSetting('PLEX_URL', 'http://plex.test');
  await setSetting('PLEX_TOKEN', 'test');
  const [show] = await query(`INSERT INTO media(kind,title,ids,plex_libraries,plex_automatic,origins)
    VALUES('show','Serie unverändert','{"tvdb":"901111"}',ARRAY['Alt'],true,ARRAY['plex']) RETURNING id`);
  await query(
    `INSERT INTO media(kind,title,parent_id,season,episode,ids) VALUES('episode','Konfliktfolge',$1,1,2,'{"tmdb":"901222","imdb":"tt901333"}')`,
    [show.id],
  );
  const before = await query(
    'SELECT id,title,ids,plex_libraries,bucketlist,rumpel FROM media WHERE id=$1 OR parent_id=$1 ORDER BY id',
    [show.id],
  );
  const original = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    const data =
      path === '/library/sections'
        ? { Directory: [{ key: '1', title: 'Test', type: 'show' }] }
        : path.includes('allLeaves')
          ? {
              totalSize: 2,
              Metadata: [
                { type: 'episode', title: 'Neue Folge', parentIndex: 1, index: 1 },
                {
                  type: 'episode',
                  title: 'Konfliktfolge',
                  parentIndex: 1,
                  index: 2,
                  Guid: [{ id: 'tmdb://901222' }, { id: 'imdb://tt901444' }],
                },
              ],
            }
          : {
              totalSize: 2,
              Metadata: [
                {
                  type: 'show',
                  title: 'Nicht übernehmen',
                  ratingKey: '901',
                  Guid: [{ id: 'tvdb://901111' }],
                },
                {
                  type: 'movie',
                  title: 'Nach Serienkonflikt',
                  ratingKey: '902',
                  Guid: [{ id: 'tmdb://901555' }],
                },
              ],
            };
    return Response.json({ MediaContainer: data });
  }) as typeof fetch;
  try {
    const report = await processPlexScan({ manual: true });
    assert.equal(report?.conflicts, 1);
    assert.deepEqual(
      await query(
        'SELECT id,title,ids,plex_libraries,bucketlist,rumpel FROM media WHERE id=$1 OR parent_id=$1 ORDER BY id',
        [show.id],
      ),
      before,
    );
    assert.equal(
      (await query("SELECT bucketlist FROM media WHERE title='Nach Serienkonflikt'"))[0].bucketlist,
      true,
    );
    assert.equal(
      (
        await query("SELECT 1 FROM media WHERE title='Neue Folge' OR (kind='season' AND parent_id=$1)", [
          show.id,
        ])
      ).length,
      0,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('job history: isolated conflicts, persistent decisions, retry, review deltas and live worker', async () => {
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
    const movies: Array<{
      type: string;
      title: string;
      ratingKey: string;
      guid?: string;
      Guid: { id: string }[];
    }> = [{ type: 'movie', title: 'Dick und Jane', ratingKey: '123', Guid: [{ id: 'tmdb://9591' }] }];
    if (conflict) {
      movies.push({
        type: 'movie',
        title: 'Konfliktfilm',
        ratingKey: '124',
        guid: 'plex://movie/111111111111111111111111',
        Guid: [{ id: 'tmdb://222' }, { id: 'imdb://tt111' }],
      });
      movies.push({
        type: 'movie',
        title: 'Neu trotz Konflikt',
        ratingKey: '125',
        Guid: [{ id: 'tmdb://999333' }],
      });
    }
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
    // A later conflict must not discard valid titles or alter the conflicting candidates.
    await query("UPDATE media SET bucket_preference='exclude' WHERE id=$1", [result.media_id]);
    const candidatesBefore = await query(
      "SELECT id,ids,bucketlist,rumpel,plex_checked_at FROM media WHERE title IN ('A','B') ORDER BY id",
    );
    conflict = true;
    const failed = await run();
    const partial = await runContext.run({ id: failed.id, lastProgress: 0 }, () =>
      processPlexScan({ manual: true }),
    );
    assert.equal(partial?.conflicts, 1);
    assert.equal(
      (await query("SELECT * FROM job_results WHERE run_id=$1 AND outcome='failed'", [failed.id])).length,
      1,
    );
    assert.equal((await query('SELECT * FROM job_results WHERE run_id=$1', [failed.id])).length, 3);
    assert.equal(
      (await query("SELECT bucketlist FROM media WHERE title='Neu trotz Konflikt'"))[0].bucketlist,
      true,
      'new unwatched title after a conflict reaches the bucketlist',
    );
    assert.deepEqual(
      await query(
        "SELECT id,ids,bucketlist,rumpel,plex_checked_at FROM media WHERE title IN ('A','B') ORDER BY id",
      ),
      candidatesBefore,
    );
    const candidate = candidatesBefore[1];
    const source = {
      type: 'movie',
      title: 'Konfliktfilm',
      ratingKey: '124',
      guid: 'plex://movie/111111111111111111111111',
      Guid: [{ id: 'tmdb://222' }, { id: 'imdb://tt111' }],
    };
    await query(
      'INSERT INTO plex_match_decisions(server_id,rating_key,guid,media_id,provider_ids) VALUES($1,$2,$3,$4,$5)',
      [
        await plexServerScope(),
        source.ratingKey,
        source.guid,
        candidate.id,
        JSON.stringify({ tmdb: '222', imdb: 'tt111' }),
      ],
    );
    assert.equal(await ensurePlexMedia(source), candidate.id);
    assert.equal(await ensurePlexMedia(source), candidate.id, 'choice survives repeated imports');
    const resolvedRun = await run();
    const resolved = await runContext.run({ id: resolvedRun.id, lastProgress: 0 }, () =>
      processPlexScan({ manual: true }),
    );
    assert.equal(resolved?.conflicts, 0, 'next full scan remembers the choice');
    assert.equal(
      (await query('SELECT bucketlist FROM media WHERE id=$1', [candidate.id]))[0].bucketlist,
      true,
    );
    assert.equal(
      (
        await query("SELECT count(*)::int AS n FROM job_results WHERE run_id=$1 AND outcome='failed'", [
          resolvedRun.id,
        ])
      )[0].n,
      0,
    );
    assert.equal(
      await ensurePlexMedia({ ...source, Guid: [...source.Guid, { id: 'tmdb://444' }] }),
      candidate.id,
      'explicit choice also resolves duplicate TMDB GUIDs',
    );
    assert.deepEqual(
      (await query('SELECT ids FROM media WHERE id=$1', [candidate.id]))[0].ids,
      candidate.ids,
      'Plex must not overwrite chosen canonical IDs',
    );
    await assert.rejects(
      ensurePlexMedia({ ...source, guid: 'plex://movie/222222222222222222222222' }),
      /Mehrdeutige/,
    );
    await setSetting('PLEX_SERVER_ID', 'another-server');
    await assert.rejects(ensurePlexMedia(source), /Mehrdeutige/);
    await setSetting('PLEX_SERVER_ID', '');
    await query('DELETE FROM plex_match_decisions');
    await assert.rejects(
      ensurePlexMedia({
        ...source,
        ratingKey: '555',
        guid: 'plex://movie/333333333333333333333333',
        Guid: [{ id: 'tmdb://444' }, { id: 'tmdb://222' }],
      }),
      /Mehrdeutige/,
      'duplicate provider IDs must not silently select the last GUID',
    );
    await assert.rejects(
      ensurePlexMedia(source),
      /Mehrdeutige/,
      'removing a choice restores normal matching',
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

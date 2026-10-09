import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, pool } from '../src/lib/db';
import { setSetting } from '../src/lib/settings';
import { processPlexScan, plexList } from '../src/lib/plex-scan';
import { importTrakt } from '../src/lib/importer';
import { getBucketlist } from '../src/lib/catalog';
import { requestPlexScan, scheduleNextScan, nextPlexRun } from '../src/lib/plex-jobs';
import { selectPlexMatch, processPlex } from '../src/lib/plex';
import { processPlexRestore, plexWatched } from '../src/lib/plex-watch-restore';
import { POST as plexWebhook } from '../src/app/api/plex/[secret]/route';

after(() => pool.end());
test('classification: seasons, provenance, preview, retries, disappearance and import order', async () => {
  // Run in an isolated migrated database, never a personal installation.
  assert.match(process.env.DATABASE_URL || '', /geza_test/);
  process.env.SESSION_SECRET = 'classification-test-secret-with-at-least-32-characters';
  const legacy = await query(
    "SELECT title,bucketlist,bucket_preference,origins FROM media WHERE title LIKE 'Legacy %' ORDER BY title",
  );
  assert.equal(legacy.length, 2);
  assert.equal(legacy[0].bucketlist, true);
  assert.ok(legacy[0].origins.includes('legacy-bucket'));
  assert.equal(legacy[1].bucket_preference, 'include');
  await setSetting('PLEX_URL', 'http://plex.test:32400');
  await setSetting('PLEX_TOKEN', 'test');
  const originalFetch = globalThis.fetch;
  let watched = false,
    missing = false,
    broken = false,
    incomplete = false;
  const movie = { type: 'movie', title: 'Plex Film', Guid: [{ id: 'tmdb://991001' }] };
  const show = { type: 'show', title: 'Plex Serie', ratingKey: 'show1', Guid: [{ id: 'tvdb://991002' }] };
  globalThis.fetch = (async (input) => {
    const u = new URL(String(input));
    let value: unknown;
    if (broken) return new Response('{}', { status: 500 });
    if (u.pathname === '/library/sections')
      value = {
        Directory: [
          { key: '1', title: 'Filme', type: 'movie' },
          { key: '2', title: 'Serien', type: 'show' },
        ],
      };
    else if (u.pathname === '/library/sections/1/all')
      value = { Metadata: missing ? [] : [movie], totalSize: missing ? 0 : 1 };
    else if (u.pathname === '/library/sections/2/all') value = { Metadata: [show], totalSize: 1 };
    else if (u.pathname === '/library/metadata/show1/allLeaves')
      value = {
        Metadata: [
          { type: 'episode', title: 'E1', parentIndex: 1, index: 1, viewCount: watched ? 1 : 0 },
          { type: 'episode', title: 'E2', parentIndex: incomplete ? null : 2, index: 1, viewCount: 0 },
        ],
        totalSize: 2,
      };
    else if (u.pathname === '/bad-page') value = { Metadata: [], totalSize: 3 };
    else return new Response('{}', { status: 404 });
    return Response.json({ MediaContainer: value });
  }) as typeof fetch;
  const state = async (id: string) => (await query('SELECT * FROM media WHERE id=$1', [id]))[0];
  const dir = await mkdtemp(join(tmpdir(), 'geza-classification-'));
  try {
    await writeFile(
      join(dir, 'collection-movies.json'),
      JSON.stringify([
        { movie: { title: 'Plex Film', ids: { trakt: 991001, tmdb: 991001 } } },
        { movie: { title: 'Collection Rest', ids: { trakt: 991003, tmdb: 991003 } } },
      ]),
    );
    await writeFile(
      join(dir, 'watchlist.json'),
      JSON.stringify([{ type: 'movie', movie: { title: 'Wunsch', ids: { trakt: 991004 } } }]),
    );
    await writeFile(
      join(dir, 'watched-movies-test.json'),
      JSON.stringify([{ movie: { title: 'Gesehen', ids: { trakt: 991005 } }, plays: 1 }]),
    );
    await writeFile(
      join(dir, 'collection-shows.json'),
      JSON.stringify([
        {
          show: { title: 'Plex Serie', ids: { trakt: 991002, tvdb: 991002 } },
          seasons: [
            { number: 1, episodes: [{ number: 1 }] },
            { number: 2, episodes: [{ number: 1 }] },
          ],
        },
      ]),
    );
    await writeFile(
      join(dir, 'ratings-seasons.json'),
      JSON.stringify([
        {
          type: 'season',
          show: { title: 'Plex Serie', ids: { trakt: 991002, tvdb: 991002 } },
          season: { number: 1, ids: { trakt: 991006 } },
          rating: 7,
          rated_at: '2026-01-01T00:00:00Z',
        },
      ]),
    );
    await importTrakt(dir);
    const [film] = await query('SELECT * FROM media WHERE trakt_id=991001');
    assert.equal(film.rumpel, true);
    assert.equal((await query('SELECT bucketlist FROM media WHERE trakt_id=991004'))[0].bucketlist, true);
    assert.equal((await query('SELECT rumpel FROM media WHERE trakt_id=991005'))[0].rumpel, false);
    const preview = await processPlexScan({ manual: true, preview: true });
    assert.ok(preview!.changed > 0);
    assert.equal((await state(film.id)).rumpel, true, 'preview rolls back');
    assert.equal(
      (await query("SELECT 1 FROM media WHERE kind='season'")).length,
      2,
      'numeric season matches later Trakt season identity',
    );
    await processPlexScan({ manual: true });
    assert.equal((await state(film.id)).bucketlist, true);
    assert.equal((await query('SELECT rumpel FROM media WHERE trakt_id=991003'))[0].rumpel, true);
    const [series] = await query("SELECT * FROM media WHERE kind='show'");
    assert.equal(series.bucketlist, true);
    assert.equal((await query("SELECT 1 FROM media WHERE kind='season' AND bucketlist")).length, 0);
    watched = true;
    await processPlexScan({ manual: true });
    assert.equal((await state(series.id)).bucketlist, false);
    const seasons = await query("SELECT * FROM media WHERE kind='season' ORDER BY season");
    assert.equal(seasons[0].bucketlist, false);
    assert.equal(seasons[1].bucketlist, true);
    const preserved = await state(seasons[1].id);
    incomplete = true;
    missing = true;
    const partial = await processPlexScan({ manual: true });
    assert.equal(partial!.incompleteSeries, 1);
    assert.equal((await state(film.id)).bucketlist, false, 'valid unrelated titles are still reconciled');
    const deferred = await state(seasons[1].id);
    assert.equal(deferred.bucketlist, preserved.bucketlist);
    assert.deepEqual(
      deferred.plex_checked_at,
      preserved.plex_checked_at,
      'unknown series is not stamped as checked',
    );
    assert.deepEqual(deferred.plex_libraries, preserved.plex_libraries);
    incomplete = false;
    missing = false;
    await query("UPDATE media SET bucket_preference='exclude' WHERE id=$1", [series.id]);
    assert.equal(
      (await state(seasons[1].id)).bucketlist,
      false,
      'series exclusion suppresses automatic season wishes',
    );
    await query("UPDATE media SET bucket_preference='auto' WHERE id=$1", [series.id]);
    assert.equal((await getBucketlist()).shows[0].kind, 'season');
    const ep = (await query("SELECT id FROM media WHERE kind='episode' AND season=2"))[0];
    await query("INSERT INTO watches(media_id,source,source_id) VALUES($1,'test','classification')", [ep.id]);
    assert.equal((await state(seasons[1].id)).bucketlist, false, 'local viewing removes season wish');
    await query("DELETE FROM watches WHERE source='test' AND source_id='classification'");
    assert.equal((await state(seasons[1].id)).bucketlist, true, 'correction recalculates');
    await query("UPDATE media SET bucket_preference='exclude' WHERE id=$1", [film.id]);
    await processPlexScan({ manual: true });
    assert.equal((await state(film.id)).bucketlist, false);
    await query("UPDATE media SET bucket_preference='include' WHERE id=$1", [film.id]);
    missing = true;
    await processPlexScan({ manual: true });
    assert.equal((await state(film.id)).bucketlist, true, 'manual wish survives disappearance');
    await query("UPDATE media SET bucket_preference='auto' WHERE id=$1", [film.id]);
    assert.equal((await state(film.id)).rumpel, true);
    const before = await state(series.id);
    broken = true;
    await assert.rejects(processPlexScan({ manual: true }));
    assert.deepEqual(await state(series.id), before);
    broken = false;
    await assert.rejects(plexList('/bad-page'));
    missing = false;
    await processPlexScan({ manual: true });
    const count = (await query('SELECT count(*) FROM media'))[0].count;
    await importTrakt(dir);
    await processPlexScan({ manual: true });
    assert.equal(
      (await query('SELECT count(*) FROM media'))[0].count,
      count,
      'reimport matches existing Plex IDs',
    );
    assert.equal((await state(film.id)).bucketlist, true);
    await requestPlexScan();
    await query("UPDATE jobs SET status='running' WHERE dedupe_key='plex-scan-manual'");
    await requestPlexScan();
    assert.equal(
      (await query("SELECT status FROM jobs WHERE dedupe_key='plex-scan-manual'"))[0].status,
      'running',
    );
    assert.equal(
      (await query("SELECT status FROM jobs WHERE dedupe_key='plex-scan-followup'"))[0].status,
      'pending',
    );
    const [daily] = await query(
      "INSERT INTO jobs(kind,dedupe_key,status,payload,attempts) VALUES('plex-scan','plex-scan-daily','running','{\"manual\":true}',3) RETURNING id",
    );
    await setSetting('PLEX_SCAN_HOUR', '5');
    await scheduleNextScan(daily.id, 'Fehler beim letzten Lauf');
    const [scheduled] = await query(
      "SELECT *,extract(hour from available_at AT TIME ZONE 'Europe/Berlin') AS hour FROM jobs WHERE id=$1",
      [daily.id],
    );
    assert.equal(scheduled.status, 'pending');
    assert.equal(scheduled.attempts, 0);
    assert.deepEqual(scheduled.payload, {});
    assert.equal(Number(scheduled.hour), 5);
    assert.ok(scheduled.available_at > new Date());
    assert.throws(() => nextPlexRun(24));
    assert.equal(
      selectPlexMatch(
        [
          { id: 'a', ids: { plex: 'shared', tmdb: 1 } },
          { id: 'b', ids: { plex: 'shared', tmdb: 2 } },
        ],
        { plex: 'shared', tmdb: '2' },
      )?.id,
      'b',
    );
    assert.throws(() =>
      selectPlexMatch([{ ids: { plex: 'shared' } }, { ids: { plex: 'shared' } }], { plex: 'shared' }),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('Plex restore: Geza watches survive moves, previews, retries and Plex status loss', async () => {
  assert.match(process.env.DATABASE_URL || '', /geza_test/);
  process.env.SESSION_SECRET = 'classification-test-secret-with-at-least-32-characters';
  await setSetting('PLEX_URL', 'http://plex.test:32400');
  await setSetting('PLEX_TOKEN', 'restore-test');
  await setSetting('PLEX_SERVER_ID', 'restore-server');
  await setSetting('PLEX_ACCOUNT_ID', '1');
  await setSetting('PLEX_SCAN_ENABLED', '1');
  const movie = {
    type: 'movie',
    title: 'Restore film',
    ratingKey: '901',
    guid: 'plex://movie/restore',
    Guid: [{ id: 'tmdb://88001' }],
    viewCount: 0,
  };
  const duplicate = { ...movie, ratingKey: '902' };
  const show = {
    type: 'show',
    title: 'Restore series',
    ratingKey: '903',
    guid: 'plex://show/restore',
    Guid: [{ id: 'tvdb://88002' }],
  };
  const episode = {
    type: 'episode',
    title: 'Restore episode',
    ratingKey: '904',
    guid: 'plex://episode/restore',
    grandparentRatingKey: '903',
    parentIndex: 1,
    index: 1,
    viewCount: 0,
  };
  const unwatched = { ...episode, ratingKey: '905', guid: 'plex://episode/unwatched', index: 2 };
  const items = [movie, duplicate, episode, unwatched];
  let identity = 'restore-server',
    fail = false,
    writes = 0,
    moved = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'http://plex.test:32400');
    assert.equal(new Headers(init?.headers).get('X-Plex-Token'), 'restore-test');
    let value: unknown;
    if (url.pathname === '/identity') value = { machineIdentifier: identity };
    else if (url.pathname === '/library/sections')
      value = {
        Directory: [
          { type: 'movie', key: 'r1', title: 'Restore movies' },
          { type: 'show', key: 'r2', title: 'Restore shows' },
        ],
      };
    else if (url.pathname === '/library/sections/r1/all')
      value = { Metadata: moved ? [duplicate] : [movie, duplicate], totalSize: moved ? 1 : 2 };
    else if (url.pathname === '/library/sections/r2/all') value = { Metadata: [show], totalSize: 1 };
    else if (url.pathname === '/library/metadata/903/allLeaves')
      value = { Metadata: [episode, unwatched], totalSize: 2 };
    else if (url.pathname === '/:/scrobble') {
      assert.equal(url.searchParams.get('identifier'), 'com.plexapp.plugins.library');
      writes++;
      if (fail) return new Response('', { status: 503 });
      const target = items.find((i) => i.ratingKey === url.searchParams.get('key'))!;
      target.viewCount++;
      return new Response(null, { status: 204 });
    } else if (url.pathname.startsWith('/library/metadata/')) {
      value = { Metadata: items.filter((i) => i.ratingKey === url.pathname.split('/').pop()) };
    } else throw Error(`Unexpected Plex request: ${url.pathname}`);
    return Response.json({ MediaContainer: value });
  }) as typeof fetch;
  const restoreJobs = () => query("SELECT * FROM jobs WHERE kind='plex-watch-restore' ORDER BY id");
  try {
    await processPlexScan({ manual: true });
    const [film] = await query("SELECT id FROM media WHERE ids->>'tmdb'='88001'");
    const [ep] = await query("SELECT id FROM media WHERE ids->>'plex'='restore' AND kind='episode'");
    await query(
      `INSERT INTO watches(media_id,source,source_id,watched_at) VALUES
      ($1,'geza','restore-film','2020-01-02'),($2,'trakt','restore-episode',NULL)`,
      [film.id, ep.id],
    );
    const watchesBefore = await query('SELECT * FROM watches ORDER BY id');
    await processPlexScan({ manual: true });
    assert.equal((await restoreJobs()).length, 0, 'restore is opt-in');
    await setSetting('PLEX_RESTORE_WATCHED', '1');
    const preview = await processPlexScan({ manual: true, preview: true });
    assert.equal(preview!.watchedRestores, 3, 'movie copies and only the watched episode');
    assert.equal((await restoreJobs()).length, 0, 'preview cannot enqueue writes');
    assert.equal(writes, 0);
    await processPlexScan({ manual: true });
    await processPlexScan({ manual: true });
    const jobs = await restoreJobs();
    assert.equal(jobs.length, 3, 'pending restores are deduplicated');
    assert.ok(jobs.every((j) => ['movie', 'episode'].includes(j.payload.type)));
    identity = 'wrong-server';
    await assert.rejects(processPlexRestore(jobs[0].payload), /Server-UUID/);
    assert.equal(writes, 0);
    identity = 'restore-server';
    const oldGuid = movie.guid;
    movie.guid = 'plex://movie/different';
    await assert.rejects(processPlexRestore(jobs[0].payload), /Zuordnung/);
    movie.guid = oldGuid;
    movie.Guid = [{ id: 'tmdb://wrong-movie' }];
    await assert.rejects(processPlexRestore(jobs[0].payload), /Provider-IDs/);
    assert.equal(writes, 0, 'shared legacy GUID must not override conflicting provider IDs');
    movie.Guid = [{ id: 'tmdb://88001' }];
    fail = true;
    await assert.rejects(processPlexRestore(jobs[0].payload), /503/);
    assert.deepEqual(await query('SELECT * FROM watches ORDER BY id'), watchesBefore);
    fail = false;
    for (const job of jobs) await processPlexRestore(job.payload);
    assert.equal(writes, 4, 'one failed call followed by three confirmed restores');
    for (const job of jobs) await processPlexRestore(job.payload);
    assert.equal(writes, 4, 'retry reads fresh status and does not mark watched again');
    assert.equal(unwatched.viewCount, 0, 'never mark an entire series watched');
    assert.deepEqual(await query('SELECT * FROM watches ORDER BY id'), watchesBefore);

    await processPlex({
      event: 'media.scrobble',
      metadata: movie,
      playback: false,
      receivedAt: new Date().toISOString(),
      eventId: 'restore-echo',
    });
    assert.deepEqual(
      await query('SELECT * FROM watches ORDER BY id'),
      watchesBefore,
      'restore echo is not a viewing',
    );
    await processPlex({
      event: 'media.scrobble',
      metadata: movie,
      playback: true,
      receivedAt: new Date().toISOString(),
      eventId: 'restore-real-playback',
    });
    assert.equal(
      (await query("SELECT 1 FROM watches WHERE source_id='restore-real-playback'")).length,
      1,
      'real playback remains a new viewing even immediately after a restore',
    );
    assert.deepEqual(
      await query("SELECT * FROM watches WHERE source_id<>'restore-real-playback' ORDER BY id"),
      watchesBefore,
    );
    moved = true;
    duplicate.viewCount = 0;
    await query("UPDATE jobs SET status='done' WHERE kind='plex-watch-restore'");
    await processPlexScan({ manual: true });
    const [movedJob] = await query("SELECT * FROM jobs WHERE kind='plex-watch-restore' AND status='pending'");
    assert.equal(movedJob.payload.ratingKey, '902');
    assert.equal(movedJob.payload.mediaId, film.id, 'moving preserves the Geza identity');
    await setSetting('PLEX_TOKEN', 'changed-token');
    await processPlexRestore(movedJob.payload);
    assert.equal(writes, 4, 'old jobs cannot write to a changed connection');
    await setSetting('PLEX_TOKEN', 'restore-test');
    await query('DELETE FROM watches WHERE media_id=$1', [film.id]);
    await processPlexRestore(movedJob.payload);
    assert.equal(writes, 4, 'manual Geza deletion takes precedence over pending jobs');

    await query("DELETE FROM jobs WHERE kind='plex-scan'");
    await setSetting('PLEX_WEBHOOK_SECRET', 'restore-webhook-secret');
    const webhook = (server: string) =>
      plexWebhook(
        new Request('http://geza.test/api/plex/restore-webhook-secret', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'library.new',
            Account: { id: 1 },
            Server: { uuid: server },
            Metadata: show,
          }),
        }),
        { params: Promise.resolve({ secret: 'restore-webhook-secret' }) },
      );
    assert.equal((await webhook('wrong-server')).status, 403);
    assert.equal((await webhook('restore-server')).status, 202);
    const [newLibrary] = await query(
      "SELECT payload FROM jobs WHERE kind='plex' AND payload->>'event'='library.new' ORDER BY id DESC LIMIT 1",
    );
    await processPlex(newLibrary.payload);
    assert.equal((await query("SELECT * FROM jobs WHERE kind='plex-scan' AND status='pending'")).length, 1);
    await setSetting('PLEX_RESTORE_WATCHED', '0');
    await processPlexRestore(movedJob.payload);
    assert.equal(writes, 4);
    const priorMode = process.env.GEZA_MODE;
    try {
      process.env.GEZA_MODE = 'demo';
      await processPlexRestore(movedJob.payload);
      assert.equal(writes, 4, 'demo never writes to Plex');
    } finally {
      if (priorMode === undefined) delete process.env.GEZA_MODE;
      else process.env.GEZA_MODE = priorMode;
    }
    for (const value of [-1, false, '', 'invalid', 1.5])
      assert.throws(() => plexWatched({ viewCount: value }));
    assert.equal(plexWatched({}), false);
    assert.equal(plexWatched({ viewCount: '1' }), true);
  } finally {
    globalThis.fetch = originalFetch;
    await setSetting('PLEX_RESTORE_WATCHED', '0');
    await query("DELETE FROM jobs WHERE kind IN ('plex-watch-restore','plex-scan')");
    await query("DELETE FROM watches WHERE source_id LIKE 'restore-%'");
    // Keep the legacy migration fixtures used by the next test.
    await query("DELETE FROM media WHERE kind='episode' AND title LIKE 'Restore %'");
    await query(
      "DELETE FROM media WHERE kind='season' AND parent_id IN (SELECT id FROM media WHERE title='Restore series')",
    );
    await query("DELETE FROM media WHERE title LIKE 'Restore %'");
  }
});

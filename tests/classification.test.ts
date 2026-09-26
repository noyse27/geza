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
import { selectPlexMatch } from '../src/lib/plex';

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

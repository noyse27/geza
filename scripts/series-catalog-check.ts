import assert from 'node:assert/strict';
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const name = `geza_catalog_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
let target: pg.Pool | undefined, appPool: pg.Pool | undefined;
const originalFetch = globalThis.fetch;
try {
  await source.query(`CREATE DATABASE ${name}`);
  target = new pg.Pool({ connectionString: url.toString() });
  let showId = '';
  let partialShowId = '';
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    if (file.startsWith('021_')) {
      partialShowId = (
        await target.query(
          `INSERT INTO media(kind,title,ids) VALUES('show','Partial Plex series','{"tmdb":502}') RETURNING id`,
        )
      ).rows[0].id;
      const partialEpisodeId = (
        await target.query(
          "INSERT INTO media(kind,title,parent_id,season,episode,plex_watched) VALUES('episode','Only Plex episode',$1,1,3,true) RETURNING id",
          [partialShowId],
        )
      ).rows[0].id;
      await target.query(
        "INSERT INTO watches(media_id,source,source_id,watched_at) VALUES($1,'plex','partial','2026-09-17T18:00:00Z')",
        [partialEpisodeId],
      );
      showId = (
        await target.query(
          `INSERT INTO media(kind,title,ids) VALUES('show','Legacy catalog','{"tmdb":501}') RETURNING id`,
        )
      ).rows[0].id;
      await target.query(
        "INSERT INTO watches(media_id,source,source_id,watched_at) VALUES($1,'geza','legacy','2026-09-18T18:00:00Z')",
        [showId],
      );
      const ep = (
        await target.query(
          "INSERT INTO media(kind,title,parent_id,season,episode,plex_watched,plex_libraries) VALUES('episode','Plex third',$1,1,3,true,ARRAY['TV']) RETURNING id",
          [showId],
        )
      ).rows[0].id;
      await target.query(
        "INSERT INTO watches(media_id,source,source_id,watched_at) VALUES($1,'plex','existing','2026-09-17T18:00:00Z')",
        [ep],
      );
    }
    await target.query(await readFile('migrations/' + file, 'utf8'));
  }
  process.env.DATABASE_URL = url.toString();
  process.env.SESSION_SECRET = 'series-catalog-test-secret-with-at-least-32-characters';
  const { query, pool } = await import('../src/lib/db');
  appPool = pool;
  const { setSetting } = await import('../src/lib/settings');
  const { syncSeriesCatalog } = await import('../src/lib/series-catalog');
  const { createManualWatch, processSeriesCatalog } = await import('../src/lib/manual-watches');
  await setSetting('TMDB_TOKEN', 'test');
  let failed = false,
    extra = false;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/3/tv/502') return Response.json({ id: 502, seasons: [{ season_number: 1 }] });
    if (path === '/3/tv/502/season/1')
      return Response.json({
        id: 1601,
        season_number: 1,
        episodes: [1, 2, 3].map((n) => ({
          id: 1700 + n,
          season_number: 1,
          episode_number: n,
          name: 'Partial ' + n,
          air_date: '2026-09-01',
        })),
      });
    if (failed) return Response.json({ error: 'unavailable' }, { status: 503 });
    if (path === '/3/tv/501')
      return Response.json({ id: 501, seasons: [{ season_number: 1 }, { season_number: 2 }] });
    if (path === '/3/tv/501/season/1')
      return Response.json({
        id: 601,
        season_number: 1,
        name: 'Staffel 1',
        episodes: [1, 2, 3, 4, ...(extra ? [5] : [])].map((n) => ({
          id: 700 + n,
          season_number: 1,
          episode_number: n,
          name: 'Folge ' + n,
          air_date: n === 4 ? '2027-01-01' : '2026-09-01',
        })),
      });
    if (path === '/3/tv/501/season/2')
      return Response.json({
        id: 602,
        season_number: 2,
        name: 'Staffel 2',
        episodes: [
          { id: 801, season_number: 2, episode_number: 1, name: 'Weitere Staffel', air_date: '2027-01-01' },
        ],
      });
    throw Error('Unexpected test request: ' + path);
  }) as typeof fetch;
  assert.ok(
    (await query('SELECT catalog_backfill_before FROM media WHERE id=$1', [showId]))[0]
      .catalog_backfill_before,
  );
  await processSeriesCatalog(showId);
  const episodes = await query(
    "SELECT m.id,m.episode,m.season,m.plex_libraries,w.source,w.watched_at FROM media m LEFT JOIN watches w ON w.media_id=m.id WHERE m.kind='episode' AND m.parent_id=$1 ORDER BY season,episode",
    [showId],
  );
  assert.equal(episodes.length, 5);
  assert.equal(episodes[0].source, 'geza');
  assert.equal(episodes[1].watched_at.toISOString(), '2026-09-18T18:00:00.000Z');
  assert.equal(episodes[2].source, 'plex');
  assert.equal(episodes[2].watched_at.toISOString(), '2026-09-17T18:00:00.000Z');
  assert.equal(episodes[3].source, null);
  assert.equal(episodes[4].source, null);
  assert.deepEqual(episodes[0].plex_libraries, []);
  assert.deepEqual(episodes[2].plex_libraries, ['TV']);
  await processSeriesCatalog(partialShowId);
  const partial = await query(
    "SELECT m.episode,w.source FROM media m LEFT JOIN watches w ON w.media_id=m.id WHERE m.parent_id=$1 AND m.kind='episode' ORDER BY m.episode",
    [partialShowId],
  );
  assert.deepEqual(partial, [
    { episode: 1, source: null },
    { episode: 2, source: null },
    { episode: 3, source: 'plex' },
  ]);
  const count = (await query('SELECT count(*) AS n FROM watches'))[0].n;
  await processSeriesCatalog(showId);
  assert.equal((await query('SELECT count(*) AS n FROM watches'))[0].n, count);
  extra = true;
  await processSeriesCatalog(showId);
  assert.equal(
    (await query('SELECT count(*) AS n FROM watches'))[0].n,
    count,
    'later catalog refresh must not extend a previous whole-series watch',
  );
  const [season] = await query("SELECT id FROM media WHERE kind='season' AND season=1 AND parent_id=$1", [
    showId,
  ]);
  await createManualWatch(season.id, '2026-09-20T20:00', true);
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM watches w JOIN media m ON m.id=w.media_id WHERE m.kind='episode' AND m.episode=5",
      )
    )[0].n,
    1,
  );
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM watches w JOIN media m ON m.id=w.media_id WHERE m.kind='episode' AND m.season=2",
      )
    )[0].n,
    0,
  );
  const before = (await query('SELECT count(*) AS n FROM watches'))[0].n;
  failed = true;
  await assert.rejects(createManualWatch(showId, '2026-09-20T20:00', true));
  assert.equal((await query('SELECT count(*) AS n FROM watches'))[0].n, before);
  failed = false;
  await query(
    "UPDATE media SET locked_fields=ARRAY['parent_id','season','episode'],episode=99 WHERE kind='episode' AND episode=5",
  );
  await syncSeriesCatalog(showId);
  assert.equal(
    (await query("SELECT count(*)::int AS n FROM media WHERE kind='episode' AND episode=5"))[0].n,
    0,
  );
  console.log(
    'Series catalog checks passed: migration backfill, complete catalog, preserved Plex history, future episodes, idempotency, season scope, failure rollback and locked assignments.',
  );
} finally {
  globalThis.fetch = originalFetch;
  await appPool?.end();
  await target?.end();
  await source.query(`DROP DATABASE IF EXISTS ${name}`);
  await source.end();
}

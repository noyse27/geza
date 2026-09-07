import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';

const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const name = `geza_scrobble_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
let target: pg.Pool | undefined;
let appPool: pg.Pool | undefined;
try {
  await source.query(`CREATE DATABASE ${name}`);
  target = new pg.Pool({ connectionString: url.toString() });
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await target.query(await readFile('migrations/' + file, 'utf8'));
  process.env.DATABASE_URL = url.toString();
  const { query, pool } = await import('../src/lib/db');
  appPool = pool;
  const { saveScrobble, openScrobbleCount } = await import('../src/lib/scrobbles');
  const [movie] = await query("INSERT INTO media(kind,title) VALUES('movie','Testfilm') RETURNING id");
  const [show] = await query("INSERT INTO media(kind,title) VALUES('show','Testserie') RETURNING id");
  const [episode] = await query(
    "INSERT INTO media(kind,title,parent_id,season,episode) VALUES('episode','Folge 4',$1,3,4) RETURNING id",
    [show.id],
  );
  const input = { mediaId: movie.id, eventId: crypto.randomUUID(), date: '2026-09-07', time: '18:07:14' };
  await Promise.all([saveScrobble(input), saveScrobble(input)]);
  const [watch] = await query('SELECT * FROM watches WHERE source_id=$1', [input.eventId]);
  assert.equal((await query('SELECT * FROM watches')).length, 1);
  assert.equal(watch.watched_at.toISOString(), '2026-09-07T16:07:14.000Z');
  assert.equal(watch.time_estimated, false);
  await saveScrobble({ ...input, eventId: crypto.randomUUID(), date: '2026-01-07', time: undefined });
  const [estimated] = await query('SELECT * FROM watches WHERE time_estimated');
  assert.equal(estimated.watched_at.toISOString(), '2026-01-07T11:00:00.000Z');
  await assert.rejects(saveScrobble({ ...input, eventId: crypto.randomUUID(), date: '2026-02-30' }));
  await assert.rejects(saveScrobble({ ...input, mediaId: show.id }));
  await assert.rejects(
    saveScrobble({ ...input, eventId: crypto.randomUUID(), date: '2026-03-29', time: '02:30' }),
  );
  const eventId = crypto.randomUUID();
  const [job] = await query(
    "INSERT INTO jobs(kind,status,error,payload) VALUES('plex','failed','Mehrdeutige Provider-IDs',$1) RETURNING id",
    [
      JSON.stringify({
        event: 'media.scrobble',
        eventId,
        requestId: crypto.randomUUID(),
        metadata: { type: 'episode' },
      }),
    ],
  );
  assert.equal(await openScrobbleCount(), 1);
  await assert.rejects(saveScrobble({ ...input, jobId: job.id }));
  assert.equal(await openScrobbleCount(), 1);
  await Promise.all([
    saveScrobble({ ...input, jobId: job.id, mediaId: episode.id }),
    saveScrobble({ ...input, jobId: job.id, mediaId: episode.id }),
  ]);
  assert.equal(await openScrobbleCount(), 0);
  await assert.rejects(saveScrobble({ ...input, jobId: job.id, mediaId: movie.id }));
  assert.equal((await query('SELECT * FROM watches WHERE source_id=$1', [eventId])).length, 1);
  assert.equal((await query('SELECT status FROM jobs WHERE id=$1', [job.id]))[0].status, 'done');
  assert.equal((await query('SELECT ids FROM media WHERE id=$1', [episode.id]))[0].ids.plex, undefined);
  console.log(
    'Scrobble checks passed: Berlin time, optional time, validation, concurrent retries, inbox resolution, rollback.',
  );
} finally {
  await appPool?.end();
  await target?.end();
  await source.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await source.end();
}

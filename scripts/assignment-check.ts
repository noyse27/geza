import assert from 'node:assert/strict';
import pg from 'pg';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const name = `geza_assignment_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
let target: pg.Pool | undefined;
let appPool: pg.Pool | undefined;
const directory = await mkdtemp(join(tmpdir(), 'geza-assignment-'));
try {
  await source.query(`CREATE DATABASE ${name}`);
  target = new pg.Pool({ connectionString: url.toString() });
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await target.query(await readFile('migrations/' + file, 'utf8'));
  process.env.DATABASE_URL = url.toString();
  const { pool, query } = await import('../src/lib/db');
  appPool = pool;
  const { correctAssignment } = await import('../src/lib/assignment');
  const { deleteMedia } = await import('../src/lib/delete-media');
  const { searchCatalog } = await import('../src/lib/catalog');
  const { importTrakt } = await import('../src/lib/importer');
  await writeFile(
    join(directory, 'watched-history-test.json'),
    JSON.stringify([
      {
        id: 1,
        watched_at: '2026-09-01T12:00:00Z',
        type: 'episode',
        show: { title: 'Lidia Test', ids: { trakt: 1 } },
        episode: { title: 'Episode Test', season: 9, number: 15, ids: { trakt: 2 } },
      },
    ]),
  );
  await importTrakt(directory);
  const [episode] = await query("SELECT * FROM media WHERE kind='episode'");
  const [show] = await query("INSERT INTO media(kind,title) VALUES('show','Lidia Test') RETURNING id");
  const [movie] = await query("INSERT INTO media(kind,title) VALUES('movie','Lidia Test') RETURNING id");
  await query("INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,7,now(),'geza')", [episode.id]);
  await query("INSERT INTO reviews(media_id,source,source_id,body) VALUES($1,'geza','test','Review')", [
    episode.id,
  ]);
  const input = { id: episode.id, parentId: show.id, season: 3, episode: 1 };
  assert.equal(await correctAssignment({ ...input, parentId: movie.id }), false);
  assert.equal(await correctAssignment({ ...input, parentId: episode.id }), false);
  assert.equal(await correctAssignment({ ...input, parentId: '999999' }), false);
  await assert.rejects(correctAssignment({ ...input, season: -1 }));
  await assert.rejects(correctAssignment({ ...input, episode: 1.5 }));
  assert.equal(await correctAssignment(input), true);
  await importTrakt(directory);
  const [updated] = await query('SELECT * FROM media WHERE id=$1', [episode.id]);
  assert.equal(updated.parent_id, show.id);
  assert.equal(updated.season, 3);
  assert.equal(updated.episode, 1);
  assert.ok(updated.locked_fields.includes('parent_id'));
  assert.equal((await query('SELECT * FROM watches WHERE media_id=$1', [episode.id])).length, 1);
  assert.equal((await query('SELECT rating FROM ratings WHERE media_id=$1', [episode.id]))[0].rating, 7);
  assert.equal((await query('SELECT body FROM reviews WHERE media_id=$1', [episode.id]))[0].body, 'Review');
  const results = await searchCatalog(new URLSearchParams({ q: 'Lidia Test', type: 'series' }));
  assert.equal(results.items.length, 2);
  assert.ok(results.items.every((item) => item.kind === 'show'));
  assert.ok((await deleteMedia({ id: show.id, title: 'Lidia Test' })).error);
  assert.ok((await deleteMedia({ id: episode.id, title: 'Wrong title' })).error);
  assert.equal((await query('SELECT 1 FROM watches WHERE media_id=$1', [episode.id])).length, 1);
  await query("INSERT INTO posters(media_id,content_type,data,etag) VALUES($1,'image/png',$2,'test')", [
    episode.id,
    Buffer.from('test'),
  ]);
  await query(
    "INSERT INTO friend_reviews(media_id,provider,url) VALUES($1,'wortvogel','https://wortvogel.de/test')",
    [episode.id],
  );
  assert.equal((await deleteMedia({ id: episode.id, title: episode.title })).ok, true);
  for (const table of ['watches', 'ratings', 'reviews', 'posters', 'friend_reviews'])
    assert.equal((await query(`SELECT 1 FROM ${table} WHERE media_id=$1`, [episode.id])).length, 0);
  assert.equal((await query('SELECT 1 FROM media WHERE id=$1', [episode.id])).length, 0);
  assert.equal((await query("SELECT 1 FROM jobs WHERE payload->>'mediaId'=$1", [episode.id])).length, 0);
  assert.equal((await deleteMedia({ id: show.id, title: 'Lidia Test' })).ok, true);
  assert.ok((await deleteMedia({ id: episode.id, title: episode.title })).error);
  console.log(
    'Deletion checks passed: child protection, title confirmation, related data cleanup, missing record.',
  );
  console.log(
    'Assignment checks passed: valid correction, invalid targets, validation, reimport protection, preserved history/ratings/reviews, series search.',
  );
} finally {
  await appPool?.end();
  await target?.end();
  if (/^geza_assignment_\d+$/.test(name)) await source.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await source.end();
  await rm(directory, { recursive: true, force: true });
}

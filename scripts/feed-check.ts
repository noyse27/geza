import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';

const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const name = `geza_feed_${Date.now()}`;
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
  delete process.env.FEED_GRACE_MINUTES;
  const { query, pool } = await import('../src/lib/db');
  appPool = pool;
  const { recordFeedEntry } = await import('../src/lib/feed');
  const { GET } = await import('../src/app/feed.xml/route');
  const feed = async () => (await GET()).text();
  const expire = () =>
    query("UPDATE feed_entries SET publish_at=now()-interval '1 minute' WHERE publish_at>now()");
  const rate = (id: string, rating: number | null) =>
    rating === null
      ? query('DELETE FROM ratings WHERE media_id=$1', [id])
      : query(
          "INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,$2,now(),'geza') ON CONFLICT(media_id) DO UPDATE SET rating=excluded.rating",
          [id, rating],
        );
  const [movie] = await query(
    "INSERT INTO media(kind,title,year) VALUES('movie','Testfilm',2020) RETURNING id",
  );
  const [other] = await query("INSERT INTO media(kind,title) VALUES('movie','Importfilm') RETURNING id");

  delete process.env.PUBLIC_URL;
  assert.equal((await GET()).status, 404, 'no feed without PUBLIC_URL');
  process.env.PUBLIC_URL = 'https://geza.example.test/';

  // Imports write ratings directly and never appear in the feed.
  await rate(other.id, 9);
  assert.equal((await query('SELECT * FROM feed_entries WHERE media_id=$1', [other.id])).length, 0);

  // Changes wait for the grace period and collapse into one entry.
  for (const value of [6, 7, 8]) {
    await rate(movie.id, value);
    await recordFeedEntry(movie.id);
  }
  let entries = await query('SELECT * FROM feed_entries WHERE media_id=$1', [movie.id]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].rating, 8);
  assert.equal(entries[0].is_update, false);
  assert.ok(!(await feed()).includes('<item>'), 'entry is hidden during the grace period');
  await expire();
  let xml = await feed();
  assert.ok(xml.includes('Testfilm (2020) – ★★★★★★★★☆☆ (8/10)'));
  assert.ok(xml.includes('https://geza.example.test/title/' + movie.id));
  assert.ok(!xml.includes('Aktualisiert'));
  assert.ok(!xml.includes('Importfilm'));

  // A change back to the published value drops the waiting entry.
  await rate(movie.id, 5);
  await recordFeedEntry(movie.id);
  assert.equal((await query('SELECT * FROM feed_entries WHERE publish_at>now()')).length, 1);
  await rate(movie.id, 8);
  await recordFeedEntry(movie.id);
  assert.equal((await query('SELECT * FROM feed_entries WHERE publish_at>now()')).length, 0);

  // A real change after publication becomes an update mentioning the previous rating.
  await rate(movie.id, 9);
  await recordFeedEntry(movie.id);
  await expire();
  xml = await feed();
  assert.ok(xml.includes('Aktualisiert: Testfilm (2020) – ★★★★★★★★★☆ (9/10)'));
  assert.ok(xml.includes('vorher 8/10'));
  assert.equal((xml.match(/<item>/g) || []).length, 2);

  // Deleting the rating during the grace period leaves nothing to announce.
  await rate(movie.id, 4);
  await recordFeedEntry(movie.id);
  await rate(movie.id, null);
  await recordFeedEntry(movie.id);
  assert.equal((await query('SELECT * FROM feed_entries WHERE publish_at>now()')).length, 0);

  // Reviews appear in full and escaped; private reviews and hidden titles never do.
  await query(
    "INSERT INTO reviews(media_id,source,source_id,body,spoiler,is_public) VALUES($1,'geza','r1',$2,true,true)",
    [movie.id, 'Sehr <b>gut</b> & lang. ' + 'x'.repeat(400)],
  );
  await recordFeedEntry(movie.id);
  await expire();
  xml = await feed();
  assert.ok(xml.includes('&amp;lt;b&amp;gt;gut&amp;lt;/b&amp;gt;'), 'review HTML is escaped');
  assert.ok(xml.includes('x'.repeat(400)), 'review is not truncated');
  assert.ok(xml.includes('Spoiler'));
  const [secret] = await query("INSERT INTO media(kind,title) VALUES('movie','Geheimfilm') RETURNING id");
  await query(
    "INSERT INTO reviews(media_id,source,source_id,body,is_public) VALUES($1,'geza','r2','privat',false)",
    [secret.id],
  );
  await recordFeedEntry(secret.id);
  assert.equal((await query('SELECT * FROM feed_entries WHERE media_id=$1', [secret.id])).length, 0);
  await rate(secret.id, 7);
  await recordFeedEntry(secret.id);
  await expire();
  await query('UPDATE media SET rumpel=true WHERE id=$1', [secret.id]);
  assert.ok(!(await feed()).includes('Geheimfilm'), 'rumpel titles disappear from the feed');

  // Grace period 0 publishes immediately.
  process.env.FEED_GRACE_MINUTES = '0';
  await rate(other.id, 3);
  await recordFeedEntry(other.id);
  assert.ok((await feed()).includes('Importfilm'));
  console.log(
    'Feed checks passed: grace period, debounce, updates, escaping, visibility, no import entries.',
  );
} finally {
  await appPool?.end();
  await target?.end();
  await source.query(`DROP DATABASE IF EXISTS ${name}`);
  await source.end();
}

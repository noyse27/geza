import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, pool } from '../src/lib/db';
import { searchCatalog } from '../src/lib/catalog';
import { collectionGroups } from '../src/lib/collections';
import { importTrakt } from '../src/lib/importer';
import { listRumpel, loadTombstones, runRumpelAction, RumpelError } from '../src/lib/rumpel';

after(() => pool.end());
const suffix = crypto.randomUUID().replaceAll('-', '');
const created: string[] = [];
async function movie(title: string, extra = '', values: unknown[] = []) {
  const [row] = await query<{ id: string }>(
    `INSERT INTO media(kind,title${extra ? ',' + extra.split('=')[0] : ''}) VALUES('movie',$1${extra ? ',' + extra.split('=')[1] : ''}) RETURNING id`,
    [`${title} ${suffix}`, ...values],
  );
  created.push(row.id);
  return row.id;
}
const state = async (id: string) =>
  (await query<{ rumpel: boolean; bucketlist: boolean; pinned: boolean }>(
    'SELECT rumpel,bucketlist,bucketlist_pinned AS pinned FROM media WHERE id=$1',
    [id],
  ))[0];
async function wipe() {
  const all = (
    await query<{ id: string }>(
      `SELECT id FROM media WHERE title LIKE $1 OR trakt_id BETWEEN 990000001 AND 990000099`,
      [`%${suffix}%`],
    )
  ).map((r) => r.id);
  if (!all.length) return;
  for (const table of ['watches', 'ratings', 'reviews', 'friend_reviews', 'film_series_members'])
    await query(`DELETE FROM ${table} WHERE media_id=ANY($1::bigint[])`, [all]);
  await query('DELETE FROM media WHERE parent_id=ANY($1::bigint[])', [all]);
  await query('DELETE FROM media WHERE id=ANY($1::bigint[])', [all]);
}
test.beforeEach(async () => {
  await query("DELETE FROM rumpel_deleted WHERE title LIKE $1 OR ids->>'trakt' LIKE '9900000%'", [`%${suffix}%`]);
});
test.afterEach(wipe);

test('Zustände Archiv, Bucketliste und Rumpelkammer schließen sich aus und folgen der Aktivität', async () => {
  const id = await movie('Waise');
  assert.equal((await state(id)).rumpel, true, 'neuer Film ohne Aktivität ist Rumpel');
  // Bucketliste verlässt die Rumpelkammer …
  await query('UPDATE media SET bucketlist=true WHERE id=$1', [id]);
  assert.deepEqual(await state(id), { rumpel: false, bucketlist: true, pinned: false });
  // … und die Rücknahme ohne Aktivität führt zurück in die Rumpelkammer.
  await query('UPDATE media SET bucketlist=false WHERE id=$1', [id]);
  assert.equal((await state(id)).rumpel, true);
  // Die Regel gilt auch bei direkten Schreibversuchen: Bucketliste gewinnt, Constraint bleibt als Sicherung.
  await query('UPDATE media SET bucketlist=true,rumpel=true WHERE id=$1', [id]);
  assert.equal((await state(id)).rumpel, false);
  await query('UPDATE media SET bucketlist=false WHERE id=$1', [id]);
  assert.equal(
    (await query('SELECT 1 FROM pg_constraint WHERE conname=$1', ['media_rumpel_not_bucketlist'])).length,
    1,
  );
  // Jede Aktivität macht den Film zum Archiv-Eintrag; entfällt sie, geht er zurück.
  await query("INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,7,now(),'test')", [id]);
  assert.equal((await state(id)).rumpel, false);
  await query('DELETE FROM ratings WHERE media_id=$1', [id]);
  assert.equal((await state(id)).rumpel, true);
  await query("INSERT INTO watches(media_id,source,source_id) VALUES($1,'test',$2)", [id, suffix]);
  assert.equal((await state(id)).rumpel, false);
  await query('DELETE FROM watches WHERE media_id=$1', [id]);
  await query("INSERT INTO reviews(media_id,source,source_id,body) VALUES($1,'test',$2,'x')", [id, suffix]);
  assert.equal((await state(id)).rumpel, false);
  await query('DELETE FROM reviews WHERE media_id=$1', [id]);
  assert.equal((await state(id)).rumpel, true);
  // Automatisch gefundene Friend-Reviews zählen nicht, manuelle schon.
  await query(
    "INSERT INTO friend_reviews(media_id,provider,name,url,scale,manual,status) VALUES($1,'p','P','https://x.test/',5,false,'found')",
    [id],
  );
  assert.equal((await state(id)).rumpel, true, 'automatischer Friend-Review ist keine Aktivität');
  await query("UPDATE friend_reviews SET manual=true,status='manual' WHERE media_id=$1", [id]);
  assert.equal((await state(id)).rumpel, false, 'manueller Friend-Review ist Aktivität');
  await query('DELETE FROM friend_reviews WHERE media_id=$1', [id]);
  assert.equal((await state(id)).rumpel, true);
});

test('Serien: Aktivität in Staffel oder Episode nimmt die ganze Serie aus der Rumpelkammer', async () => {
  const show = (await query<{ id: string }>("INSERT INTO media(kind,title) VALUES('show',$1) RETURNING id", [`Serie ${suffix}`]))[0].id;
  const season = (await query<{ id: string }>("INSERT INTO media(kind,title,parent_id,season) VALUES('season','S1',$1,1) RETURNING id", [show]))[0].id;
  const episodes = (
    await query<{ id: string }>(
      "INSERT INTO media(kind,title,parent_id,season,episode) SELECT 'episode','E'||n,$1,1,n FROM generate_series(1,3) n RETURNING id",
      [season],
    )
  ).map((r) => r.id);
  const flags = async () => (await query<{ id: string; rumpel: boolean }>('SELECT id,rumpel FROM media WHERE id=ANY($1::bigint[])', [[show, season, ...episodes]])).map((r) => r.rumpel);
  assert.deepEqual(await flags(), [true, true, true, true, true], 'Serie samt Kindern ist Rumpel');
  await query("INSERT INTO watches(media_id,source,source_id) VALUES($1,'test',$2)", [episodes[1], suffix]);
  assert.deepEqual(await flags(), [false, false, false, false, false], 'eine gesehene Episode rettet die Serie');
  await query('DELETE FROM watches WHERE media_id=$1', [episodes[1]]);
  assert.deepEqual(await flags(), [true, true, true, true, true]);
  await query('UPDATE media SET bucketlist=true WHERE id=$1', [show]);
  assert.deepEqual(await flags(), [false, false, false, false, false], 'Bucketliste-Serie: Kinder sind kein Rumpel');
  await query('UPDATE media SET bucketlist=false WHERE id=$1', [show]);
  assert.deepEqual(await flags(), [true, true, true, true, true]);
  await query('DELETE FROM media WHERE id=ANY($1::bigint[])', [episodes]);
  await query('DELETE FROM media WHERE id=$1', [season]);
  await query('DELETE FROM media WHERE id=$1', [show]);
});

test('Rumpel-Einträge erscheinen weder in Suche noch in Sammlungen, aber in der Rumpelkammer', async () => {
  const id = await movie('Sichtbarkeitstest', 'genres=$2', [[`G${suffix}`]]);
  const params = new URLSearchParams({ q: suffix });
  assert.equal((await searchCatalog(params, true)).items.length, 0);
  assert.equal((await searchCatalog(params, false)).items.length, 0);
  assert.equal((await collectionGroups('genre')).some((g) => g.value === `G${suffix}`), false);
  const list = await listRumpel({ q: suffix, type: 'all', source: 'all' }, 0);
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, id);
  await query("INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,6,now(),'test')", [id]);
  assert.equal((await searchCatalog(params, true)).items[0].id, id);
  assert.equal((await collectionGroups('genre')).some((g) => g.value === `G${suffix}`), true);
  assert.equal((await listRumpel({ q: suffix, type: 'all', source: 'all' }, 0)).total, 0);
});

test('Massenaktionen: Bucketliste, Bewerten, Löschen mit Gedächtnis; nur Rumpel-Einträge sind betroffen', async () => {
  const [a, b, c, d, keep] = [
    await movie('A', 'ids=$2', [JSON.stringify({ imdb: 'tt9900001', tmdb: 99000001, plex: 'p' + suffix })]),
    await movie('B'),
    await movie('C'),
    await movie('D'),
    await movie('Archiv'),
  ];
  await query("INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,9,now(),'test')", [keep]);
  // Bucketliste: fixiert, aus der Rumpelkammer, Archiv-Eintrag bleibt unberührt (übersprungen).
  const moved = await runRumpelAction({ action: 'bucketlist', ids: [a, keep] });
  assert.deepEqual(moved, { count: 1, skipped: 1 });
  assert.deepEqual(await state(a), { rumpel: false, bucketlist: true, pinned: true });
  assert.equal((await state(keep)).bucketlist, false);
  // Rücknahme aus der Bucketliste hebt die Fixierung auf und führt zurück in die Rumpelkammer.
  await query('UPDATE media SET bucketlist=false WHERE id=$1', [a]);
  assert.deepEqual(await state(a), { rumpel: true, bucketlist: false, pinned: false });
  // Bewerten: danach Archiv.
  assert.deepEqual(await runRumpelAction({ action: 'rate', ids: [b, c], rating: 8 }), { count: 2, skipped: 0 });
  assert.equal((await state(b)).rumpel, false);
  assert.equal((await query('SELECT rating FROM ratings WHERE media_id=$1', [c]))[0].rating, 8);
  // Filter-Auswahl verlangt die erwartete Anzahl.
  await assert.rejects(
    runRumpelAction({ action: 'delete', filter: { q: suffix, type: 'all' }, expectedCount: 99 }),
    RumpelError,
  );
  assert.equal((await query('SELECT 1 FROM media WHERE id=$1', [a])).length, 1);
  // Löschen über Filter: a und d sind noch Rumpel.
  assert.deepEqual(await runRumpelAction({ action: 'delete', filter: { q: suffix, type: 'all' }, expectedCount: 2 }), { count: 2, skipped: 0 });
  assert.equal((await query('SELECT 1 FROM media WHERE id=ANY($1::bigint[])', [[a, d]])).length, 0);
  assert.equal((await query('SELECT 1 FROM media WHERE id=ANY($1::bigint[])', [[b, c, keep]])).length, 3);
  const tombstones = await loadTombstones();
  assert.equal(tombstones.matches('movie', { imdb: 'tt9900001' }).length, 1);
  assert.equal(tombstones.matches('movie', { plex: 'p' + suffix }).length, 1);
  assert.equal(tombstones.matches('show', { imdb: 'tt9900001' }).length, 0);
  // Ein Archiv-Eintrag lässt sich über die Rumpelkammer nie löschen.
  assert.deepEqual(await runRumpelAction({ action: 'delete', ids: [keep] }), { count: 0, skipped: 1 });
});

test('Trakt-Import: Collection-Einträge werden Rumpel, Gelöschtes bleibt draußen, Aktivität hebt die Sperre auf', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'geza-import-'));
  const item = (trakt: number, title: string) => ({
    title,
    year: 2001,
    ids: { trakt, slug: `s${trakt}`, imdb: `tt99000${trakt % 1000}`, tmdb: trakt },
  });
  const file = (name: string, rows: unknown[]) => writeFile(join(dir, name), JSON.stringify(rows));
  try {
    const [collected, deleted, deletedRated, seen] = [990000001, 990000002, 990000003, 990000004];
    await query(
      `INSERT INTO rumpel_deleted(kind,title,ids) VALUES('movie','Gelöscht',$1),('movie','Gelöscht bewertet',$2)`,
      [JSON.stringify({ trakt: deleted }), JSON.stringify({ tmdb: deletedRated })],
    );
    await file('collection-movies.json', [
      { movie: item(collected, 'Nur Collection') },
      { movie: item(deleted, 'Gelöscht') },
      { movie: item(deletedRated, 'Gelöscht bewertet') },
      { movie: item(seen, 'Gesehen') },
    ]);
    await file('ratings-movies.json', [
      { rated_at: '2026-01-02T03:04:05.000Z', rating: 8, type: 'movie', movie: item(deletedRated, 'Gelöscht bewertet') },
    ]);
    await file('watched-history-movies.json', [
      { id: 990000000 + 7, watched_at: '2026-01-02T03:04:05.000Z', type: 'movie', movie: item(seen, 'Gesehen') },
    ]);
    const report = (await importTrakt(dir)) as { skippedDeleted: number; rumpel: number };
    assert.equal(report.skippedDeleted, 1);
    const rows = await query<{ trakt_id: string; rumpel: boolean }>(
      'SELECT trakt_id,rumpel FROM media WHERE trakt_id BETWEEN 990000001 AND 990000004 ORDER BY trakt_id',
    );
    assert.deepEqual(
      rows.map((r) => [Number(r.trakt_id), r.rumpel]),
      [
        [collected, true],
        [deletedRated, false],
        [seen, false],
      ],
    );
    assert.equal((await query("SELECT 1 FROM rumpel_deleted WHERE ids->>'trakt'=$1", [String(deleted)])).length, 1, 'Sperre bleibt');
    assert.equal((await query("SELECT 1 FROM rumpel_deleted WHERE ids->>'tmdb'=$1", [String(deletedRated)])).length, 0, 'Sperre fällt bei Aktivität');
    assert.ok(report.rumpel >= 1);
    // Ein zweiter Lauf ändert nichts.
    const again = (await importTrakt(dir)) as { skippedDeleted: number };
    assert.equal(again.skippedDeleted, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await query("DELETE FROM rumpel_deleted WHERE ids->>'trakt' LIKE '9900000%' OR ids->>'tmdb' LIKE '9900000%'");
    await query('DELETE FROM watches WHERE source_id=$1', ['990000007']);
  }
});

test('Serie löschen entfernt Staffeln und Episoden und merkt sich nur die Serie', async () => {
  const [{ id: show }] = await query<{ id: string }>(
    "INSERT INTO media(kind,title,ids) VALUES('show',$1,$2) RETURNING id",
    [`Serie ${suffix}`, JSON.stringify({ tmdb: 99000077 })],
  );
  const [{ id: season }] = await query<{ id: string }>(
    "INSERT INTO media(kind,title,parent_id,season) VALUES('season','S1',$1,1) RETURNING id",
    [show],
  );
  const episodes = (
    await query<{ id: string }>(
      "INSERT INTO media(kind,title,parent_id,season,episode) SELECT 'episode','E'||n,$1,1,n FROM generate_series(1,3) n RETURNING id",
      [season],
    )
  ).map((r) => r.id);
  const listed = await listRumpel({ q: suffix, type: 'show', source: 'all' }, 0);
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].children, 4);
  assert.deepEqual(await runRumpelAction({ action: 'delete', ids: [show] }), { count: 1, skipped: 0 });
  assert.equal((await query('SELECT 1 FROM media WHERE id=ANY($1::bigint[])', [[show, season, ...episodes]])).length, 0);
  const tombstones = await loadTombstones();
  assert.equal(tombstones.matches('show', { tmdb: 99000077 }).length, 1);
  assert.equal(tombstones.matches('movie', { tmdb: 99000077 }).length, 0);
  await query("DELETE FROM rumpel_deleted WHERE ids->>'tmdb'='99000077'");
});

test('Herkunftsfilter trennt Titel mit und ohne Plex-Verweis, auch bei Massenaktionen', async () => {
  const withPlex = await movie('MitPlex', 'ids=$2', [JSON.stringify({ plex: 'q' + suffix })]);
  const without = await movie('OhnePlex');
  const count = async (source: 'all' | 'plex' | 'other') =>
    (await listRumpel({ q: suffix, type: 'all', source }, 0)).items.map((i) => [i.id, i.has_plex]);
  assert.deepEqual(await count('plex'), [[withPlex, true]]);
  assert.deepEqual(await count('other'), [[without, false]]);
  assert.equal((await count('all')).length, 2);
  // Die Massenaktion über den Filter trifft nur die gefilterte Herkunft.
  const filter = { q: suffix, type: 'all', source: 'plex' };
  assert.deepEqual(await runRumpelAction({ action: 'bucketlist', filter, expectedCount: 1 }), { count: 1, skipped: 0 });
  assert.equal((await state(withPlex)).bucketlist, true);
  assert.equal((await state(without)).rumpel, true);
});


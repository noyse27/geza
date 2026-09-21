import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { dataTables, newTransferKey, decodeArchive, openCredentials } from '../src/lib/transfer-format';

// Only the newly created temporary database is modified. No application data is used.
const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
source.on('error', (err) => console.error('source pool error', err));
const name = `geza_transfer_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
let appPool: pg.Pool | undefined;
try {
  await source.query(`CREATE DATABASE ${name}`);
  process.env.DATABASE_URL = url.toString();
  process.env.SESSION_SECRET = 'source-installation-secret-for-transfer-test';
  const { pool, query } = await import('../src/lib/db');
  appPool = pool;
  const { exportInstallation, inspectInstallation, restoreInstallation } =
    await import('../src/lib/transfer');
  const { createInitialAdmin, installationReady } = await import('../src/lib/setup');
  const { hashPassword, verifyPassword, encrypt } = await import('../src/lib/security');
  const { getSetting } = await import('../src/lib/settings');
  const { discoverFriendReview } = await import('../src/lib/friend-reviews');
  await query('CREATE TABLE migrations(name text PRIMARY KEY)');
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    await query(await readFile('migrations/' + file, 'utf8'));
    await query('INSERT INTO migrations(name) VALUES($1)', [file]);
  }
  const password = 'the-original-admin-password';
  const classified = new Set<string>([
    ...dataTables,
    'admin_account',
    'settings',
    'sessions',
    'login_attempts',
    'event_logs',
    'migrations',
    'setup_restore',
  ]);
  for (const { table_name } of await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
  ))
    assert.ok(classified.has(table_name), `New table needs an explicit transfer decision: ${table_name}`);
  await query('INSERT INTO admin_account VALUES(1,$1,$2)', ['old-admin', hashPassword(password)]);
  await query(`INSERT INTO media(id,kind,title,parent_id,locked_fields,field_sources) VALUES
    (9007199254740993,'episode','Episode',9007199254740994,ARRAY['parent_id'],'{"title":"manual"}'),
    (9007199254740994,'show','Series',NULL,'{}','{}'),(100,'movie','Movie',NULL,'{}','{}')`);
  await query(
    `INSERT INTO watches(media_id,source,source_id,original_watched_at,time_estimated) VALUES(100,'trakt','watch-1','1970-01-01',true)`,
  );
  await query(`INSERT INTO ratings VALUES(100,8,now(),'geza')`);
  await query(
    `INSERT INTO reviews(media_id,source,source_id,body,is_public) VALUES(100,'geza','draft','A private draft',false)`,
  );
  await query(
    `INSERT INTO posters(media_id,content_type,data,etag) VALUES(100,'image/png',$1,'poster-test')`,
    [Buffer.from([0, 255, 128, 10])],
  );
  await query(
    `INSERT INTO review_boxes(provider,name) VALUES('filmdienst','Filmdienst'),('custom-example','Manual')`,
  );
  await query(
    `INSERT INTO friend_reviews(media_id,provider,manual,status) VALUES(100,'filmdienst',false,'pending')`,
  );
  await query(
    `INSERT INTO provider_ratings(media_id,provider,rating,url) VALUES(100,'imdb',7.5,'https://www.imdb.com/title/tt123/')`,
  );
  await query(`INSERT INTO film_series(id,title) VALUES(12,'Film series')`);
  await query(`INSERT INTO film_series_members VALUES(12,100,1)`);
  await query(
    `INSERT INTO jobs(kind,status,payload) VALUES('plex','pending','{"event":"media.scrobble","eventId":"5fbaac04-c234-4d7b-9140-1a7108dfb830","metadata":{"title":"Unresolved"}}')`,
  );
  await query(`INSERT INTO import_runs(report) VALUES('{"files":1,"media":3}')`);
  await query(`INSERT INTO settings VALUES('TMDB_TOKEN',$1),('PLEX_WEBHOOK_SECRET',$2)`, [
    encrypt('source-tmdb-token'),
    encrypt('old-webhook-secret'),
  ]);
  process.env.TVDB_API_KEY = 'environment-provider-key';
  const key = newTransferKey(),
    archive = decodeArchive(await exportInstallation(key));
  assert.equal(archive.tables.media[0].id, '9007199254740993');
  assert.equal(openCredentials(archive, key).settings.TVDB_API_KEY, 'environment-provider-key');
  assert.ok(!('PLEX_WEBHOOK_SECRET' in openCredentials(archive, key).settings));
  assert.equal((await inspectInstallation(archive)).counts.media, 3);
  const reset = async () =>
    query(`TRUNCATE ${dataTables.join(',')},settings,admin_account,setup_restore RESTART IDENTITY CASCADE`);
  await reset();
  process.env.SESSION_SECRET = 'different-destination-installation-secret-for-test';
  const options = { accounts: true, apiKeys: true, modules: true, withoutKey: false, key };
  await assert.rejects(restoreInstallation(archive, { ...options, key: newTransferKey() }, 'browser-owner'));
  assert.equal((await query('SELECT * FROM media')).length, 0);
  const incompatible = structuredClone(archive);
  incompatible.migrations.push('999_future.sql');
  await assert.rejects(inspectInstallation(incompatible), /Version/);
  const invalid = structuredClone(archive);
  invalid.tables.film_series_members[0].media_id = '123456789';
  await assert.rejects(restoreInstallation(invalid, options, 'browser-owner'));
  for (const table of [...dataTables, 'settings', 'admin_account', 'setup_restore'])
    assert.equal((await query(`SELECT * FROM ${table}`)).length, 0, `Rollback of ${table}`);
  await restoreInstallation(archive, options, 'browser-owner');
  assert.ok(await installationReady());
  assert.ok(verifyPassword(password, (await query('SELECT * FROM admin_account'))[0].password_hash));
  assert.equal(await getSetting('TMDB_TOKEN'), 'source-tmdb-token');
  assert.equal(await getSetting('TVDB_API_KEY'), 'environment-provider-key');
  assert.notEqual(await getSetting('PLEX_WEBHOOK_SECRET'), 'old-webhook-secret');
  assert.deepEqual((await query('SELECT data FROM posters'))[0].data, Buffer.from([0, 255, 128, 10]));
  assert.equal(
    (await query("SELECT parent_id FROM media WHERE kind='episode'"))[0].parent_id,
    '9007199254740994',
  );
  assert.equal((await query('SELECT is_public FROM reviews'))[0].is_public, false);
  assert.equal((await query('SELECT status FROM jobs'))[0].status, 'failed');
  const roundTrip = decodeArchive(await exportInstallation(newTransferKey()));
  for (const table of dataTables.filter((t) => t !== 'jobs' && t !== 'review_boxes')) {
    assert.deepEqual(
      roundTrip.tables[table].map((r) => JSON.stringify(r)).sort(),
      archive.tables[table].map((r) => JSON.stringify(r)).sort(),
      `All fields preserved: ${table}`,
    );
  }
  for (const table of dataTables)
    assert.equal((await query(`SELECT * FROM ${table}`)).length, archive.tables[table].length, table);
  assert.equal(
    (await query(`INSERT INTO media(kind,title) VALUES('movie','New') RETURNING id`))[0].id,
    '9007199254740995',
  );
  await assert.rejects(restoreInstallation(archive, options, 'browser-owner'), /bereits/);
  await reset();
  await query(`INSERT INTO media(kind,title) VALUES('movie','Existing')`);
  await assert.rejects(restoreInstallation(archive, options, 'browser-owner'), /leeren/);
  await reset();
  await restoreInstallation(
    archive,
    { ...options, accounts: false, apiKeys: false, modules: false, withoutKey: true, key: 'wrong' },
    'browser-owner',
  );
  assert.equal(await installationReady(), false);
  assert.equal(await getSetting('TVDB_API_KEY'), ''); // Destination environment is deliberately shadowed.
  assert.equal(
    (await query(`SELECT automatic_enabled FROM review_boxes WHERE provider='filmdienst'`))[0]
      .automatic_enabled,
    false,
  );
  assert.equal(await discoverFriendReview(), false);
  assert.equal((await query('SELECT * FROM friend_reviews')).length, 1);
  await assert.rejects(
    createInitialAdmin('attacker', 'new-long-password', 'other-browser'),
    /ursprünglichen/,
  );
  await createInitialAdmin('new-admin', 'new-long-password', 'browser-owner');
  assert.ok(await installationReady());
  await reset();
  await restoreInstallation(archive, { ...options, accounts: false }, 'browser-owner');
  assert.equal(await installationReady(), false);
  assert.equal(await getSetting('TMDB_TOKEN'), 'source-tmdb-token');
  await createInitialAdmin('new-admin', 'new-long-password', 'browser-owner');
  await reset();
  const concurrent = await Promise.allSettled([
    restoreInstallation(archive, { ...options, apiKeys: false }, 'browser-owner'),
    restoreInstallation(archive, { ...options, apiKeys: false }, 'other-browser'),
  ]);
  assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await getSetting('TMDB_TOKEN'), '');
  assert.ok(await installationReady());
  console.log(
    'Transfer regression passed: full round-trip, exact IDs/posters, encryption/key rotation, rollback, no merge, independent selections, setup ownership and concurrent restore.',
  );
} finally {
  await appPool?.end();
  await source.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await source.end();
}

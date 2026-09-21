import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// Creates and drops its own database; never resets the supplied source database.
const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
source.on('error', (err) => console.error('source pool error', err));
const name = `geza_demo_safety_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
let db: pg.Pool | undefined;
function migrate(mode: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: url.toString(), GEZA_MODE: mode },
    encoding: 'utf8',
    windowsHide: true,
  });
}
try {
  await source.query(`CREATE DATABASE ${name}`);
  db = new pg.Pool({ connectionString: url.toString() });
  db.on('error', (err) => console.error('db pool error', err));
  let result = migrate('production');
  assert.equal(result.status, 0, result.stderr);
  await db.query("INSERT INTO media(kind,title) VALUES('movie','Protected production entry')");
  result = migrate('demo');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /eigene, leere Datenbank/);
  assert.equal((await db.query('SELECT title FROM media')).rows[0].title, 'Protected production entry');
  assert.equal((await db.query("SELECT to_regclass('demo_state') AS table_name")).rows[0].table_name, null);
  console.log('PASS demo refuses existing data and rolls back demo_state');
  await db.query('DELETE FROM media');
  result = migrate('demo');
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM media')).rows[0].n, 12);
  await db.query("UPDATE media SET title='Keep changes until scheduled reset' WHERE id=1");
  result = migrate('demo');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (await db.query('SELECT title FROM media WHERE id=1')).rows[0].title,
    'Keep changes until scheduled reset',
  );
  result = migrate('production');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /darf nicht als Produktion/);
  console.log('PASS clean demo initialization and prevention of accidental production switch');
} finally {
  await db?.end();
  await source.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await source.end();
}

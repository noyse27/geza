import { isDemo } from '../src/lib/demo-mode';
import { maintainDemo } from '../src/lib/demo';
import { readdir, readFile } from 'node:fs/promises';
import { pool } from '../src/lib/db';
if (!isDemo() && (await pool.query("SELECT to_regclass('public.demo_state') AS name")).rows[0].name)
  throw Error('Demo-Datenbank darf nicht als Produktion gestartet werden. Separate Installation verwenden.');
await pool.query(
  'CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
);
for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout=0');
    await client.query('SELECT pg_advisory_xact_lock(729382)');
    if (!(await client.query('SELECT 1 FROM migrations WHERE name=$1', [file])).rowCount) {
      await client.query(await readFile(`migrations/${file}`, 'utf8'));
      await client.query('INSERT INTO migrations(name) VALUES($1)', [file]);
      console.log(`Applied ${file}`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
await maintainDemo();
await pool.end();

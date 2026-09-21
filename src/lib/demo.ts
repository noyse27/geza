import { readFile } from 'node:fs/promises';
import { pool } from './db';
import { dataTables, decodeArchive } from './transfer-format';
import { hashPassword } from './security';
import { isDemo, demoResetMinutes } from './demo-mode';

// Only this operator-owned, bundled archive can reset the demo. Never accept an upload here.
export async function maintainDemo() {
  if (!isDemo()) return;
  const archive = decodeArchive(await readFile('demo.geza'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS demo_state(id integer PRIMARY KEY CHECK(id=1), reset_at timestamptz NOT NULL)',
    );
    const state = (await client.query('SELECT reset_at FROM demo_state WHERE id=1')).rows[0];
    if (state && new Date(state.reset_at).getTime() > Date.now()) {
      await client.query('COMMIT');
      return;
    }
    if (!state) {
      for (const table of [...dataTables, 'admin_account', 'settings', 'setup_restore']) {
        if ((await client.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rowCount)
          throw Error(
            'Demo benötigt eine eigene, leere Datenbank. Bestehende Installation bleibt unverändert.',
          );
      }
    }
    await client.query(
      `TRUNCATE ${[...dataTables, 'admin_account', 'settings', 'setup_restore', 'sessions', 'login_attempts', 'event_logs'].join(',')} RESTART IDENTITY`,
    );
    for (const table of dataTables) {
      if (archive.tables[table].length)
        await client.query(
          `INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}",$1::json)`,
          [JSON.stringify(archive.tables[table])],
        );
      const sequences = (
        await client.query(
          `SELECT column_name,pg_get_serial_sequence($1,column_name) AS seq FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
          [table],
        )
      ).rows;
      for (const column of sequences)
        if (column.seq)
          await client.query(
            `SELECT setval($1,COALESCE((SELECT max("${column.column_name}") FROM "${table}"),0)+1,false)`,
            [column.seq],
          );
    }
    await client.query('INSERT INTO admin_account VALUES(1,$1,$2)', ['admin', hashPassword('admin')]);
    await client.query(
      "INSERT INTO demo_state VALUES(1,now()+$1*interval '1 minute') ON CONFLICT(id) DO UPDATE SET reset_at=excluded.reset_at",
      [demoResetMinutes()],
    );
    await client.query('COMMIT');
    console.log('Demo auf Ausgangszustand zurückgesetzt.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

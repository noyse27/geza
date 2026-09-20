import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pool } from '../src/lib/db';
import { SETUP_LOCK } from '../src/lib/setup';
import { hashPassword } from '../src/lib/security';

// Local recovery for a lost setup cookie. Never resets or replaces an existing admin.
if (!process.stdin.isTTY)
  throw Error(
    'Bitte interaktiv ausführen: docker compose exec -it app node --import tsx scripts/finish-restore.ts',
  );
let hidden = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!hidden) process.stdout.write(chunk);
    done();
  },
});
const terminal = createInterface({ input: process.stdin, output, terminal: true });
try {
  const pending = await pool.query(
    'SELECT 1 FROM setup_restore WHERE NOT EXISTS (SELECT 1 FROM admin_account)',
  );
  if (!pending.rowCount) throw Error('Keine unvollständige Wiederherstellung ohne Admin vorhanden.');
  const username = (await terminal.question('Neuer Admin-Benutzername: ')).trim();
  process.stdout.write('Neues Passwort (mindestens 12 Zeichen, Eingabe unsichtbar): ');
  hidden = true;
  const password = await terminal.question('');
  process.stdout.write('\nPasswort wiederholen: ');
  const confirm = await terminal.question('');
  hidden = false;
  process.stdout.write('\n');
  if (
    username.length < 3 ||
    username.length > 100 ||
    password.length < 12 ||
    password.length > 512 ||
    password !== confirm
  )
    throw Error('Ungültige Eingaben oder Passwörter stimmen nicht überein. Keine Änderung vorgenommen.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SETUP_LOCK]);
    if (
      !(await client.query('SELECT 1 FROM setup_restore WHERE NOT EXISTS (SELECT 1 FROM admin_account)'))
        .rowCount
    )
      throw Error('Die Einrichtung wurde inzwischen abgeschlossen.');
    await client.query('INSERT INTO admin_account(id,username,password_hash) VALUES(1,$1,$2)', [
      username,
      hashPassword(password),
    ]);
    await client.query('DELETE FROM setup_restore');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  console.log('Wiederherstellung abgeschlossen. Anmeldung mit dem neuen Admin ist jetzt möglich.');
} finally {
  terminal.close();
  await pool.end();
}

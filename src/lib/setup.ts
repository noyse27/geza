import { pool, query } from './db';
import { digest, hashPassword } from './security';
export const SETUP_LOCK = 729383;
export async function installationReady() {
  return !!(await query('SELECT 1 FROM admin_account WHERE id=1')).length;
}
export async function createInitialAdmin(username: string, password: string, owner: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SETUP_LOCK]);
    if ((await client.query('SELECT 1 FROM admin_account')).rowCount)
      throw Error('Der Admin wurde bereits angelegt.');
    const pending = (await client.query('SELECT owner_hash FROM setup_restore WHERE id=1')).rows[0];
    if (pending && (!owner || pending.owner_hash !== digest(owner)))
      throw Error('Bitte die Wiederherstellung im ursprünglichen Browser abschließen.');
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
}

import pg from 'pg';
const globalDb = globalThis as unknown as { gezaPool?: pg.Pool };
export const pool =
  globalDb.gezaPool ??
  new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, statement_timeout: 8000 });
if (!globalDb.gezaPool)
  // pg crashes the process on an unhandled 'error' event from an idle client (e.g. the
  // backend terminating a connection); log and keep the pool alive instead.
  pool.on('error', (err) => console.error('Unerwarteter Fehler auf einer inaktiven DB-Verbindung:', err));
globalDb.gezaPool = pool;
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await pool.query<T>(sql, values)).rows;
}

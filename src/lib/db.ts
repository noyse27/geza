import pg from 'pg';
const globalDb = globalThis as unknown as { gezaPool?: pg.Pool };
export const pool =
  globalDb.gezaPool ??
  new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, statement_timeout: 8000 });
globalDb.gezaPool = pool;
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await pool.query<T>(sql, values)).rows;
}

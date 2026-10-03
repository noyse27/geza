import { pool } from '../src/lib/db';
import { assertFacetRecoveryIdle, reprojectFacets } from '../src/lib/facets';
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SET LOCAL statement_timeout=120000');
  await client.query('SELECT pg_advisory_xact_lock(729383)');
  await assertFacetRecoveryIdle(client);
  for (const category of ['country', 'genre'] as const)
    console.log(
      `${category}: ${await reprojectFacets(client, category)} Titel aus Originalwerten aktualisiert.`,
    );
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}

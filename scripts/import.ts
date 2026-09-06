import { importTrakt } from '../src/lib/importer';
import { pool } from '../src/lib/db';
const path = process.argv[2];
if (!path) throw new Error('Usage: npm run import:trakt -- /path/to/export');
try {
  console.log(JSON.stringify(await importTrakt(path), null, 2));
} finally {
  await pool.end();
}

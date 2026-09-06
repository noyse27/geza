import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const name = `geza_perf_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
let target: pg.Pool | undefined;
try {
  await source.query(`CREATE DATABASE ${name}`);
  target = new pg.Pool({ connectionString: url.toString(), max: 8 });
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await target.query(await readFile('migrations/' + file, 'utf8'));
  const rows = (
    await source.query(
      'SELECT kind,title,original_title,year,summary,countries,genres,directors,actors FROM media',
    )
  ).rows;
  for (let copy = 0; copy < 10; copy++) {
    await target.query(
      `INSERT INTO media(kind,title,original_title,year,summary,countries,genres,directors,actors)
   SELECT kind,title,original_title,year,summary,countries,genres,directors,actors FROM jsonb_to_recordset($1::jsonb) AS x(kind text,title text,original_title text,year integer,summary text,countries text[],genres text[],directors text[],actors text[])`,
      [JSON.stringify(rows)],
    );
  }
  await target.query('ANALYZE media');
  // Load the application's pool only after switching to the isolated test database.
  process.env.DATABASE_URL = url.toString();
  const { searchCatalog } = await import('../src/lib/catalog');
  const { pool } = await import('../src/lib/db');
  const samples: number[] = [];
  for (let round = 0; round < 10; round++)
    await Promise.all(
      ['dark', 'arrival', 'star', 'alien', 'sherlock'].map(async (q) => {
        const start = performance.now();
        await searchCatalog(new URLSearchParams({ q, live: '1' }), false);
        samples.push(performance.now() - start);
      }),
    );
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        media: rows.length * 10,
        concurrent: 5,
        samples: samples.length,
        p50_ms: Math.round(samples[25]),
        p95_ms: Math.round(samples[47]),
        max_ms: Math.round(samples.at(-1)!),
      },
      null,
      2,
    ),
  );
  await pool.end();
} finally {
  await target?.end();
  // Only this script's freshly generated, isolated database is removed.
  if (/^geza_perf_\d+$/.test(name)) await source.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await source.end();
}

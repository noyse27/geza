import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const name = `geza_test_classification_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
let target: pg.Pool | undefined;
try {
  await source.query(`CREATE DATABASE ${name}`);
  target = new pg.Pool({ connectionString: url.toString() });
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    if (file.startsWith('019_'))
      await target.query(
        "INSERT INTO media(kind,title,bucketlist,manual_entry) VALUES('movie','Legacy manual',true,true),('movie','Legacy automatic',true,false)",
      );
    await target.query(await readFile('migrations/' + file, 'utf8'));
  }
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--test', 'tests/classification.test.ts'], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (code !== 0) throw Error('Classification regression failed');
} finally {
  await target?.end();
  await source.query(`DROP DATABASE IF EXISTS ${name}`);
  await source.end();
}

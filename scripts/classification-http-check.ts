import assert from 'node:assert/strict';
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import AdmZip from 'adm-zip';

const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const name = `geza_test_http_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
let app: ChildProcess | undefined;
let target: pg.Pool | undefined;
let appPool: pg.Pool | undefined;
let output = '';
const base = 'http://127.0.0.1:32119';
const plex = createServer((req, res) => {
  const path = new URL(req.url!, 'http://localhost').pathname;
  const data =
    path === '/library/sections'
      ? { Directory: [{ key: '1', title: 'Serien', type: 'show' }] }
      : path === '/library/sections/1/all'
        ? {
            Metadata: [
              { type: 'show', title: 'HTTP Serie', ratingKey: 's', Guid: [{ id: 'tvdb://990101' }] },
            ],
          }
        : path === '/library/metadata/s/allLeaves'
          ? {
              Metadata: [
                { type: 'episode', title: 'Folge 1', parentIndex: 1, index: 1, viewCount: 1 },
                { type: 'episode', title: 'Folge 2', parentIndex: 2, index: 1, viewCount: 0 },
              ],
            }
          : null;
  res.writeHead(data ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ MediaContainer: data }));
});
try {
  await source.query(`CREATE DATABASE ${name}`);
  target = new pg.Pool({ connectionString: url.toString() });
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    await target.query(await readFile('migrations/' + file, 'utf8'));
  process.env.DATABASE_URL = url.toString();
  process.env.SESSION_SECRET = 'classification-http-test-secret-long-enough';
  const { pool, query } = await import('../src/lib/db');
  appPool = pool;
  const { hashPassword } = await import('../src/lib/security');
  const { setSetting } = await import('../src/lib/settings');
  await query('INSERT INTO admin_account VALUES(1,$1,$2)', [
    'testadmin',
    hashPassword('test-password-for-http'),
  ]);
  await new Promise<void>((resolve) => plex.listen(0, '127.0.0.1', resolve));
  await setSetting('PLEX_URL', `http://127.0.0.1:${(plex.address() as { port: number }).port}`);
  await setSetting('PLEX_TOKEN', 'test');
  app = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '32119'],
    {
      env: { ...process.env, GEZA_MODE: 'production', PUBLIC_URL: base },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  app.stdout?.on('data', (data) => (output = (output + data).slice(-6000)));
  app.stderr?.on('data', (data) => (output = (output + data).slice(-6000)));
  for (let i = 0; i < 100; i++) {
    if (app.exitCode !== null) throw Error(output);
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ username: 'testadmin', password: 'test-password-for-http' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const headers = { 'Content-Type': 'application/json', Origin: base, Cookie: cookie };
  const admin = await (await fetch(base + '/admin', { headers: { Cookie: cookie } })).text();
  assert.ok(admin.includes('Einordnung nach dem Import'));
  assert.ok(admin.includes('Änderungen vorab prüfen'));
  assert.ok(admin.includes('Alle Bibliotheken'));
  const unauth = await fetch(base + '/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ action: 'plex-scan-preview' }),
  });
  assert.equal(unauth.status, 401);
  const preview = await fetch(base + '/api/admin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'plex-scan-preview' }),
  });
  assert.equal(preview.status, 200);
  assert.ok((await preview.json()).preview.changed > 0);
  assert.equal((await query('SELECT count(*) AS n FROM media'))[0].n, '0');
  const { processPlexScan } = await import('../src/lib/plex-scan');
  await processPlexScan({ manual: true });
  const bucket = await (await fetch(base + '/bucketlist', { headers: { Cookie: cookie } })).text();
  assert.ok(bucket.includes('Staffel 2'));
  const [season] = await query("SELECT id FROM media WHERE kind='season' AND season=2");
  const detail = await (await fetch(base + '/title/' + season.id, { headers: { Cookie: cookie } })).text();
  assert.ok(detail.includes('Automatisch einordnen'));
  const excluded = await fetch(base + '/api/admin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'bucketlist-preference', id: season.id, preference: 'exclude' }),
  });
  assert.equal(excluded.status, 200);
  assert.equal((await query('SELECT bucketlist FROM media WHERE id=$1', [season.id]))[0].bucketlist, false);
  const zip = new AdmZip();
  zip.addFile(
    'watchlist.json',
    Buffer.from(JSON.stringify([{ movie: { title: 'HTTP Wunsch', ids: { trakt: 991100 } } }])),
  );
  const form = new FormData();
  form.set('file', new File([new Uint8Array(zip.toBuffer())], 'trakt.zip'));
  form.set('preview', '1');
  const upload = await fetch(base + '/api/import/trakt', {
    method: 'POST',
    headers: { Origin: base, Cookie: cookie },
    body: form,
  });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).report.dryRun, true);
  assert.equal((await query('SELECT 1 FROM media WHERE trakt_id=991100')).length, 0);
  form.delete('preview');
  const imported = await fetch(base + '/api/import/trakt', {
    method: 'POST',
    headers: { Origin: base, Cookie: cookie },
    body: form,
  });
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).report.plexFollowup, 'queued');
  assert.equal((await query('SELECT bucketlist FROM media WHERE trakt_id=991100'))[0].bucketlist, true);
  console.log(
    'HTTP checks passed: authenticated admin, preview rollback, season bucketlist, manual exclusion, ZIP preview/import and Plex follow-up.',
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (app?.pid && app.exitCode === null) {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else app.kill('SIGTERM');
  }
  plex.close();
  await appPool?.end();
  await target?.end();
  await source.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await source.end();
}

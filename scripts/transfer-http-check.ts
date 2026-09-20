import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { dataTables, newTransferKey, decodeArchive } from '../src/lib/transfer-format';

// Requires a production build. Uses a dedicated temporary DB and localhost-only server.
const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const name = `geza_transfer_http_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL!);
url.pathname = '/' + name;
const port = Number(process.env.GEZA_TEST_PORT || 33089),
  base = `http://127.0.0.1:${port}`;
let target: pg.Pool | undefined, app: ReturnType<typeof spawn> | undefined;
let output = '';
try {
  await source.query(`CREATE DATABASE ${name}`);
  target = new pg.Pool({ connectionString: url.toString() });
  await target.query('CREATE TABLE migrations(name text PRIMARY KEY)');
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    await target.query(await readFile('migrations/' + file, 'utf8'));
    await target.query('INSERT INTO migrations(name) VALUES($1)', [file]);
  }
  app = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
    {
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        SESSION_SECRET: 'test-http-installation-secret-32-characters',
        PUBLIC_URL: base,
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  app.stdout?.on('data', (b) => {
    output = (output + b).slice(-5000);
  });
  app.stderr?.on('data', (b) => {
    output = (output + b).slice(-5000);
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(base + '/api/health')).ok;
    } catch {}
    if (ready) break;
    if (app.exitCode !== null) throw Error('Testserver failed: ' + output);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, output);
  assert.equal((await fetch(base, { redirect: 'manual' })).status, 307);
  assert.equal((await fetch(base + '/api/search')).status, 503);
  const initial = await fetch(base + '/api/setup/transfer');
  const setupCookie = initial.headers.getSetCookie()[0].split(';')[0];
  const jsonPost = (path: string, body: unknown, cookie = '', origin = base) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
      body: JSON.stringify(body),
    });
  const password = 'http-test-long-password';
  const admin = { action: 'setup', username: 'transfer-admin', password, passwordConfirm: password };
  assert.equal((await jsonPost('/api/login', admin, setupCookie, 'https://wrong.example')).status, 403);
  const created = await jsonPost('/api/login', admin, setupCookie);
  assert.equal(created.status, 200);
  const session = created.headers.getSetCookie()[0].split(';')[0];
  await target.query(`INSERT INTO media(id,kind,title) VALUES(1,'movie','HTTP Transfer Test')`);
  // Incompressible cover makes the archive exceed Next proxy's default 10 MiB body clone limit.
  await target.query(
    `INSERT INTO posters(media_id,content_type,data,etag) VALUES(1,'image/png',$1,'large-cover')`,
    [randomBytes(12 * 1024 * 1024)],
  );
  const key = newTransferKey();
  assert.equal((await jsonPost('/api/transfer/export', { key })).status, 403);
  const exported = await jsonPost('/api/transfer/export', { key }, session);
  assert.equal(exported.status, 200);
  const bytes = Buffer.from(await exported.arrayBuffer());
  assert.ok(bytes.length > 10 * 1024 * 1024, 'Exercise a real large multipart upload');
  assert.equal(decodeArchive(bytes).tables.media.length, 1);
  assert.equal((await fetch(base + '/api/setup/transfer')).status, 409);
  const reset = () =>
    target!.query(
      `TRUNCATE ${dataTables.join(',')},settings,admin_account,setup_restore RESTART IDENTITY CASCADE`,
    );
  await reset();
  const upload = (
    action: string,
    opts: Record<string, unknown> = {},
    cookie = setupCookie,
    archive = bytes,
  ) => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(archive)]), 'test.geza');
    form.set(
      'options',
      JSON.stringify({
        action,
        key,
        accounts: true,
        apiKeys: true,
        modules: true,
        withoutKey: false,
        ...opts,
      }),
    );
    return fetch(base + '/api/setup/transfer', {
      method: 'POST',
      headers: { Origin: base, Cookie: cookie },
      body: form,
    });
  };
  assert.equal((await upload('inspect', {}, '')).status, 403);
  const wrong = await upload('inspect', { key: newTransferKey() });
  assert.equal(wrong.status, 200);
  assert.equal((await wrong.json()).unlocked, false);
  assert.equal((await upload('restore', { key: newTransferKey() })).status, 400);
  assert.equal((await target.query('SELECT * FROM media')).rowCount, 0);
  assert.equal((await upload('restore', {}, setupCookie, bytes.subarray(0, 100))).status, 400);
  const restored = await upload('restore', { accounts: false, apiKeys: false, withoutKey: true, key: '' });
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.equal((await restored.json()).needsAdmin, true);
  assert.equal((await fetch(base + '/api/search')).status, 503);
  assert.equal((await jsonPost('/api/login', admin, '')).status, 409);
  assert.equal((await jsonPost('/api/login', admin, setupCookie)).status, 200);
  assert.equal(
    (await jsonPost('/api/transfer/export', { key }, session)).status,
    403,
    'Old destination sessions invalidated',
  );
  await reset();
  const restoredAccount = await upload('restore');
  assert.equal(restoredAccount.status, 200, await restoredAccount.clone().text());
  assert.equal((await jsonPost('/api/login', { username: 'transfer-admin', password })).status, 200);
  assert.equal((await upload('restore')).status, 409);
  console.log(
    'HTTP transfer passed: first-run gate, origin/auth checks, >10 MiB upload, wrong/corrupt keys, media-only completion, old-password login and stale-session rejection.',
  );
} finally {
  if (app && app.exitCode === null) {
    const stopped = once(app, 'exit');
    app.kill();
    await stopped;
  }
  await target?.end();
  await source.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await source.end();
}

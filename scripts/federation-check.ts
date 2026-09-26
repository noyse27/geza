import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

// Requires a production build. Starts two complete instances (own databases, localhost ports).
const source = new pg.Pool({ connectionString: process.env.DATABASE_URL });
source.on('error', (err) => console.error('source pool error', err));
type Instance = {
  name: string;
  base: string;
  db: pg.Pool;
  app: ReturnType<typeof spawn>;
  output: string;
  session: string;
};
const stamp = Date.now();
const basePort = Number(process.env.GEZA_TEST_PORT || 33110);
const instances: Instance[] = [];
async function start(label: string, port: number): Promise<Instance> {
  const name = `geza_fed_${label}_${stamp}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/' + name;
  await source.query(`CREATE DATABASE ${name}`);
  const db = new pg.Pool({ connectionString: url.toString() });
  db.on('error', (err) => console.error('pool error', err));
  await db.query('CREATE TABLE migrations(name text PRIMARY KEY)');
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    await db.query(await readFile('migrations/' + file, 'utf8'));
    await db.query('INSERT INTO migrations(name) VALUES($1)', [file]);
  }
  const base = `http://127.0.0.1:${port}`;
  const app = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
    {
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        SESSION_SECRET: `test-federation-secret-${label}-32-characters-long`,
        PUBLIC_URL: base,
        FEDERATION_ALLOW_PRIVATE: '1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const instance: Instance = { name, base, db, app, output: '', session: '' };
  for (const stream of [app.stdout, app.stderr])
    stream?.on('data', (b) => (instance.output = (instance.output + b).slice(-4000)));
  instances.push(instance);
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt++) {
    try {
      ready = (await fetch(base + '/api/health')).ok;
    } catch {
      // still starting
    }
    if (app.exitCode !== null) throw Error('Server failed: ' + instance.output);
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, instance.output);
  const password = 'federation-test-password';
  const created = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      action: 'setup',
      username: 'admin-' + label,
      password,
      passwordConfirm: password,
      nickname: label === 'a' ? '' : 'Bea vom Film',
    }),
  });
  assert.equal(created.status, 200, await created.text());
  instance.session = created.headers.getSetCookie()[0].split(';')[0];
  return instance;
}
const admin = (i: Instance, body: object) =>
  fetch(i.base + '/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: i.base, Cookie: i.session },
    body: JSON.stringify(body),
  });
try {
  const a = await start('a', basePort);
  const b = await start('b', basePort + 1);
  const friends = (i: Instance) => i.db.query('SELECT url,nickname,status FROM friend_instances ORDER BY id');
  const host = (i: Instance) => new URL(i.base).host;

  // Nickname from the setup form; the default is the domain.
  const [{ value }] = (await b.db.query("SELECT value FROM settings WHERE key='INSTANCE_NICKNAME'")).rows;
  assert.ok(value, 'setup stores the optional nickname (encrypted)');
  assert.equal((await fetch(a.base + '/api/federation/info')).status, 200);
  assert.equal((await (await fetch(a.base + '/api/federation/info')).json()).nickname, host(a));
  assert.equal((await (await fetch(b.base + '/api/federation/info')).json()).nickname, 'Bea vom Film');

  // A forged request (right URL, made-up nonce) is not accepted: the callback does not confirm it.
  const forged = await fetch(b.base + '/api/federation/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: a.base, nickname: 'Fälscher', nonce: 'x'.repeat(43) }),
  });
  assert.equal(forged.status, 400);
  assert.equal((await friends(b)).rowCount, 0);
  // Requests to oneself and to non-http targets are rejected before anything is sent.
  assert.equal((await admin(a, { action: 'friend-request', url: a.base })).status, 400);
  assert.equal((await admin(a, { action: 'friend-request', url: 'ftp://example.org' })).status, 400);
  assert.equal((await admin(a, { action: 'friend-request', url: 'http://127.0.0.1:9' })).status, 400);

  // A asks B: B sees an incoming request, A an outgoing one.
  assert.equal((await admin(a, { action: 'friend-request', url: b.base })).status, 200);
  assert.deepEqual((await friends(a)).rows, [{ url: b.base, nickname: host(b), status: 'outgoing' }]);
  assert.deepEqual((await friends(b)).rows, [{ url: a.base, nickname: host(a), status: 'incoming' }]);
  // Pending friends get no data.
  const anonymous = await fetch(b.base + '/api/federation/lookup?kind=movie&tmdb=42');
  assert.equal(anonymous.status, 401);
  const badToken = await fetch(b.base + '/api/federation/lookup?kind=movie&tmdb=42', {
    headers: { Authorization: 'Bearer ' + 'y'.repeat(43) },
  });
  assert.equal(badToken.status, 401);

  // B accepts and transmits its nickname.
  const incoming = (await b.db.query("SELECT id FROM friend_instances WHERE status='incoming'")).rows[0].id;
  assert.equal((await admin(b, { action: 'friend-accept', id: incoming })).status, 200);
  assert.deepEqual((await friends(a)).rows, [{ url: b.base, nickname: 'Bea vom Film', status: 'accepted' }]);
  assert.equal((await friends(b)).rows[0].status, 'accepted');

  // The same movie exists on both; only B has a rating and a public review.
  const movieOn = async (i: Instance) =>
    (
      await i.db.query(
        `INSERT INTO media(kind,title,year,ids) VALUES('movie','Gemeinsamer Film',2001,'{"tmdb":"4242"}') RETURNING id`,
      )
    ).rows[0].id as string;
  const movieA = await movieOn(a);
  const movieB = await movieOn(b);
  // Titles without any rating, review or watch are moved to the Rumpelkammer and hidden.
  await a.db.query('INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,5,now(),$2)', [
    movieA,
    'geza',
  ]);
  const page = async () => (await fetch(`${a.base}/title/${movieA}`)).text();
  assert.ok(!(await page()).includes('Bei befreundeten Instanzen'), 'nothing to show yet');
  await a.db.query('DELETE FROM friend_instance_cache');
  await b.db.query('INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,8,now(),$2)', [
    movieB,
    'geza',
  ]);
  await b.db.query(
    "INSERT INTO reviews(media_id,source,source_id,body,is_public) VALUES($1,'geza','r1','Geheimer Reviewtext',true)",
    [movieB],
  );
  await b.db.query(
    "INSERT INTO reviews(media_id,source,source_id,body,is_public) VALUES($1,'geza','r2','Privater Entwurf',false)",
    [movieB],
  );
  let html = await page();
  assert.ok(html.includes('Bei befreundeten Instanzen'), 'friend answer is shown');
  assert.ok(html.includes('Bea vom Film'));
  assert.ok(html.includes('Review vorhanden'));
  assert.ok(html.includes(`${b.base}/title/${movieB}`), 'links to the record on the friend instance');
  assert.ok(!html.includes('Geheimer Reviewtext') && !html.includes('Privater Entwurf'));
  // Rumpel and bucketlist titles are never answered.
  await b.db.query('UPDATE media SET bucketlist=true WHERE id=$1', [movieB]);
  await a.db.query('DELETE FROM friend_instance_cache');
  assert.ok(!(await page()).includes('Bea vom Film'));
  await b.db.query('UPDATE media SET bucketlist=false WHERE id=$1', [movieB]);
  await a.db.query('DELETE FROM friend_instance_cache');

  // The other direction works with the same friendship.
  assert.ok((await (await fetch(`${b.base}/title/${movieB}`)).text()).includes(host(a)));

  // A dead friend does not break the page and keeps the last answer.
  const [row] = (await a.db.query('SELECT id FROM friend_instances')).rows;
  assert.ok((await page()).includes('Bea vom Film'), 'answer is cached');
  await a.db.query("UPDATE friend_instance_cache SET fetched_at=now()-interval '7 hours'");
  b.app.kill();
  await new Promise((resolve) => b.app.once('exit', resolve));
  const started = Date.now();
  html = await page();
  assert.ok(Date.now() - started < 4000, 'slow or missing friends must not block the page');
  assert.ok(html.includes('Bea vom Film'), 'stale answer stays visible');
  assert.equal(
    (await a.db.query('SELECT error FROM friend_instance_cache WHERE friend_id=$1', [row.id])).rows[0].error,
    true,
  );
  console.log('Federation checks passed: handshake, forged requests, nickname, lookup privacy, outage.');
} finally {
  for (const i of instances) i.app.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const i of instances) {
    await i.db.end().catch(() => undefined);
    await source.query(`DROP DATABASE IF EXISTS ${i.name} WITH (FORCE)`).catch(() => undefined);
  }
  await source.end();
}

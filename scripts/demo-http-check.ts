import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import AdmZip from 'adm-zip';
import { dataTables } from '../src/lib/transfer-format';

// Only run against the disposable geza-demo-test Compose project.
if (process.env.GEZA_DEMO_TEST !== '1')
  throw Error('Requires GEZA_DEMO_TEST=1 and an isolated test installation.');
const base = process.env.GEZA_TEST_URL || 'http://127.0.0.1:33081';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let cookie = '';
async function request(path: string, body?: unknown) {
  return fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: base,
      Cookie: cookie,
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    redirect: 'manual',
  });
}
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of [...dataTables, 'settings', 'admin_account']) {
    result[table] = (
      await db.query(`SELECT row_to_json(t) AS row FROM "${table}" t ORDER BY row_to_json(t)::text`)
    ).rows;
  }
  return result;
}
async function login() {
  const response = await request('/api/login', { username: 'admin', password: 'admin' });
  assert.equal(response.status, 200, await response.clone().text());
  cookie = response.headers.get('set-cookie')!.split(';')[0];
  assert.ok(cookie.startsWith('geza_session='));
}
async function resetByWorker() {
  await db.query("UPDATE demo_state SET reset_at=now()-interval '1 second'");
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if ((await db.query('SELECT reset_at>now() AS reset FROM demo_state')).rows[0].reset) return;
  }
  assert.fail('worker did not reset within 20 seconds');
}
try {
  await resetByWorker();
  const seeded = await snapshot();
  assert.equal((await db.query('SELECT count(*)::int AS n FROM media')).rows[0].n, 12);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM jobs WHERE status='failed'")).rows[0].n, 3);
  assert.equal((await request('/api/admin', { action: 'rating', id: '1', rating: 9 })).status, 401);
  await login();
  for (const path of ['/', '/home', '/admin', '/data', '/title/1', '/collections', '/history']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /Öffentliche Demo/);
    assert.equal(response.headers.get('content-security-policy'), 'frame-ancestors https://www.example.com');
    assert.equal(response.headers.get('x-frame-options'), null);
  }
  console.log('PASS automatic seed, admin login, pages and iframe policy');
  const before = await snapshot();
  for (const action of [
    'settings',
    'enrich',
    'retry',
    'plex-review',
    'plex-review-batch',
    'generate-webhook-secret',
    'review-box-toggle',
  ]) {
    const response = await request('/api/admin', {
      action,
      data: { PLEX_URL: 'http://127.0.0.1:9', PLEX_TOKEN: 'must-not-save' },
    });
    assert.equal(response.status, 403, action);
  }
  for (const path of [
    '/api/setup/transfer',
    '/api/transfer/export',
    '/api/plex/demo-fantasie-plex_webhook_secret',
  ]) {
    assert.equal((await request(path, {})).status, 403, path);
  }
  const zip = new AdmZip();
  zip.addFile(
    'watched-history-demo.json',
    Buffer.from(
      JSON.stringify([
        { id: 991, watched_at: '2026-09-20T18:00:00Z', movie: { title: 'Not saved', ids: { trakt: 99881 } } },
      ]),
    ),
  );
  const form = new FormData();
  form.set('file', new File([new Uint8Array(zip.toBuffer())], 'trakt.zip', { type: 'application/zip' }));
  const preview = await request('/api/import/trakt', form);
  assert.equal(preview.status, 200, await preview.clone().text());
  const { report } = await preview.json();
  assert.equal(report.dryRun, true);
  assert.equal(report.watches, 1);
  assert.equal(report.media, 1);
  const oversized = new FormData();
  oversized.set('file', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.zip'));
  assert.equal((await request('/api/import/trakt', oversized)).status, 413);
  const foreignOrigin = await fetch(base + '/api/admin', {
    method: 'POST',
    headers: { Origin: 'https://untrusted.invalid', Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'rating', id: '1', rating: 9 }),
  });
  assert.equal(foreignOrigin.status, 403);
  assert.deepEqual(await snapshot(), before);
  const archive = await request('/api/demo/download');
  assert.deepEqual(Buffer.from(await archive.arrayBuffer()), await readFile('demo.geza'));
  console.log('PASS provider/import guards, Trakt dry run leaves DB unchanged, demo download');
  const review = await request('/api/admin', {
    action: 'review',
    mediaId: '1',
    data: { body: 'Temporary demo test review', spoiler: false, is_public: true },
  });
  assert.equal(review.status, 200, await review.clone().text());
  assert.equal((await db.query('SELECT count(*)::int AS n FROM reviews')).rows[0].n, 5);
  const scrobble = await request('/api/admin/scrobbles', {
    mediaId: '1',
    jobId: '1',
    eventId: '00000000-0000-4000-8000-000000000001',
    date: '2026-09-21',
    time: '20:00',
  });
  assert.equal(scrobble.status, 200, await scrobble.clone().text());
  assert.equal((await db.query('SELECT status FROM jobs WHERE id=1')).rows[0].status, 'done');
  // Move the scheduled deadline into the past, then let the real worker perform the reset.
  await resetByWorker();
  assert.equal((await request('/api/admin', { action: 'rating', id: '1', rating: 9 })).status, 401);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM reviews')).rows[0].n, 4);
  assert.equal((await db.query('SELECT status FROM jobs WHERE id=1')).rows[0].status, 'failed');
  const after = await snapshot();
  delete seeded.admin_account;
  delete after.admin_account; // Password salt is renewed at reset.
  assert.deepEqual(after, seeded);
  await login();
  assert.equal(
    (
      await request('/api/admin', {
        action: 'review',
        mediaId: '1',
        data: { body: 'Sequence after reset', spoiler: false, is_public: false },
      })
    ).status,
    200,
  );
  await resetByWorker();
  console.log(
    'PASS review creation, scrobble resolution, scheduled worker reset, session invalidation, fresh login and sequences',
  );
} finally {
  await db.end();
}

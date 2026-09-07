import assert from 'node:assert/strict';
import { query, pool } from '../src/lib/db';
import { logContext, loggedFetch } from '../src/lib/logging';
const marker = crypto.randomUUID();
try {
  const r = await fetch('http://127.0.0.1:3080/api/plex/logging-test-invalid-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(r.status, 401);
  const id = r.headers.get('x-request-id');
  const logs = await query("SELECT * FROM event_logs WHERE context->>'requestId'=$1", [id]);
  assert.equal(logs.length, 2);
  assert.equal(logs[1].context.status, 401);
  assert.ok(!JSON.stringify(logs).includes('logging-test-invalid-secret'));
  const get = await fetch('http://127.0.0.1:3080/api/plex/logging-test-invalid-secret');
  assert.equal(get.status, 405);
  const page = await fetch('http://127.0.0.1:3080/admin/logs', { redirect: 'manual' });
  assert.equal(page.status, 307);
  assert.ok(page.headers.get('location')?.includes('/login'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  try {
    await logContext.run({ requestId: marker, title: 'Logging test', mediaId: 'test' }, async () => {
      await assert.rejects(
        loggedFetch('TMDB', 'https://api.themoviedb.org/3/movie/42?api_key=private-value'),
        /TMDB: HTTP 404/,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const provider = await query("SELECT * FROM event_logs WHERE context->>'requestId'=$1", [marker]);
  assert.equal(provider.length, 3);
  assert.ok(provider.every((x) => x.context.title === 'Logging test'));
  assert.ok(!JSON.stringify(provider).includes('private-value'));
  console.log(
    'PASS: webhook rejection + correlation + redaction, GET diagnosis, admin authentication, provider HTTP 404 with title and URL',
  );
} finally {
  await query("DELETE FROM event_logs WHERE context->>'requestId'=$1", [marker]);
  await pool.end();
}

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { query, pool } from '../src/lib/db';
import { digest } from '../src/lib/security';

// Run inside the Docker app: uses only its own temporary title and session.
const base = process.env.TEST_URL || 'http://127.0.0.1:3080';
const token = randomBytes(32).toString('base64url');
const headers = {
  Origin: process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : base,
  Cookie: `geza_session=${token}`,
  'Content-Type': 'application/json',
};
let id: string | undefined;
const post = (action: string, provider: string, data = {}) =>
  fetch(base + '/api/admin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, id, data: { provider, ...data } }),
  });
const page = async (path: string, admin = false) => {
  const response = await fetch(base + path, { headers: admin ? headers : {} });
  assert.equal(response.status, 200);
  return response.text();
};
try {
  await query("INSERT INTO sessions(token_hash,expires_at) VALUES($1,now()+interval '10 minutes')", [
    digest(token),
  ]);
  id = (
    await query("INSERT INTO media(kind,title,year) VALUES('movie',$1,2022) RETURNING id", [
      'Reviewbox test ' + randomBytes(6).toString('hex'),
    ])
  )[0].id;
  const unauthorized = await fetch(base + '/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'friend-review-add', id, data: { provider: 'filmdienst' } }),
  });
  assert.equal(unauthorized.status, 401);
  const forbidden = await fetch(base + '/api/admin', {
    method: 'POST',
    headers: { ...headers, Origin: 'https://invalid.example' },
    body: JSON.stringify({ action: 'friend-review-add', id, data: { provider: 'filmdienst' } }),
  });
  assert.equal(forbidden.status, 403);
  assert.ok(!(await page('/title/' + id)).includes('Reviews bei Freunden'));
  assert.equal((await query('SELECT 1 FROM friend_reviews WHERE media_id=$1', [id])).length, 0);
  const initial = await page('/admin/reviews?id=' + id, true);
  assert.ok(initial.includes('value="filmdienst"'));
  assert.ok(initial.includes('value="wortvogel"'));
  for (const provider of ['filmdienst', 'wortvogel']) {
    assert.equal((await post('friend-review-add', provider)).status, 200);
    assert.equal((await post('friend-review-add', provider)).status, 200);
    const [row] = await query('SELECT * FROM friend_reviews WHERE media_id=$1 AND provider=$2', [
      id,
      provider,
    ]);
    assert.equal(row.manual, provider === 'wortvogel');
    const adminHtml = await page('/admin/reviews?id=' + id, true);
    assert.ok(!adminHtml.includes(`value="${provider}"`));
    assert.ok(adminHtml.includes('Reviewbox löschen'));
    const url =
      provider === 'filmdienst'
        ? 'https://www.filmdienst.de/film/details/123/test'
        : 'https://wortvogel.de/test';
    assert.equal(
      (await post('friend-review', provider, { name: provider, url, rating: 3.5, scale: 5 })).status,
      200,
    );
    const publicHtml = await page('/title/' + id);
    assert.ok(publicHtml.includes(url));
    assert.ok(!publicHtml.includes('Reviewbox löschen'));
    assert.ok(!publicHtml.includes('Link / Angaben bearbeiten'));
    assert.equal((await post('friend-review-delete', provider)).status, 200);
    await page('/title/' + id);
    assert.equal(
      (await query('SELECT 1 FROM friend_reviews WHERE media_id=$1 AND provider=$2', [id, provider])).length,
      0,
    );
    assert.ok((await page('/admin/reviews?id=' + id, true)).includes(`value="${provider}"`));
  }
  assert.equal((await post('friend-review-add', 'filmdienst')).status, 200);
  const [restored] = await query('SELECT * FROM friend_reviews WHERE media_id=$1 AND provider=$2', [
    id,
    'filmdienst',
  ]);
  assert.equal(restored.manual, false);
  assert.equal(restored.url, null);
  assert.equal((await post('friend-review-add', 'unknown')).status, 400);
  await query("UPDATE media SET kind='show' WHERE id=$1", [id]);
  assert.equal((await post('friend-review-add', 'filmdienst')).status, 400);
  console.log(
    'PASS: admin authentication, origin checks, module dropdown, add, duplicate protection, edit, public display, delete, no automatic recreation, re-add and module eligibility.',
  );
} finally {
  if (id) {
    await query("DELETE FROM jobs WHERE payload->>'mediaId'=$1", [String(id)]);
    await query('DELETE FROM media WHERE id=$1', [id]);
  }
  await query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
  await pool.end();
}

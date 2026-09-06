import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.TEST_URL || 'http://localhost:3080';
const password = (await readFile('data/admin-access.txt', 'utf8')).match(/Passwort: (.+)/)![1].trim();
const login = await fetch(base + '/api/login', {
  method: 'POST',
  headers: { Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const result = await (await fetch(base + '/api/search?q=Arrival&live=1')).json();
const id = result.items[0].id;
const provider = 'custom-' + crypto.randomUUID();
const post = (url: string, rating: number | null = 4.5, scale = 5) =>
  fetch(base + '/api/admin', {
    method: 'POST',
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'friend-review',
      id,
      data: { provider, name: 'Geza verification source', url, rating, scale },
    }),
  });
try {
  assert.equal((await post('javascript:alert(1)')).status, 400);
  assert.equal((await post('https://example.org/review', 6, 5)).status, 400);
  assert.equal((await post('https://example.org/review')).status, 200);
  const html = await (await fetch(base + '/title/' + id)).text();
  assert.ok(html.includes('Geza verification source') && html.includes('https://example.org/review'));
  assert.ok(!html.includes('Dein Tagebuch'));
  assert.equal((await post('https://example.org/updated', 8, 10)).status, 200);
  const updated = await (await fetch(base + '/title/' + id)).text();
  assert.ok(updated.includes('https://example.org/updated'));
} finally {
  assert.equal((await post('', null)).status, 200);
  await fetch(base + '/api/logout', { method: 'POST', headers: { Origin: base, Cookie: cookie } });
}
assert.ok(!(await (await fetch(base + '/title/' + id)).text()).includes('Geza verification source'));
console.log('Friend reviews: create, update, public display, delete, URL and scale validation passed.');

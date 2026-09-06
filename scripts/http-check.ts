import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.TEST_URL || 'http://localhost:3080';
for (const path of ['/home', '/history', '/data', '/stats', '/admin']) {
  const r = await fetch(base + path, { redirect: 'manual' });
  assert.equal(r.status, 307, `${path} must require login`);
  assert.equal(r.headers.get('location'), '/login');
}
assert.equal((await fetch(base + '/api/history')).status, 401);
assert.equal(
  (
    await fetch(base + '/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  ).status,
  401,
);
const publicSearch = await (await fetch(base + '/api/search?q=Arrival&live=1')).json();
assert.ok(publicSearch.items.length);
for (const m of publicSearch.items) {
  assert.equal('rating' in m, true);
  assert.equal('watched_at' in m, false);
}
const detail = await (await fetch(base + '/title/' + publicSearch.items[0].id)).text();
assert.ok(!detail.includes('Dein Tagebuch') && !detail.includes('Anschauereignisse'));
const credential = await readFile('data/admin-access.txt', 'utf8'),
  password = credential.match(/Passwort: (.+)/)![1].trim();
assert.equal(
  (
    await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' },
      body: JSON.stringify({ username: 'admin', password }),
    })
  ).status,
  403,
);
const login = await fetch(base + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ username: 'admin', password }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const headers = { Cookie: cookie };
for (const path of ['/home', '/history', '/data', '/stats', '/admin'])
  assert.equal((await fetch(base + path, { headers })).status, 200, path);
const h = await (await fetch(base + '/api/history?month=2020-04', { headers })).json();
assert.equal(h.items.length, 50);
assert.ok(
  h.items.every((m: { watched_at: string }) => Date.parse(m.watched_at) < Date.parse('2020-04-30T22:00:00Z')),
);
assert.ok(h.cursor);
const firstIds = new Set(h.items.map((m: { watch_id: string }) => m.watch_id));
const h2 = await (
  await fetch(base + '/api/history?month=2020-04&cursor=' + encodeURIComponent(h.cursor), { headers })
).json();
assert.ok(h2.items.every((m: { watch_id: string }) => !firstIds.has(m.watch_id)));
const privateDetail = await (await fetch(base + '/title/' + publicSearch.items[0].id, { headers })).text();
assert.ok(privateDetail.includes('Dein Tagebuch'));
const logout = await fetch(base + '/api/logout', { method: 'POST', headers: { ...headers, Origin: base } });
assert.equal(logout.status, 200);
assert.equal((await fetch(base + '/api/history', { headers })).status, 401);
console.log(
  'HTTP checks passed: public/private isolation, login, CSRF, all private pages, month navigation, pagination, logout.',
);
const samples: number[] = [];
for (let batch = 0; batch < 10; batch++)
  await Promise.all(
    ['dark', 'arrival', 'star', 'tt11366674', 'sherlock'].map(async (q) => {
      const start = performance.now();
      const r = await fetch(base + '/api/search?live=1&q=' + q);
      await r.json();
      assert.equal(r.status, 200);
      samples.push(performance.now() - start);
    }),
  );
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      mode: 'Docker HTTP, 5 concurrent searches',
      samples: samples.length,
      p50_ms: Math.round(samples[25]),
      p95_ms: Math.round(samples[47]),
      max_ms: Math.round(samples.at(-1)!),
    },
    null,
    2,
  ),
);

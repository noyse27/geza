import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
  safeNext,
  watchedTime,
  xmlEscape,
  encrypt,
  decrypt,
} from '../src/lib/security';
import { plexIds } from '../src/lib/plex';
test('passwords are salted and wrong passwords are rejected', () => {
  const a = hashPassword('long-test-password'),
    b = hashPassword('long-test-password');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('long-test-password', a), true);
  assert.equal(verifyPassword('wrong', a), false);
});
test('redirects remain local', () => {
  for (const value of ['//evil.test', 'https://evil.test', '/\\evil.test', null])
    assert.equal(safeNext(value), '/home');
  assert.equal(safeNext('/history?month=2020-04'), '/history?month=2020-04');
});
test('unknown epoch timestamps are preserved separately, not invented', () => {
  assert.equal(watchedTime('1970-01-01T00:00:00.000Z'), null);
  assert.equal(watchedTime('invalid'), null);
  assert.equal(watchedTime('2020-04-03T12:00:00Z'), '2020-04-03T12:00:00.000Z');
});
test('provider IDs remain typed and season/episode zero remains possible', () => {
  assert.deepEqual(
    plexIds({ guid: 'plex://episode/abc', Guid: [{ id: 'tmdb://123' }, { id: 'tvdb://456' }] }),
    { plex: 'abc', tmdb: '123', tvdb: '456' },
  );
});
test('stored secrets are authenticated and XML is escaped', () => {
  process.env.SESSION_SECRET = 'a'.repeat(40);
  const value = encrypt('private-provider-token');
  assert.equal(decrypt(value), 'private-provider-token');
  assert.ok(!value.includes('private-provider-token'));
  assert.throws(() => decrypt(value.slice(0, -4) + 'AAAA'));
  assert.equal(xmlEscape('A&B <C>'), 'A&amp;B &lt;C&gt;');
});

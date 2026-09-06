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
import { friendUrl, parseFilmdienst } from '../src/lib/friend-reviews';
import { plexImdbRating } from '../src/lib/provider-ratings';

test('external review links cannot use scripts or impersonate the fixed providers', () => {
  assert.throws(() => friendUrl('wortvogel', 'https://wortvogel.de.evil.test/review'));
  assert.throws(() => friendUrl('custom-test', 'javascript:alert(1)'));
  assert.throws(() => friendUrl('filmdienst', 'https://www.filmdienst.de/suche/alle'));
  assert.equal(friendUrl('custom-test', 'https://example.org/review'), 'https://example.org/review');
  assert.equal(friendUrl('wortvogel', ''), null);
});
test('Filmdienst requires matching title and production year, preserves half-stars', () => {
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify({
      '@type': 'Movie',
      name: 'Lola (2022)',
      copyrightYear: 2022,
      review: { reviewRating: { bestRating: 5, ratingValue: 3.5 } },
    }) +
    '</script>';
  assert.deepEqual(parseFilmdienst(html, ['LOLA'], 2022), { rating: 3.5 });
  assert.equal(parseFilmdienst(html, ['LOLA'], 1981), null);
  assert.equal(parseFilmdienst(html, ['Other movie'], 2022), null);
  const identified = html + '<a href="https://www.imdb.com/title/tt11366674">IMDb</a>';
  assert.deepEqual(parseFilmdienst(identified, ['LOLA'], 2023, 'tt11366674'), { rating: 3.5 });
  assert.equal(parseFilmdienst(identified, ['LOLA'], 2022, 'tt12345'), null);
});
test('IMDb community rating never comes from personal or unrelated ratings', () => {
  assert.equal(
    plexImdbRating({ userRating: 10, rating: 9, ratingImage: 'rottentomatoes://image.rating' }),
    null,
  );
  assert.equal(plexImdbRating({ audienceRating: 7.3, audienceRatingImage: 'imdb://image.rating' }), 7.3);
  assert.equal(plexImdbRating({ Rating: [{ image: 'imdb://image.rating', value: 6.5 }] }), 6.5);
});
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

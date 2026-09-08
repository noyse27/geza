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
import { friendUrl, parseFilmdienst, parseWortvogel } from '../src/lib/friend-reviews';
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
test('Filmdienst falls back to the rendered star rating when the JSON-LD review omits it', () => {
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify({ '@type': 'Movie', name: 'Stockholm Bloodbath', copyrightYear: 2024 }) +
    '</script>' +
    '<div class="star-rating text-primary" title="1,5 Sterne"><span class="glyphicon glyphicon-star"></span></div>';
  assert.deepEqual(parseFilmdienst(html, ['Stockholm Bloodbath'], 2024), { rating: 1.5 });
  const noStars = html.replace('1,5 Sterne', '');
  assert.deepEqual(parseFilmdienst(noStars, ['Stockholm Bloodbath'], 2024), { rating: null });
});
test('wortvogel.de search results match by title and production year, ignoring spoiler tags', () => {
  const article = (title: string, url: string, year: number) =>
    `<article><h2 class="post-list-title"> <a href="${url}">Kino Kritik: ${title}</a> </h2>` +
    `<p><b> USA ${year}. Regie </b> : Someone.</p></article>`;
  const html = article('Supergirl (spoilerfrei)', 'https://wortvogel.de/2026/06/kino-kritik-supergirl/', 2026);
  assert.deepEqual(parseWortvogel(html, ['Supergirl'], 2026), {
    url: 'https://wortvogel.de/2026/06/kino-kritik-supergirl/',
    rating: null,
  });
  assert.equal(parseWortvogel(html, ['Supergirl'], 1984), null);
  assert.equal(parseWortvogel(html, ['Other movie'], 2026), null);
  const ambiguous =
    article('THE FLASH (no spoilers)', 'https://wortvogel.de/a/', 2023) +
    article('THE FLASH', 'https://wortvogel.de/b/', 1990);
  assert.equal(parseWortvogel(ambiguous, ['The Flash'], null), null);
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
import { redact } from '../src/lib/logging';

test('diagnostic logs remove credentials while preserving useful provider details', () => {
  const output = JSON.stringify(
    redact({
      token: 'private-token',
      nested: { password: 'private-password' },
      error: new Error('GET https://host/api/plex/private-secret?X-Plex-Token=private-query'),
      url: 'https://user:private-pass@host/movie/42?api_key=private-key&language=de-DE',
      authorization: 'Bearer private-bearer',
      title: 'Example',
      status: 404,
    }),
  );
  assert.ok(!output.includes('private-'));
  assert.ok(output.includes('/movie/42'));
  assert.ok(output.includes('language=de-DE'));
  assert.ok(output.includes('404'));
});

test('bundled review modules constrain automatic discovery to supported media', async () => {
  const { reviewModule, reviewModules } = await import('../src/lib/review-modules');
  assert.equal(new Set(reviewModules.map((module) => module.id)).size, reviewModules.length);
  const filmdienst = reviewModule('filmdienst')!;
  const movie = { kind: 'movie', title: 'LOLA', original_title: '', year: 2022, ids: {} };
  assert.ok(filmdienst.discover);
  assert.ok(filmdienst.supports(movie));
  assert.equal(filmdienst.supports({ ...movie, kind: 'show' }), false);
  assert.equal(filmdienst.supports({ ...movie, year: null }), false);
  const wortvogel = reviewModule('wortvogel')!;
  assert.ok(wortvogel.discover);
  assert.ok(wortvogel.supports(movie));
  assert.equal(wortvogel.supports({ ...movie, kind: 'show' }), false);
  assert.equal(wortvogel.supports({ ...movie, year: null }), false);
  assert.equal(reviewModule('unknown'), undefined);
  assert.equal(
    friendUrl('filmdienst', 'https://www.filmdienst.de/film/details/123/lola'),
    'https://www.filmdienst.de/film/details/123/lola',
  );
  assert.equal(
    friendUrl('wortvogel', 'https://wortvogel.de/2026/06/kino-kritik-supergirl/'),
    'https://wortvogel.de/2026/06/kino-kritik-supergirl/',
  );
});

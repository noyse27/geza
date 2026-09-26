import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plexNumber, resolvePlexEpisodes } from '../src/lib/plex-episodes';

test('Plex numbering accepts numeric strings and specials but never substitutes missing numbers with zero', () => {
  for (const value of [undefined, null, '', false, true, '1.2', -1, 'unknown'])
    assert.equal(plexNumber(value), undefined);
  assert.equal(plexNumber('0'), 0);
  assert.equal(plexNumber('12'), 12);
});
test('Plex numbering resolves episode details and caches season context', async () => {
  const calls: string[] = [];
  const result = await resolvePlexEpisodes(
    { ratingKey: 'show' },
    [
      { type: 'episode', ratingKey: 'e1' },
      { type: 'episode', ratingKey: 'e2', parentRatingKey: 'season', index: '2' },
    ],
    async (key) => {
      calls.push(key);
      if (key === 'e1')
        return { type: 'episode', index: '1', parentRatingKey: 'season', grandparentRatingKey: 'show' };
      if (key === 'season') return { type: 'season', index: '0', parentRatingKey: 'show' };
    },
  );
  assert.deepEqual(
    result.episodes.map((e) => [e.parentIndex, e.index]),
    [
      [0, 1],
      [0, 2],
    ],
  );
  assert.equal(result.issues.length, 0);
  assert.equal(calls.filter((k) => k === 'season').length, 1);
});
test('Unresolvable or foreign episodes are reported instead of guessed from titles', async () => {
  const result = await resolvePlexEpisodes(
    { ratingKey: 'show' },
    [
      { type: 'episode', title: 'S01E01', parentIndex: null, index: 1 },
      { type: 'episode', parentIndex: 1, index: 1, grandparentRatingKey: 'different' },
      { type: 'episode', parentIndex: '2', index: '3' },
    ],
    async () => undefined,
  );
  assert.equal(result.issues.length, 2);
  assert.equal(result.episodes.length, 1);
  assert.equal(result.issues[0].parentIndex, null);
});

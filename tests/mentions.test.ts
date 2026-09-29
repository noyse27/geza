import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMention, decodeMentions, encodeMentions, updateMentions } from '../src/lib/mentions';

test('mention serialization preserves Unicode, punctuation and identity', () => {
  const text = 'Wie Sophie Marceau in Hellraiser II.';
  const mentions = [
    { start: 4, end: 18, kind: 'a' as const, id: 'Sophie Marceau', label: 'Sophie Marceau' },
    { start: 22, end: 35, kind: 'm' as const, id: '123', label: 'Hellraiser II' },
  ];
  assert.deepEqual(decodeMentions(encodeMentions(text, mentions)), { text, mentions });
  assert.equal(decodeMentions('[[geza:m:javascript%3Aalert:bad]]').mentions.length, 0);
  assert.equal(decodeMentions('[[geza:a:%ZZ:bad]]').mentions.length, 0);
});
test('editing inside a mention removes identity; edits before it move its range', () => {
  const mentions = [{ start: 4, end: 8, kind: 'r' as const, id: 'Tony', label: 'Tony' }];
  assert.equal(updateMentions('Wie Tony', 'Wie Toni', mentions).length, 0);
  assert.equal(updateMentions('Wie Tony', 'So wie Tony', mentions)[0].start, 7);
  assert.equal(updateMentions('Wie Tony', 'Wie Tony!', mentions)[0].end, 8);
});
test('triggers require two letters and support names with spaces without matching email', () => {
  assert.equal(activeMention('@aS', 3), null);
  assert.equal(activeMention('mail@mfilm', 10), null);
  assert.equal(activeMention('@aSophie Marceau', 16)?.query, 'Sophie Marceau');
  assert.equal(activeMention('@mHellraiser\nII', 15), null);
});

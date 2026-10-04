import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMention, decodeMentions, encodeMentions, updateMentions } from '../src/lib/mentions';
import { shareDescription, shareTitle, shareExcerpt } from '../src/lib/share-metadata';
import config from '../next.config';

test('social titles prioritize actual ratings and omit missing facts', () => {
  assert.equal(
    shareTitle('The Furious', 2025, 8, ['114 Min.', 'FSK 18']),
    'The Furious (2025) · 8/10 · 114 Min. · FSK 18',
  );
  assert.equal(shareTitle('Film', null, undefined, [null]), 'Film');
});
test('image excerpts decode mentions and never quote spoiler reviews', () => {
  assert.deepEqual(shareExcerpt('Inhalt', { body: 'Von [[geza:r:Name:Name]]', spoiler: false }), {
    label: 'Mein Review',
    text: 'Von Name',
  });
  assert.deepEqual(shareExcerpt('Inhalt', { body: 'Geheimes Ende', spoiler: true }), {
    label: 'Zum Film',
    text: 'Inhalt',
  });
  assert.equal(shareExcerpt('', { body: 'x'.repeat(500), spoiler: false }).text.length, 178);
  assert.deepEqual(shareExcerpt('Inhalt'), { label: 'Zum Film', text: 'Inhalt' });
});

test('share descriptions decode mentions before truncating and preserve rating and spoiler rules', () => {
  const body =
    'Von [[geza:r:Johanna%20Moder:Johanna%20Moder]]\n mit [[geza:a:Sophie%20Marceau:Sophie%20Marceau]] in [[geza:m:123:Hellraiser%20II]].';
  const description = shareDescription('Film', 'Inhalt', 8, { body, spoiler: false });
  assert.equal(description, '★★★★★★★★☆☆ (8/10) — Von Johanna Moder mit Sophie Marceau in Hellraiser II.');
  assert.equal(shareDescription('Film', 'Inhalt', null, { body, spoiler: true }), 'Inhalt');
  assert.equal(shareDescription('Film', '', null), 'Film — Informationen und Reviews auf Geza.');
  assert.equal(
    shareDescription('Film', 'Inhalt', null, { body: body.repeat(10), spoiler: false }).length,
    160,
  );
});

test('blocking metadata includes Meta clients and preserves existing social crawlers', () => {
  for (const agent of [
    'facebookexternalhit/1.1',
    'Facebot',
    'meta-externalagent/1.1',
    'meta-externalfetcher/1.1',
    'Mozilla/5.0 [FBAN/FB4A;FBAV/500.0]',
    'Twitterbot',
    'WhatsApp',
    'Slackbot',
    'Bingbot',
  ])
    assert.ok(config.htmlLimitedBots?.test(agent), agent);
  assert.equal(config.htmlLimitedBots?.test('Mozilla/5.0 Chrome/140.0 Safari/537.36'), false);
});

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

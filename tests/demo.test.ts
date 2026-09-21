import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeArchive, openCredentials } from '../src/lib/transfer-format';
import { verifyPassword } from '../src/lib/security';
import { importTrakt } from '../src/lib/importer';
import { pool } from '../src/lib/db';
import { isDemo, demoResetMinutes } from '../src/lib/demo-mode';
import { createHash } from 'node:crypto';

test('bundled demo has usable credentials, related media, reviews and unresolved scrobbles', async () => {
  const archive = decodeArchive(await readFile('demo.geza'));
  const credentials = openCredentials(archive, '0'.repeat(64));
  assert.equal(credentials.accounts[0].username, 'admin');
  assert.ok(verifyPassword('admin', credentials.accounts[0].password_hash));
  assert.equal(archive.tables.media.length, 12);
  assert.equal(archive.tables.posters.length, 12);
  for (const media of archive.tables.media) {
    assert.equal(media.poster, `/api/posters/${media.id}`);
    const poster = archive.tables.posters.find((p) => p.media_id === media.id);
    assert.ok(poster);
    assert.equal(poster.content_type, 'image/jpeg');
    assert.match(String(poster.data), /^\\x[0-9a-f]+$/);
    const bytes = Buffer.from(String(poster.data).slice(2), 'hex');
    assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    assert.ok(bytes.length > 10000);
    assert.equal(poster.etag, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(media.ids, {});
    assert.equal(media.trakt_id, null);
  }
  const ids = new Set(archive.tables.media.map((m) => m.id));
  for (const table of ['watches', 'ratings', 'reviews'] as const)
    for (const row of archive.tables[table]) assert.ok(ids.has(row.media_id));
  assert.equal(archive.tables.jobs.filter((j) => j.status === 'failed').length, 3);
  assert.ok(archive.tables.reviews.some((r) => !r.is_public));
  assert.ok(Object.values(credentials.settings).every((v) => v.includes('demo-') || v.endsWith('.invalid')));
});

test('demo Trakt preview parses actual rows without opening a database connection', async () => {
  const previous = process.env.GEZA_MODE;
  process.env.GEZA_MODE = 'demo';
  const directory = await mkdtemp(join(tmpdir(), 'geza-demo-test-'));
  const original = pool.connect;
  pool.connect = (() => {
    throw Error('Unexpected database access');
  }) as typeof pool.connect;
  try {
    await writeFile(
      join(directory, 'watched-history-demo.json'),
      JSON.stringify([
        { id: 1, watched_at: '1970-01-01T00:00:00Z', movie: { title: 'Demo', ids: { trakt: 1 } } },
      ]),
    );
    const result = await importTrakt(directory);
    assert.equal(result.watches, 1);
    assert.equal(result.unknownDates, 1);
    assert.equal(result.media, 1);
    assert.equal('dryRun' in result && result.dryRun, true);
  } finally {
    pool.connect = original;
    if (previous === undefined) delete process.env.GEZA_MODE;
    else process.env.GEZA_MODE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('demo mode is opt-in and reset interval is bounded', () => {
  const mode = process.env.GEZA_MODE,
    interval = process.env.DEMO_RESET_MINUTES;
  try {
    delete process.env.GEZA_MODE;
    delete process.env.DEMO_RESET_MINUTES;
    assert.equal(isDemo(), false);
    assert.equal(demoResetMinutes(), 60);
    process.env.DEMO_RESET_MINUTES = '0';
    assert.throws(demoResetMinutes);
  } finally {
    if (mode === undefined) delete process.env.GEZA_MODE;
    else process.env.GEZA_MODE = mode;
    if (interval === undefined) delete process.env.DEMO_RESET_MINUTES;
    else process.env.DEMO_RESET_MINUTES = interval;
  }
});

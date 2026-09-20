import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  dataTables,
  newTransferKey,
  sealCredentials,
  openCredentials,
  encodeArchive,
  decodeArchive,
  type Archive,
} from '../src/lib/transfer-format';
import { hashPassword } from '../src/lib/security';

const key = newTransferKey();
const credentials = {
  accounts: [{ id: 1 as const, username: 'old-admin', password_hash: hashPassword('a-long-test-password') }],
  settings: { TMDB_TOKEN: 'private-token' },
};
function fixture(): Omit<Archive, 'checksum'> {
  return {
    format: 'geza-transfer',
    version: 1,
    exportedAt: new Date().toISOString(),
    migrations: ['014_transfer.sql'],
    tables: Object.fromEntries(dataTables.map((t) => [t, []])) as unknown as Archive['tables'],
    credentials: sealCredentials(credentials, key),
  };
}
test('transfer encrypts credentials independently of readable media and round-trips a formatted key', () => {
  const value = fixture();
  value.tables.media = [{ title: 'Visible movie', id: '9007199254740993' }];
  const bytes = encodeArchive(value),
    plain = gunzipSync(bytes).toString('utf8');
  assert.ok(plain.includes('Visible movie'));
  for (const secret of ['old-admin', 'private-token', credentials.accounts[0].password_hash, key])
    assert.ok(!plain.includes(secret));
  const archive = decodeArchive(bytes);
  assert.deepEqual(
    openCredentials(archive, '  ' + key.toUpperCase().replaceAll('-', ' ') + '\n'),
    credentials,
  );
  assert.throws(() => openCredentials(archive, newTransferKey()), /Schlüssel/);
  assert.throws(() => openCredentials(archive, ''), /Schlüssel/);
});
test('transfer rejects truncated, altered, incomplete and unsupported archives', () => {
  const bytes = encodeArchive(fixture());
  assert.throws(() => decodeArchive(bytes.subarray(0, bytes.length - 3)));
  for (const mutate of [
    (v: any) => {
      v.tables.media.push({ title: 'Changed' });
    },
    (v: any) => {
      delete v.tables.posters;
    },
    (v: any) => {
      v.version = 999;
    },
    (v: any) => {
      v.tables.sessions = [];
    },
  ]) {
    const value = JSON.parse(gunzipSync(bytes).toString());
    mutate(value);
    assert.throws(() => decodeArchive(gzipSync(JSON.stringify(value))));
  }
});
test('credential authentication detects changes even if the archive checksum is recomputed', () => {
  const value = fixture();
  value.credentials.tag = '0'.repeat(32);
  const archive = decodeArchive(encodeArchive(value));
  assert.throws(() => openCredentials(archive, key), /beschädigt/);
});

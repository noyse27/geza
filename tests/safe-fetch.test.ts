import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isPrivateAddress, parsePeerUrl, safeFetchJson } from '../src/lib/safe-fetch';
import { cleanNickname } from '../src/lib/federation';

test('private, loopback and link-local addresses are recognised', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
    'not-an-ip',
  ])
    assert.equal(isPrivateAddress(address), true, address);
  for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
    assert.equal(isPrivateAddress(address), false, address);
});

test('peer URLs must be https without credentials', () => {
  delete process.env.FEDERATION_ALLOW_PRIVATE;
  assert.equal(parsePeerUrl('https://geza.example.org:777/x').origin, 'https://geza.example.org:777');
  assert.throws(() => parsePeerUrl('http://geza.example.org'));
  assert.throws(() => parsePeerUrl('https://user:pass@geza.example.org'));
  assert.throws(() => parsePeerUrl('ftp://geza.example.org'));
  assert.throws(() => parsePeerUrl('kein url'));
});

test('requests to non-public hosts are refused before connecting', async () => {
  delete process.env.FEDERATION_ALLOW_PRIVATE;
  for (const url of [
    'https://127.0.0.1/api',
    'https://[::1]/api',
    'https://192.168.0.10/api',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/api',
  ])
    await assert.rejects(safeFetchJson(url, { timeoutMs: 1000 }), url);
});

test('redirects, oversized and slow answers are errors when private hosts are explicitly allowed', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') return void res.writeHead(302, { Location: 'http://127.0.0.1/' }).end();
    if (req.url === '/big') return void res.end(JSON.stringify({ text: 'x'.repeat(100_000) }));
    if (req.url === '/slow') return void setTimeout(() => res.end('{}'), 1500);
    res.setHeader('Content-Type', 'application/json').end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.FEDERATION_ALLOW_PRIVATE = '1';
  try {
    assert.deepEqual((await safeFetchJson(base + '/ok')).data, { ok: true });
    await assert.rejects(safeFetchJson(base + '/redirect'), /Weiterleitungen/);
    await assert.rejects(safeFetchJson(base + '/big', { maxBytes: 1000 }));
    await assert.rejects(safeFetchJson(base + '/slow', { timeoutMs: 300 }), /Zeitüberschreitung/);
  } finally {
    delete process.env.FEDERATION_ALLOW_PRIVATE;
    server.closeAllConnections();
    server.close();
  }
});

test('nicknames are cleaned', () => {
  assert.equal(cleanNickname('  Anna \n\t der   Film-Freak  '), 'Anna der Film-Freak');
  assert.equal(cleanNickname('x'.repeat(100)).length, 60);
  assert.equal(cleanNickname(undefined, 'host.example'), 'host.example');
  assert.equal(cleanNickname(42, 'fallback'), 'fallback');
});

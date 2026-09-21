import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
const script = resolve('scripts/setup-env.mjs');

test('demo setup completes partial configuration and preserves values and production file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geza-setup-'));
  try {
    const production = 'POSTGRES_PASSWORD=production-do-not-touch\n';
    await writeFile(join(directory, '.env'), production);
    await writeFile(
      join(directory, '.env.demo'),
      '# Demo\nPUBLIC_URL=https://demo.example.com\nPOSTGRES_PASSWORD=\nSESSION_SECRET=keep-existing-session-secret-long-enough\nGEZA_PORT=9081\n',
    );
    const run = () =>
      spawnSync(process.execPath, [script, '--demo'], {
        cwd: directory,
        encoding: 'utf8',
        windowsHide: true,
      });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const content = await readFile(join(directory, '.env.demo'), 'utf8');
    const env = parseEnv(content);
    assert.ok(env.POSTGRES_PASSWORD);
    assert.ok(env.DATABASE_URL);
    assert.match(env.POSTGRES_PASSWORD, /^[a-f0-9]{40}$/);
    assert.equal(env.PUBLIC_URL, 'https://demo.example.com');
    assert.equal(env.SESSION_SECRET, 'keep-existing-session-secret-long-enough');
    assert.equal(env.GEZA_PORT, '9081');
    assert.equal(env.GEZA_MODE, 'demo');
    assert.equal(env.GEZA_ENV_FILE, '.env.demo');
    assert.ok(env.DATABASE_URL.includes(env.POSTGRES_PASSWORD));
    assert.equal(await readFile(join(directory, '.env'), 'utf8'), production);
    assert.ok(!result.stdout.includes(env.POSTGRES_PASSWORD));
    result = run();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\.env\.demo vollständig/);
    assert.equal(await readFile(join(directory, '.env.demo'), 'utf8'), content);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('setup preserves existing credentials and refuses conflicting installation mode', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geza-setup-'));
  try {
    const path = join(directory, '.env.demo');
    await writeFile(path, 'POSTGRES_PASSWORD="keep-this-password"\nGEZA_MODE=production\n');
    const original = await readFile(path, 'utf8');
    let result = spawnSync(process.execPath, [script, '--demo'], {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GEZA_MODE/);
    assert.equal(await readFile(path, 'utf8'), original);
    await writeFile(path, 'POSTGRES_PASSWORD="keep-this-password"\n');
    result = spawnSync(process.execPath, [script, '--demo'], {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parseEnv(await readFile(path, 'utf8')).POSTGRES_PASSWORD, 'keep-this-password');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

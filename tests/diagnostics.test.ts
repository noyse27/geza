import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticEnabled } from '../src/lib/diagnostics';

test('diagnostic logging is opt-in and expires automatically', () => {
  const now = Date.parse('2026-10-11T18:00:00.000Z');
  assert.equal(diagnosticEnabled('', now), false);
  assert.equal(diagnosticEnabled('invalid', now), false);
  assert.equal(diagnosticEnabled('2026-10-11T17:59:59.999Z', now), false);
  assert.equal(diagnosticEnabled('2026-10-11T18:00:00.001Z', now), true);
});

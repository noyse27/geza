import test from 'node:test';
import assert from 'node:assert/strict';
import { webhookHealth } from '../src/lib/webhook-health';

test('webhook health warns only after 48 hours', () => {
  assert.deepEqual(webhookHealth(null, null), { state: 'never' });
  assert.equal(webhookHealth('2026-10-11T18:00:00Z', 47.99).state, 'healthy');

  const stale = webhookHealth('2026-10-08T02:09:24Z', 91.5);
  assert.equal(stale.state, 'stale');
  if (stale.state === 'stale') assert.equal(stale.daysSinceLastReceived, 3);
});

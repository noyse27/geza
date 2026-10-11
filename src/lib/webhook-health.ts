export const WEBHOOK_WARNING_AFTER_HOURS = 48;

export type WebhookHealth =
  | { state: 'healthy'; lastReceivedAt: string; hoursSinceLastReceived: number }
  | { state: 'stale'; lastReceivedAt: string; hoursSinceLastReceived: number; daysSinceLastReceived: number }
  | { state: 'never' };

export function webhookHealth(
  lastReceivedAt: string | null,
  hoursSinceLastReceived: number | null,
): WebhookHealth {
  if (!lastReceivedAt || hoursSinceLastReceived == null) return { state: 'never' };

  const hours = Math.max(0, hoursSinceLastReceived);
  if (hours < WEBHOOK_WARNING_AFTER_HOURS)
    return { state: 'healthy', lastReceivedAt, hoursSinceLastReceived: hours };

  return {
    state: 'stale',
    lastReceivedAt,
    hoursSinceLastReceived: hours,
    daysSinceLastReceived: Math.max(2, Math.floor(hours / 24)),
  };
}

import { getSetting } from './settings';

export const DIAGNOSTIC_LOG_UNTIL = 'DIAGNOSTIC_LOG_UNTIL';

export function diagnosticEnabled(until: string, now = Date.now()) {
  const timestamp = Date.parse(until);
  return Number.isFinite(timestamp) && timestamp > now;
}

export async function diagnosticState() {
  const until = await getSetting(DIAGNOSTIC_LOG_UNTIL);
  return { enabled: diagnosticEnabled(until), until: until || null };
}

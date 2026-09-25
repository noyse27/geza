// Compatibility for previously queued jobs; use the same complete scan.
import { processPlexScan } from './plex-scan';
export const PRESENCE_JOB = 'plex-presence-daily';
export async function processPlexPresence(payload: { manual?: boolean } = {}) {
  return processPlexScan(payload);
}

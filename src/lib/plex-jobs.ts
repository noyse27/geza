import { query } from './db';
import { getSetting } from './settings';

export async function requestPlexScan() {
  // A queued follow-up uses a separate key, so it cannot overwrite an active daily job.
  const queued = await query(`INSERT INTO jobs(kind,dedupe_key,payload,available_at)
    VALUES('plex-scan','plex-scan-manual','{"manual":true}',now())
    ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',available_at=now(),attempts=0,error=NULL
    WHERE jobs.status<>'running' RETURNING id`);
  if (!queued.length)
    await query(`INSERT INTO jobs(kind,dedupe_key,payload,available_at)
    VALUES('plex-scan','plex-scan-followup','{"manual":true}',now())
    ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',available_at=now(),attempts=0,error=NULL
    WHERE jobs.status<>'running'`);
}

export const nextPlexRun = (hour = 3) => {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw Error('Ungültige Scan-Uhrzeit');
  return `((date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') + interval '1 day' + interval '${hour} hours') AT TIME ZONE 'Europe/Berlin')`;
};
export async function scheduleNextScan(id: string, error: string | null = null) {
  const hour = Number((await getSetting('PLEX_SCAN_HOUR')) || '3');
  await query(
    `UPDATE jobs SET status='pending',available_at=${nextPlexRun(hour)},payload='{}',attempts=0,updated_at=now(),error=$2 WHERE id=$1`,
    [id, error],
  );
}

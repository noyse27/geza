import { z } from 'zod';
import { pool, query } from './db';

export const openScrobbleWhere = `kind='plex' AND status='failed' AND payload->>'event'='media.scrobble'`;
export async function openScrobbleCount() {
  return Number((await query(`SELECT count(*) FROM jobs WHERE ${openScrobbleWhere}`))[0].count);
}

const inputSchema = z.object({
  mediaId: z.string().regex(/^[1-9]\d{0,17}$/),
  eventId: z.string().uuid(),
  jobId: z
    .string()
    .regex(/^[1-9]\d{0,17}$/)
    .optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
    .optional(),
});

export async function saveScrobble(input: unknown) {
  const data = inputSchema.parse(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let eventId = data.eventId;
    let source = 'geza';
    let job;
    if (data.jobId) {
      job = (await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [data.jobId])).rows[0];
      if (!job || job.kind !== 'plex' || job.payload.event !== 'media.scrobble')
        throw Error('Dieser Auftrag ist kein Plex-Scrobble.');
      if (job.status === 'done' && job.payload.manualResolution) {
        if (job.payload.manualResolution.mediaId !== data.mediaId)
          throw Error(
            'Dieses Ereignis wurde inzwischen einem anderen Titel zugeordnet. Bitte Liste aktualisieren.',
          );
        await client.query('COMMIT');
        return { saved: true, alreadyResolved: true };
      }
      if (job.status !== 'failed')
        throw Error('Dieser Auftrag ist nicht mehr offen. Bitte Liste aktualisieren.');
      if (typeof job.payload.eventId !== 'string' || !job.payload.eventId)
        throw Error('Dem Auftrag fehlt die Ereignis-ID.');
      eventId = job.payload.eventId;
      source = 'plex';
    }
    const media = (
      await client.query("SELECT id,kind FROM media WHERE id=$1 AND kind IN ('movie','episode') FOR SHARE", [
        data.mediaId,
      ])
    ).rows[0];
    if (!media) throw Error('Bitte einen vorhandenen Film oder eine Episode auswählen.');
    if (job && job.payload.metadata?.type !== media.kind)
      throw Error('Die Auswahl muss zur Medienart des empfangenen Scrobbles passen.');
    // Noon is only a sorting anchor when the user supplied a date without a time.
    const local = `${data.date}T${data.time || '12:00:00'}`;
    const [clock] = (
      await client.query(
        `SELECT to_char(($1::timestamp AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD"T"HH24:MI:SS') AS local`,
        [local],
      )
    ).rows;
    if (clock.local !== (local.length === 16 ? local + ':00' : local))
      throw Error(
        'Diese Uhrzeit existiert wegen der Zeitumstellung in Berlin nicht. Bitte Uhrzeit korrigieren.',
      );
    const result = await client.query(
      `INSERT INTO watches(media_id,source,source_id,watched_at,time_estimated)
       VALUES($1,$2,$3,$4::timestamp AT TIME ZONE 'Europe/Berlin',$5)
       ON CONFLICT(source,source_id) DO NOTHING RETURNING id`,
      [data.mediaId, source, eventId, local, !data.time],
    );
    if (!result.rowCount) {
      const existing = (
        await client.query('SELECT media_id FROM watches WHERE source=$1 AND source_id=$2', [source, eventId])
      ).rows[0];
      if (existing?.media_id !== data.mediaId)
        throw Error('Dieses Ereignis ist bereits einem anderen Titel zugeordnet.');
    }
    if (job)
      await client.query(
        `UPDATE jobs SET status='done',error=NULL,updated_at=now(),payload=payload || jsonb_build_object('manualResolution',jsonb_build_object('mediaId',$2::text,'resolvedAt',now())) WHERE id=$1`,
        [data.jobId, data.mediaId],
      );
    await client.query('INSERT INTO event_logs(level,source,message,context) VALUES($1,$2,$3,$4)', [
      'info',
      'plex',
      job ? 'Offener Scrobble manuell zugeordnet und gespeichert' : 'Scrobble manuell angelegt',
      JSON.stringify({
        requestId: job?.payload.requestId,
        jobId: data.jobId,
        mediaId: data.mediaId,
        eventId,
      }),
    ]);
    await client.query('COMMIT');
    return { saved: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

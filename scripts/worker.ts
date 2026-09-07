import { logContext, logEvent, redact } from '../src/lib/logging';
import { query, pool } from '../src/lib/db';
import { enrichMedia } from '../src/lib/providers';
import { discoverFriendReview } from '../src/lib/friend-reviews';
import { processPlex } from '../src/lib/plex';
let running = true;
process.on('SIGTERM', () => {
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});
console.log('Geza worker ready');
let lastCleanup = 0;
const friendsLoop = (async () => {
  while (running) {
    try {
      await discoverFriendReview();
    } catch (error) {
      await logEvent('error', 'friends', 'Freundesreviews konnten nicht abgefragt werden', { error });
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
})();
while (running) {
  try {
    if (Date.now() - lastCleanup > 3600000) {
      await query("DELETE FROM event_logs WHERE created_at < now() - interval '14 days'");
      lastCleanup = Date.now();
    }
    await query(
      "UPDATE jobs SET status='pending',available_at=now() WHERE status='running' AND updated_at<now()-interval '10 minutes'",
    );
    const jobs = await query(
      `UPDATE jobs SET status='running',attempts=attempts+1,updated_at=now() WHERE id=(SELECT id FROM jobs WHERE status='pending' AND available_at<=now() ORDER BY CASE WHEN kind='plex' THEN 0 ELSE 1 END,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    );
    if (!jobs.length) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const job = jobs[0];
    await logContext.run(
      {
        jobId: job.id,
        requestId: job.payload.requestId,
        mediaId: job.payload.mediaId,
        event: job.payload.event,
        title: job.payload.metadata?.title,
        attempt: job.attempts,
      },
      async () => {
        await logEvent('info', job.kind, 'Verarbeitung gestartet');
        try {
          if (job.kind === 'enrich') await enrichMedia(String(job.payload.mediaId));
          else if (job.kind === 'plex') await processPlex(job.payload);
          else throw Error('Unbekannter Aufgabentyp');
          await query("UPDATE jobs SET status='done',updated_at=now(),error=NULL WHERE id=$1", [job.id]);
          await logEvent('info', job.kind, 'Verarbeitung erfolgreich abgeschlossen');
        } catch (e) {
          await logEvent(
            'error',
            job.kind,
            job.attempts >= 3
              ? 'Verarbeitung endgï¿½ltig fehlgeschlagen'
              : 'Verarbeitung fehlgeschlagen; erneuter Versuch geplant',
            { error: e, retryInSeconds: job.attempts >= 3 ? null : Math.min(300, job.attempts * 30) },
          );
          await query(
            "UPDATE jobs SET status=$1,available_at=now()+($2*interval '1 second'),updated_at=now(),error=$3 WHERE id=$4",
            [
              job.attempts >= 3 ? 'failed' : 'pending',
              Math.min(300, job.attempts * 30),
              String(redact((e as Error).message)).slice(0, 300),
              job.id,
            ],
          );
        }
      },
    );
    await new Promise((r) => setTimeout(r, 250));
  } catch (error) {
    await logEvent('error', 'worker', 'Hintergrundprozess gestï¿½rt; neuer Versuch in 5 Sekunden', { error });
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await friendsLoop;
await pool.end();

import { isDemo } from '../src/lib/demo-mode';
import { maintainDemo } from '../src/lib/demo';
import { logContext, logEvent, redact } from '../src/lib/logging';
import { query, pool } from '../src/lib/db';
import { enrichMedia } from '../src/lib/providers';
import { discoverFriendReview } from '../src/lib/friend-reviews';
import { processPlex, processPlexReviewSync } from '../src/lib/plex';
import { processPlexScan } from '../src/lib/plex-scan';
import { processPlexRestore } from '../src/lib/plex-watch-restore';
import { processPlexPresence } from '../src/lib/plex-presence';
import { nextPlexRun, scheduleNextScan } from '../src/lib/plex-jobs';
import { getSetting } from '../src/lib/settings';
import { installationReady } from '../src/lib/setup';
import { processSeriesCatalog } from '../src/lib/manual-watches';
import { processFacetRecovery, resumeFacetRecovery } from '../src/lib/facet-recovery';
import { runContext, mediaSnapshot, changeOutcome, saveJobResult } from '../src/lib/job-history';
let running = true;
process.on('SIGTERM', () => {
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});
console.log('Geza worker ready');
let lastCleanup = 0;
let lastCatalogSeed = 0;
let plexScanSeeded = false;
let facetRecoveryResumed = false;
const friendsLoop = (async () => {
  while (running) {
    try {
      if (!isDemo() && (await installationReady())) await discoverFriendReview();
    } catch (error) {
      await logEvent('error', 'friends', 'Freundesreviews konnten nicht abgefragt werden', { error });
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
})();
while (running) {
  try {
    if (isDemo()) {
      await maintainDemo();
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (!(await installationReady())) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (Date.now() - lastCleanup > 3600000) {
      await query("DELETE FROM event_logs WHERE created_at < now() - interval '14 days'");
      await query(
        "DELETE FROM job_runs r WHERE r.finished_at < now()-interval '90 days' AND (r.status='done' OR EXISTS(SELECT 1 FROM job_runs newer WHERE newer.job_id=r.job_id AND newer.id>r.id AND newer.status='done')) AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.active_run_id=r.id)",
      );
      lastCleanup = Date.now();
    }
    if (!facetRecoveryResumed) {
      await resumeFacetRecovery();
      facetRecoveryResumed = true;
    }
    if (Date.now() - lastCatalogSeed > 60000 && (await getSetting('TMDB_TOKEN'))) {
      await query(`INSERT INTO jobs(kind,dedupe_key,payload)
        SELECT 'series-catalog','series-catalog:'||id,jsonb_build_object('mediaId',id::text)
        FROM media WHERE kind='show' AND catalog_backfill_before IS NOT NULL
        ON CONFLICT(dedupe_key) DO NOTHING`);
      lastCatalogSeed = Date.now();
    }
    if (!plexScanSeeded) {
      // Seeded here instead of a migration so fresh installs keep an empty jobs table (required by demo setup).
      await query(
        `INSERT INTO jobs(kind,dedupe_key,payload,available_at) VALUES('plex-scan','plex-scan-daily','{}',
          ${nextPlexRun(Number((await getSetting('PLEX_SCAN_HOUR')) || '3'))})
         ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',payload='{}',attempts=0
         WHERE jobs.status IN ('done','failed')`,
      );
      await query("DELETE FROM jobs WHERE dedupe_key='plex-presence-daily' AND status<>'running'");
      plexScanSeeded = true;
    }
    await query(
      "UPDATE job_runs SET status='interrupted',finished_at=now(),error='Worker hat seit mindestens 10 Minuten nicht geantwortet; erneuter Versuch.' WHERE status='running' AND heartbeat_at<now()-interval '10 minutes'",
    );
    await query(
      "UPDATE jobs SET status='pending',available_at=now() WHERE status='running' AND updated_at<now()-interval '10 minutes'",
    );
    const jobs = await query(`WITH claimed AS (
      UPDATE jobs SET status='running',attempts=attempts+1,updated_at=now()
      WHERE id=(SELECT id FROM jobs WHERE status='pending' AND available_at<=now()
      ORDER BY CASE WHEN kind='facet-recovery' THEN -1 WHEN kind='plex' THEN 0 ELSE 1 END,id
      FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *
    ), run AS (
      INSERT INTO job_runs(job_id,kind,attempt) SELECT id,kind,attempts FROM claimed RETURNING id,job_id
    ) SELECT claimed.*,run.id AS run_id FROM claimed JOIN run ON run.job_id=claimed.id`);
    if (!jobs.length) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const job = jobs[0];
    await query('UPDATE jobs SET active_run_id=$2 WHERE id=$1', [job.id, job.run_id]);
    const daily = job.dedupe_key === 'plex-scan-daily';
    const heartbeat = setInterval(() => {
      void query(
        "WITH alive AS (UPDATE jobs SET updated_at=now() WHERE id=$1 AND status='running' AND active_run_id=$2 RETURNING id) UPDATE job_runs SET heartbeat_at=now() WHERE id=$2 AND status='running' AND EXISTS(SELECT 1 FROM alive)",
        [job.id, job.run_id],
      ).catch(() => {});
    }, 30000);
    try {
      await runContext.run({ id: String(job.run_id), lastProgress: 0 }, () =>
        logContext.run(
          {
            jobId: job.id,
            runId: job.run_id,
            requestId: job.payload.requestId,
            mediaId: job.payload.mediaId,
            event: job.payload.event,
            title: job.payload.metadata?.title,
            attempt: job.attempts,
          },
          async () => {
            await logEvent('info', job.kind, 'Verarbeitung gestartet');
            try {
              const measured = ['enrich', 'plex-review-sync'].includes(job.kind) && job.payload.mediaId;
              const before = measured ? await mediaSnapshot(String(job.payload.mediaId), job.kind) : null;
              if (job.kind === 'facet-recovery') await processFacetRecovery(String(job.id));
              else if (job.kind === 'enrich') await enrichMedia(String(job.payload.mediaId));
              else if (job.kind === 'series-catalog') await processSeriesCatalog(String(job.payload.mediaId));
              else if (job.kind === 'plex') await processPlex(job.payload);
              else if (job.kind === 'plex-review-sync') await processPlexReviewSync(job.payload);
              else if (job.kind === 'plex-scan') await processPlexScan(job.payload);
              else if (job.kind === 'plex-watch-restore') await processPlexRestore(job.payload);
              else if (job.kind === 'plex-presence') await processPlexPresence(job.payload);
              else throw Error('Unbekannter Aufgabentyp');
              if (measured) {
                const after = await mediaSnapshot(String(job.payload.mediaId), job.kind);
                const [media] = await query('SELECT title FROM media WHERE id=$1', [job.payload.mediaId]);
                await saveJobResult({
                  mediaId: media ? String(job.payload.mediaId) : undefined,
                  title: media?.title || 'Gelöschter Titel',
                  outcome: changeOutcome(before, after),
                  reason:
                    job.kind === 'enrich'
                      ? 'Metadaten vor und nach diesem Abruf verglichen.'
                      : 'Plex-Review vor und nach diesem Abruf verglichen.',
                });
              } else if (job.payload.mediaId) {
                const [media] = await query('SELECT id,title FROM media WHERE id=$1', [job.payload.mediaId]);
                if (media)
                  await saveJobResult({
                    mediaId: media.id,
                    title: media.title,
                    outcome: 'checked',
                    reason:
                      job.kind === 'series-catalog'
                        ? 'Serienkatalog und zugehörige Sichtungen verarbeitet.'
                        : 'Auftrag für diesen Titel verarbeitet.',
                  });
              }
              await query(
                "UPDATE job_runs SET status='done',finished_at=now(),heartbeat_at=now() WHERE id=$1 AND status='running'",
                [job.run_id],
              );
              if (daily) await scheduleNextScan(job.id, null, job.run_id);
              else
                await query(
                  "UPDATE jobs SET status='done',updated_at=now(),error=NULL WHERE id=$1 AND active_run_id=$2",
                  [job.id, job.run_id],
                );
              await logEvent('info', job.kind, 'Verarbeitung erfolgreich abgeschlossen');
            } catch (e) {
              const conflict = (e as { matchDetails?: { title: string } }).matchDetails;
              if (conflict)
                await saveJobResult({
                  title: conflict.title,
                  outcome: 'failed',
                  reason:
                    'Anbieter-IDs widersprechen sich oder passen zu mehreren Titeln. Der Abgleich wurde nicht übernommen.',
                  details: conflict,
                });
              await query(
                "UPDATE job_runs SET status='failed',finished_at=now(),error=$2 WHERE id=$1 AND status='running'",
                [job.run_id, String(redact((e as Error).message)).slice(0, 2000)],
              );
              if (job.payload.mediaId) {
                const [media] = await query('SELECT id,title FROM media WHERE id=$1', [job.payload.mediaId]);
                if (media)
                  await saveJobResult({
                    mediaId: media.id,
                    title: media.title,
                    outcome: 'failed',
                    reason: String(redact((e as Error).message)),
                  });
              } else if (!conflict && job.payload.metadata?.title)
                await saveJobResult({
                  title: job.payload.metadata.title,
                  outcome: 'failed',
                  reason: String(redact((e as Error).message)),
                });
              await logEvent(
                'error',
                job.kind,
                job.attempts >= 3
                  ? 'Verarbeitung endgültig fehlgeschlagen'
                  : 'Verarbeitung fehlgeschlagen; erneuter Versuch geplant',
                { error: e, retryInSeconds: job.attempts >= 3 ? null : Math.min(300, job.attempts * 30) },
              );
              await query(
                "UPDATE jobs SET status=$1,available_at=now()+($2*interval '1 second'),updated_at=now(),error=$3 WHERE id=$4 AND active_run_id=$5",
                [
                  job.attempts >= 3 ? 'failed' : 'pending',
                  Math.min(300, job.attempts * 30),
                  String(redact((e as Error).message)).slice(0, 300),
                  job.id,
                  job.run_id,
                ],
              );
              if (daily && job.attempts >= 3)
                await scheduleNextScan(
                  job.id,
                  String(redact((e as Error).message)).slice(0, 300),
                  job.run_id,
                );
            }
          },
        ),
      );
    } finally {
      clearInterval(heartbeat);
    }
    await new Promise((r) => setTimeout(r, 250));
  } catch (error) {
    await logEvent('error', 'worker', 'Hintergrundprozess gestört; neuer Versuch in 5 Sekunden', { error });
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await friendsLoop;
await pool.end();

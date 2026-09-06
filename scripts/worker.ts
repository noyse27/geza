import { query, pool } from '../src/lib/db';
import { enrichMedia } from '../src/lib/providers';
import { processPlex } from '../src/lib/plex';
let running = true;
process.on('SIGTERM', () => {
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});
console.log('Geza worker ready');
while (running) {
  try {
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
    try {
      if (job.kind === 'enrich') await enrichMedia(String(job.payload.mediaId));
      else if (job.kind === 'plex') await processPlex(job.payload);
      else throw Error('Unbekannter Aufgabentyp');
      await query("UPDATE jobs SET status='done',updated_at=now(),error=NULL WHERE id=$1", [job.id]);
    } catch (e) {
      await query(
        "UPDATE jobs SET status=$1,available_at=now()+($2*interval '1 second'),updated_at=now(),error=$3 WHERE id=$4",
        [
          job.attempts >= 3 ? 'failed' : 'pending',
          Math.min(300, job.attempts * 30),
          (e as Error).message.slice(0, 300),
          job.id,
        ],
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  } catch {
    console.error('Worker temporarily unavailable; retrying.');
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await pool.end();

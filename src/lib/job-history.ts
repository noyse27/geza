import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { query } from './db';
import { redact } from './logging';

export const runContext = new AsyncLocalStorage<{ id: string; lastProgress: number }>();
export async function reportProgress(phase: string, completed?: number, total?: number, force = false) {
  const run = runContext.getStore();
  if (!run || (!force && Date.now() - run.lastProgress < 1000)) return;
  run.lastProgress = Date.now();
  await query(
    "UPDATE job_runs SET phase=$2,completed=$3,total=$4,progress_at=now() WHERE id=$1 AND status='running'",
    [run.id, phase, completed ?? null, total ?? null],
  );
}
export type JobResult = {
  mediaId?: string;
  title: string;
  outcome: string;
  destination?: string;
  reason?: string;
  details?: Record<string, unknown>;
};
export async function saveJobResult(result: JobResult, client?: PoolClient) {
  const run = runContext.getStore();
  if (!run) return;
  const sql = `INSERT INTO job_results(run_id,media_id,title,outcome,destination,reason,details) VALUES($1,$2,$3,$4,$5,$6,$7)`;
  const values = [
    run.id,
    result.mediaId || null,
    result.title,
    result.outcome,
    result.destination || null,
    result.reason || null,
    JSON.stringify(redact(result.details || {})),
  ];
  if (client) await client.query(sql, values);
  else await query(sql, values);
}
// Keep batches in the caller's transaction: a later failure must discard every result.
export async function saveJobResults(results: JobResult[], client: PoolClient) {
  const run = runContext.getStore();
  if (!run) return;
  for (let start = 0; start < results.length; start += 200) {
    const rows = results.slice(start, start + 200).map((result) => ({
      media_id: result.mediaId || null,
      title: result.title,
      outcome: result.outcome,
      destination: result.destination || null,
      reason: result.reason || null,
      details: redact(result.details || {}),
    }));
    await client.query(
      `INSERT INTO job_results(run_id,media_id,title,outcome,destination,reason,details)
      SELECT $1,r.media_id,r.title,r.outcome,r.destination,r.reason,r.details
      FROM jsonb_to_recordset($2::jsonb) AS r(media_id bigint,title text,outcome text,destination text,reason text,details jsonb)`,
      [run.id, JSON.stringify(rows)],
    );
  }
}
export async function mediaSnapshot(id: string, kind: string) {
  if (kind === 'plex-review-sync')
    return await query(
      "SELECT body,spoiler FROM reviews WHERE media_id=$1 AND source='plex' ORDER BY source_id",
      [id],
    );
  const [row] = await query(
    `SELECT title,original_title,summary,year,runtime,poster,genres,countries,original_genres,original_countries,directors,actors,certification,ids FROM media WHERE id=$1`,
    [id],
  );
  if (!row) return null;
  const ratings = await query(
    'SELECT provider,rating,url,votes FROM provider_ratings WHERE media_id=$1 ORDER BY provider',
    [id],
  );
  return { ...row, providerRatings: ratings };
}
export function changeOutcome(before: unknown, after: unknown) {
  if (JSON.stringify(before) === JSON.stringify(after)) return 'unchanged';
  const empty = (x: unknown) => x == null || (Array.isArray(x) && !x.length);
  if (empty(before) && !empty(after)) return 'new';
  if (!empty(before) && empty(after)) return 'removed';
  return 'updated';
}

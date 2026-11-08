import { query } from './db';

// Failed runs live for 31 days. Until they are viewed (or expire), keep the five
// successful runs immediately before and after them for comparison. Other
// successful runs are removed after seven days.
export async function cleanupJobHistory() {
  const deletedRuns = await query<{ id: string }>(
    `WITH protected AS (
      SELECT neighbor.id FROM job_runs failed
      CROSS JOIN LATERAL (
        (SELECT r.id FROM job_runs r WHERE r.kind=failed.kind AND r.status='done' AND r.id<failed.id
         ORDER BY r.id DESC LIMIT 5)
        UNION
        (SELECT r.id FROM job_runs r WHERE r.kind=failed.kind AND r.status='done' AND r.id>failed.id
         ORDER BY r.id LIMIT 5)
      ) neighbor
      WHERE failed.status='failed' AND failed.viewed_at IS NULL
        AND failed.finished_at>=now()-interval '31 days'
    ), candidates AS (
      SELECT r.id FROM job_runs r
      WHERE (r.status='failed' AND r.finished_at<now()-interval '31 days')
          OR (r.status='done' AND r.finished_at<now()-interval '7 days'
            AND NOT EXISTS(SELECT 1 FROM protected p WHERE p.id=r.id))
    ), cleared AS (
      UPDATE jobs j SET active_run_id=NULL FROM candidates c WHERE j.active_run_id=c.id RETURNING j.id
    ), deleted AS (
      DELETE FROM job_runs r USING candidates c WHERE r.id=c.id
      RETURNING r.id
    ) SELECT id::text FROM deleted`,
  );
  const deletedJobs = await query<{ id: string }>(
    `DELETE FROM jobs j
      WHERE ((j.status='done' AND j.updated_at<now()-interval '7 days')
          OR (j.status='failed' AND j.updated_at<now()-interval '31 days'))
        AND NOT EXISTS(SELECT 1 FROM job_runs r WHERE r.job_id=j.id)
      RETURNING id::text`,
  );
  return { runs: deletedRuns.length, jobs: deletedJobs.length };
}

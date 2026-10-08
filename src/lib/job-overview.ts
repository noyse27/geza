import { query } from './db';
export async function jobOverview() {
  const [queue, runs, totals, today, legacyErrors] = await Promise.all([
    query(`SELECT j.id,j.kind,j.status,j.available_at,j.queued_at,j.attempts,r.started_at,r.heartbeat_at,r.progress_at,r.phase,r.completed,r.total
      FROM jobs j LEFT JOIN job_runs r ON r.id=j.active_run_id
      WHERE j.status IN ('pending','running') ORDER BY (j.status='running') DESC,j.available_at,j.id LIMIT 30`),
    query(
      `SELECT r.*,j.status AS current_job_status,
        coalesce((SELECT jsonb_object_agg(outcome,n) FROM (SELECT outcome,count(*)::int AS n FROM job_results WHERE run_id=r.id GROUP BY outcome) x),'{}') AS counts
        FROM job_runs r JOIN jobs j ON j.id=r.job_id WHERE r.status<>'running' ORDER BY r.id DESC LIMIT 12`,
    ),
    query('SELECT kind,status,count(*)::int AS count FROM jobs GROUP BY kind,status ORDER BY kind,status'),
    query(`SELECT r.kind,x.outcome,count(*)::int AS count FROM job_results x JOIN job_runs r ON r.id=x.run_id
      WHERE r.status='done' AND r.finished_at >= (date_trunc('day',now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')
      GROUP BY r.kind,x.outcome ORDER BY r.kind,x.outcome`),
    query(
      "SELECT id,kind,error,updated_at FROM jobs WHERE status='failed' AND NOT EXISTS(SELECT 1 FROM job_runs WHERE job_id=jobs.id) ORDER BY updated_at DESC LIMIT 8",
    ),
  ]);
  return { queue, runs, totals, today, legacyErrors, fetchedAt: new Date().toISOString() };
}

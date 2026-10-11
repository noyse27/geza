import { isAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { diagnosticState } from '@/lib/diagnostics';

export const dynamic = 'force-dynamic';

function endpoint(value: unknown) {
  try {
    const url = new URL(String(value));
    return `${url.pathname}${url.search}`;
  } catch {
    return 'unbekannt';
  }
}

export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  const hours = Number(new URL(req.url).searchParams.get('hours') || '6');
  if (![1, 6, 24].includes(hours))
    return Response.json({ error: 'Zeitraum muss 1, 6 oder 24 Stunden betragen.' }, { status: 400 });

  const events = await query(
    `SELECT id,created_at,level,source,message,context FROM event_logs
     WHERE created_at >= now()-($1*interval '1 hour') ORDER BY id ASC LIMIT 50001`,
    [hours],
  );
  const truncated = events.length > 50000;
  if (truncated) events.length = 50000;
  const jobRuns = await query(
    `SELECT r.id,r.job_id,r.kind,r.attempt,r.status,r.started_at,r.finished_at,r.phase,r.completed,r.total,r.error,
            j.status AS current_job_status,j.queued_at,j.updated_at,j.error AS current_job_error
     FROM job_runs r JOIN jobs j ON j.id=r.job_id
     WHERE r.started_at >= now()-($1*interval '1 hour') OR r.finished_at >= now()-($1*interval '1 hour')
     ORDER BY r.id ASC`,
    [hours],
  );
  const resultRows = jobRuns.length
    ? await query(
        `SELECT run_id,media_id,title,outcome,destination,reason,details FROM job_results
         WHERE run_id=ANY($1::bigint[]) ORDER BY id ASC`,
        [jobRuns.map((run) => run.id)],
      )
    : [];
  const migrations = await query('SELECT name,applied_at FROM migrations ORDER BY name');
  const diagnostics = await diagnosticState();
  const plexStarts = events.filter(
    (event) =>
      event.source === 'provider' &&
      event.message === 'Anbieterabfrage gestartet' &&
      event.context?.provider === 'Plex',
  );
  const counts = new Map<string, { purpose: string; endpoint: string; clientId?: string; count: number }>();
  for (const event of plexStarts) {
    const purpose = String(event.context.purpose || 'nicht erfasst');
    const path = endpoint(event.context.url);
    const clientId = event.context.clientId ? String(event.context.clientId) : undefined;
    const key = JSON.stringify([purpose, path, clientId || '']);
    const current = counts.get(key);
    if (current) current.count++;
    else counts.set(key, { purpose, endpoint: path, ...(clientId ? { clientId } : {}), count: 1 });
  }
  const payload = {
    format: 'geza-diagnostic-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    periodHours: hours,
    diagnosticLogging: diagnostics,
    limits: { eventLimit: 50000, eventsTruncated: truncated },
    plexRequests: {
      total: plexStarts.length,
      groups: [...counts.values()].sort((a, b) => b.count - a.count),
    },
    migrations,
    events,
    jobRuns,
    jobResults: resultRows,
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="geza-diagnose-${hours}h-${new Date().toISOString().replaceAll(':', '-')}.json"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { jobNames, jobState, exactTime, outcomeNames } from '@/lib/job-display';
import { RefreshRuns, RetryJob, TimeAgo } from '@/components/job-status';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Aufträge und Ergebnisse', robots: { index: false, follow: false } };
export default async function Jobs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const p = await searchParams;
  const kind = typeof p.kind === 'string' ? p.kind : '';
  const status = typeof p.status === 'string' ? p.status : '';
  const job = typeof p.job === 'string' && /^\d+$/.test(p.job) ? p.job : null;
  const page = Math.min(100000, Math.max(0, Math.floor(Number(p.page) || 0)));
  const today = p.today === '1';
  const outcome = typeof p.outcome === 'string' ? p.outcome : '';
  const [jobs, runs] = await Promise.all([
    query(
      `SELECT j.*,r.heartbeat_at,m.title AS media_title FROM jobs j LEFT JOIN job_runs r ON r.id=j.active_run_id
      LEFT JOIN media m ON m.id=CASE WHEN j.payload->>'mediaId' ~ '^[1-9][0-9]{0,17}$' THEN (j.payload->>'mediaId')::bigint END
      WHERE ($1='' OR j.kind=$1) AND ($2='' OR j.status=$2) AND ($3::bigint IS NULL OR j.id=$3) ORDER BY j.updated_at DESC,j.id DESC LIMIT 51 OFFSET $4`,
      [kind, status, job, page * 50],
    ),
    query(
      `SELECT r.*,coalesce((SELECT jsonb_object_agg(outcome,n) FROM (SELECT outcome,count(*)::int AS n FROM job_results WHERE run_id=r.id GROUP BY outcome) x),'{}') AS counts
      FROM job_runs r JOIN jobs j ON j.id=r.job_id WHERE ($1='' OR r.kind=$1) AND ($2::bigint IS NULL OR job_id=$2)
      AND (NOT $3 OR finished_at >= (date_trunc('day',now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'))
      AND (NOT $3 OR r.status='done') AND ($6='' OR j.status=$6)
      AND ($4='' OR EXISTS(SELECT 1 FROM job_results WHERE run_id=r.id AND outcome=$4))
      ORDER BY r.id DESC LIMIT 51 OFFSET $5`,
      [kind, job, today, outcome, page * 50, status],
    ),
  ]);
  const next = new URLSearchParams({
    kind,
    status,
    ...(job ? { job } : {}),
    ...(today ? { today: '1' } : {}),
    outcome,
    page: String(page + 1),
  });
  return (
    <div className="page">
      <h1>Aufträge und Ergebnisse</h1>
      <p>
        <Link href="/admin">← Admin</Link> · <Link href="/admin/issues">Offene Importfälle</Link>
      </p>
      <RefreshRuns active={jobs.some((j) => ['pending', 'running'].includes(j.status))} />
      <form className="form-grid">
        <label>
          Bereich
          <select name="kind" defaultValue={kind}>
            <option value="">Alle</option>
            {Object.entries(jobNames).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Aktueller Auftragsstatus
          <select name="status" defaultValue={status}>
            <option value="">Alle</option>
            <option value="pending">Wartend / geplant</option>
            <option value="running">Laufend</option>
            <option value="failed">Fehlgeschlagen</option>
            <option value="done">Abgeschlossen</option>
          </select>
        </label>
        <button className="button">Filtern</button>
        <Link href="/admin/jobs">Filter zurücksetzen</Link>
      </form>
      {today && (
        <p>
          Ergebnisse heute, seit 00:00 Uhr Berlin{outcome ? ` · ${outcomeNames[outcome] || outcome}` : ''}.
        </p>
      )}
      {!today && (
        <section className="panel">
          <h2>Aufträge</h2>
          {!jobs.length && <p>Keine passenden Aufträge.</p>}
          {jobs.slice(0, 50).map((j) => (
            <div className="processing-row" key={j.id}>
              <Link href={`/admin/jobs?job=${j.id}`}>
                {jobNames[j.kind] || j.kind} #{j.id}
              </Link>{' '}
              · {jobState(j)}
              <p className="small">
                Letzte Statusmeldung: {exactTime(j.updated_at)} ·{' '}
                <TimeAgo value={j.updated_at.toISOString()} />
              </p>
              {j.status === 'pending' && (
                <p>
                  Ausführung ab {exactTime(j.available_at)}
                  {j.queued_at
                    ? ` · Eingereiht: ${exactTime(j.queued_at)}`
                    : ' · Einreihungszeit historisch nicht erfasst'}
                </p>
              )}
              {j.payload.mediaId && /^\d+$/.test(String(j.payload.mediaId)) && (
                <p>
                  <Link href={`/title/${j.payload.mediaId}?new=1`}>
                    {j.media_title || 'Betroffenen Titel'} – prüfen / bearbeiten
                  </Link>
                </p>
              )}
              {!j.payload.mediaId && j.payload.metadata?.title && <p>{j.payload.metadata.title}</p>}
              {j.error && <p className="error">{j.error}</p>}
              <Link href={`/admin/logs?jobId=${j.id}`}>Ereignisse dieses Auftrags</Link>
              {['failed', 'done'].includes(j.status) && (
                <p>
                  <RetryJob jobId={String(j.id)} />
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="panel">
        <h2>Ausführungen {job ? `für Auftrag #${job}` : ''}</h2>
        <p className="small muted">
          Detaillierte Ergebnisse werden seit Einführung dieser Ansicht erfasst. Ältere Aufträge haben noch
          keine Laufhistorie.
        </p>
        {!runs.length && <p>Keine erfassten Ausführungen für diese Auswahl.</p>}
        {runs.slice(0, 50).map((r) => (
          <div className="processing-row" key={r.id}>
            <Link href={`/admin/jobs/${r.id}${outcome ? `?outcome=${outcome}` : ''}`}>
              {jobNames[r.kind] || r.kind} · {jobState(r)} · Versuch {r.attempt}
            </Link>
            <p>
              {exactTime(r.started_at)} · <TimeAgo value={(r.finished_at || r.started_at).toISOString()} />
            </p>
            <p>
              {Object.entries(r.counts)
                .map(([key, n]) => `${n} ${outcomeNames[key] || key}`)
                .join(' · ') || 'Noch keine Einzelergebnisse'}
            </p>
            {r.error && <p className="error">{r.error}</p>}
          </div>
        ))}
      </section>
      {(jobs.length > 50 || runs.length > 50) && (
        <Link className="button" href={`/admin/jobs?${next}`}>
          Weitere Ergebnisse
        </Link>
      )}
    </div>
  );
}

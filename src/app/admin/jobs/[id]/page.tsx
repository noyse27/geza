import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { exactTime, errorHelp, jobNames, jobState, outcomeNames } from '@/lib/job-display';
import { RefreshRuns, RetryJob, RunProgress, TimeAgo } from '@/components/job-status';
import { JobConflict } from '@/components/job-conflict';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Verarbeitungsergebnis', robots: { index: false, follow: false } };
export default async function Run({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [run] = await query(
    'SELECT r.*,j.status AS current_job_status FROM job_runs r JOIN jobs j ON j.id=r.job_id WHERE r.id=$1',
    [id],
  );
  if (!run) notFound();
  const p = await searchParams,
    outcome = typeof p.outcome === 'string' ? p.outcome : '';
  const page = Math.min(100000, Math.max(0, Math.floor(Number(p.page) || 0)));
  const [rows, counts] = await Promise.all([
    query(
      "SELECT * FROM job_results WHERE run_id=$1 AND ($2='' OR outcome=$2) ORDER BY id LIMIT 51 OFFSET $3",
      [id, outcome, page * 50],
    ),
    query(
      'SELECT outcome,count(*)::int AS n FROM job_results WHERE run_id=$1 GROUP BY outcome ORDER BY outcome',
      [id],
    ),
  ]);
  return (
    <div className="page">
      <h1>{jobNames[run.kind] || run.kind}</h1>
      <p>
        <Link href="/admin/jobs">← Aufträge</Link> ·{' '}
        <Link href={`/admin/jobs?job=${run.job_id}`}>Alle Versuche dieses Auftrags</Link> ·{' '}
        <Link href={`/admin/logs?runId=${id}`}>Ereignisverlauf</Link>
      </p>
      <RefreshRuns active={run.status === 'running'} />
      {run.status === 'failed' && run.current_job_status === 'done' && (
        <p>
          Dieser Auftrag wurde inzwischen erfolgreich abgeschlossen. Hier siehst du den früheren
          fehlgeschlagenen Versuch.
        </p>
      )}
      {run.status === 'failed' && run.current_job_status === 'pending' && (
        <p>Ein neuer Versuch dieses Auftrags ist bereits eingeplant.</p>
      )}
      <section className="panel">
        <h2>
          {jobState(run)} · Versuch {run.attempt}
        </h2>
        <p>
          Gestartet: {exactTime(run.started_at)}
          {run.finished_at && (
            <>
              {' '}
              · Beendet: {exactTime(run.finished_at)} · <TimeAgo value={run.finished_at.toISOString()} />
            </>
          )}
        </p>
        <RunProgress job={JSON.parse(JSON.stringify(run))} />
        {run.status === 'done' && counts.some((c) => c.outcome === 'failed') && (
          <p className="error">
            Abgeschlossen mit offenen Problemen. Die übrigen Titel wurden übernommen. Unter „Nicht
            verarbeitet“ steht der Grund pro Titel. Fehlende Daten in Plex ergänzen oder den richtigen
            Geza-Datensatz auswählen und danach erneut prüfen.
          </p>
        )}
        {run.status === 'running' && (
          <p>
            Der Scan bzw. Auftrag ist noch nicht abgeschlossen. Der sichtbare Bestand kann noch auf dem
            letzten erfolgreichen Abgleich beruhen.
          </p>
        )}
        {run.error && (
          <>
            <p className="error">{run.error}</p>
            <p>{errorHelp(run.error)}</p>
            {run.kind === 'plex-scan' && (
              <p>Die Änderungen dieses fehlgeschlagenen Scans wurden nicht übernommen.</p>
            )}
          </>
        )}
        {run.status !== 'running' && <RetryJob jobId={String(run.job_id)} />}
      </section>
      <section className="panel">
        <h2>Ergebnisse</h2>
        <p>
          <Link href={`/admin/jobs/${id}`}>Alle</Link>
          {counts.map((c) => (
            <span key={c.outcome}>
              {' '}
              ·{' '}
              <Link href={`/admin/jobs/${id}?outcome=${c.outcome}`}>
                {c.n} {outcomeNames[c.outcome] || c.outcome}
              </Link>
            </span>
          ))}
        </p>
        {run.kind === 'plex-scan' && (
          <p className="small muted">
            Filme und Serien mit ihrem Ziel nach diesem Scan. „Aktualisiert“ bezeichnet eine geänderte
            Einordnung. Episoden werden im Serienkatalog geführt.
          </p>
        )}
        {!rows.length && (
          <p>
            {run.status === 'running'
              ? 'Die Ergebnisse erscheinen nach Übernahme der Änderungen.'
              : 'Keine Einzelergebnisse für diese Auswahl erfasst.'}
          </p>
        )}
        {rows.slice(0, 50).map((row) => (
          <article className="processing-row" key={row.id}>
            <h3>{row.media_id ? <Link href={`/title/${row.media_id}`}>{row.title}</Link> : row.title}</h3>
            <p>
              <strong>{outcomeNames[row.outcome] || row.outcome}</strong>
              {row.destination && <> → {row.destination}</>}
            </p>
            <p>{row.reason}</p>
            {row.details.library && <p className="small muted">Bibliothek: {row.details.library}</p>}
            {row.media_id && (
              <p>
                <Link href={`/title/${row.media_id}?new=1`}>Titel prüfen / korrigieren</Link>
              </p>
            )}
            {row.outcome === 'failed' && <JobConflict details={row.details} />}
            {row.details.deleted && (
              <p>
                Zum bewussten Wiederaufnehmen den Titel über <Link href="/bucketlist">die Bucketliste</Link>{' '}
                hinzufügen. Die frühere Löschung verhindert nur eine automatische Wiederanlage.
              </p>
            )}
          </article>
        ))}
        {rows.length > 50 && (
          <Link
            className="button"
            href={`/admin/jobs/${id}?outcome=${encodeURIComponent(outcome)}&page=${page + 1}`}
          >
            Weitere Titel
          </Link>
        )}
      </section>
    </div>
  );
}

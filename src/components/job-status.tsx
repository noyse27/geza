'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { exactTime, relativeTime, jobState, jobNames, outcomeNames } from '@/lib/job-display';
type Row = Record<string, any>;
type Overview = {
  queue: Row[];
  runs: Row[];
  totals: Row[];
  today: Row[];
  legacyErrors: Row[];
  fetchedAt: string;
};
export function TimeAgo({ value }: { value: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={value} title={exactTime(value)}>
      {now ? relativeTime(value, now) : exactTime(value)}
    </time>
  );
}
export function RunProgress({ job }: { job: Row }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  if (job.status !== 'running') return null;
  const active = jobState(job, now ?? Date.now()) === 'Läuft';
  return (
    <>
      {job.phase && <p className="small">{job.phase}</p>}
      {!active && (
        <p className="error small">
          Keine aktuelle Rückmeldung. Der letzte Fortschrittsstand ist unten angegeben.
        </p>
      )}
      {active && (
        <progress
          className="job-progress"
          aria-label={job.phase || 'Verarbeitung läuft'}
          value={job.total > 0 ? (job.completed ?? 0) : undefined}
          max={job.total > 0 ? job.total : undefined}
        />
      )}
      {job.total > 0 && (
        <span className="small">
          {' '}
          {job.completed ?? 0} von {job.total}
        </span>
      )}
      {job.progress_at && (
        <p className="small muted">
          Letzter Fortschritt <TimeAgo value={job.progress_at} />
        </p>
      )}
      {job.status === 'running' && job.heartbeat_at && (
        <p className="small muted">
          Letzte Rückmeldung <TimeAgo value={job.heartbeat_at} />
        </p>
      )}
    </>
  );
}
export function JobDashboard({ initial }: { initial: Overview }) {
  const [data, setData] = useState(initial),
    [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    let active = initial.queue.some(
      (job) =>
        job.status === 'running' ||
        (job.status === 'pending' && new Date(job.available_at).getTime() <= Date.now()),
    );
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (!document.hidden)
        try {
          const response = await fetch('/api/admin/jobs', {
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          });
          if (!response.ok) throw Error('Status konnte nicht aktualisiert werden.');
          const next = await response.json();
          if (!stopped) {
            setData(next);
            setError('');
            active = next.queue.some(
              (job: Row) =>
                job.status === 'running' ||
                (job.status === 'pending' && new Date(job.available_at).getTime() <= Date.now()),
            );
          }
        } catch {
          if (!stopped) {
            setError('Keine aktuelle Verbindung. Angezeigt wird der zuletzt geladene Stand.');
            setData((current) => ({ ...current }));
          }
        }
      if (!stopped) timer = setTimeout(refresh, active ? 5000 : 30000);
    }
    timer = setTimeout(refresh, 5000);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return (
    <section className="panel" id="verarbeitung">
      <h2>Verarbeitung</h2>
      <p>
        <Link href="/admin/jobs">Alle Aufträge und Ergebnisse</Link> ·{' '}
        <Link href="/admin/issues">Offene Importfälle prüfen</Link>
      </p>
      <p className="small muted">Stand: {exactTime(data.fetchedAt)} · Zeiten in Berlin</p>
      {error && (
        <p role="status" className="error">
          {error}
        </p>
      )}
      <h3>Aktuell und geplant</h3>
      {!data.queue.length && <p>Keine wartenden oder laufenden Aufträge.</p>}
      {data.queue.map((job) => (
        <div className="processing-row" key={job.id}>
          <Link href={`/admin/jobs?job=${job.id}`}>{jobNames[job.kind] || job.kind}</Link> ·{' '}
          <strong>{jobState(job)}</strong>
          <p className="small muted">
            {job.status === 'running' && job.started_at
              ? `Gestartet: ${exactTime(job.started_at)}`
              : `Ausführung ab: ${exactTime(job.available_at)}`}
            {job.queued_at && (
              <>
                {' '}
                · Eingereiht <TimeAgo value={job.queued_at} />
              </>
            )}
            {job.status === 'pending' && job.attempts > 0 && ' · Erneuter Versuch'}
          </p>
          <RunProgress job={job} />
        </div>
      ))}
      {data.queue.length === 30 && (
        <p>
          <Link href="/admin/jobs?status=pending">Weitere wartende Aufträge</Link>
        </p>
      )}
      <h3>Ergebnisse heute</h3>
      <p className="small muted">
        Abgeschlossene Ausführungen seit 00:00 Uhr (Berlin). Mehrere Änderungen desselben Titels zählen pro
        Ausführung.
      </p>
      {!data.today.length && <p>Noch keine erfassten Ergebnisse heute.</p>}
      {data.today.map((row) => (
        <p key={`${row.kind}:${row.outcome}`}>
          <Link href={`/admin/jobs?kind=${row.kind}&today=1&outcome=${row.outcome}`}>
            {jobNames[row.kind] || row.kind}: {row.count} {outcomeNames[row.outcome] || row.outcome}
          </Link>
        </p>
      ))}
      <h3>Letzte Ausführungen</h3>
      {data.runs.map((run) => (
        <p key={run.id} className={run.status === 'failed' || run.counts?.failed ? 'error' : ''}>
          <Link href={`/admin/jobs/${run.id}`}>
            {jobNames[run.kind] || run.kind} · {jobState(run)}
            {run.status === 'done' && !!run.counts?.failed && ' mit offenen Konflikten'}
          </Link>{' '}
          · <TimeAgo value={run.finished_at || run.started_at} />
          {Object.entries(run.counts || {}).map(([outcome, count]) => (
            <span key={outcome}>
              {' '}
              ·{' '}
              <Link
                href={`/admin/jobs/${run.id}?outcome=${outcome}`}
              >{`${count} ${outcomeNames[outcome] || outcome}`}</Link>
            </span>
          ))}
          {run.error && (
            <>
              <br />
              {run.error}
            </>
          )}
          {run.status === 'failed' && run.current_job_status === 'pending' && (
            <small> · Neuer Versuch geplant</small>
          )}
          {run.status === 'failed' && run.current_job_status === 'done' && (
            <small> · Auftrag inzwischen abgeschlossen</small>
          )}
        </p>
      ))}
      {data.legacyErrors.length > 0 && (
        <>
          <h3>Offene Fehler aus älteren Aufträgen</h3>
          {data.legacyErrors.map((job) => (
            <p key={job.id} className="error">
              <Link href={`/admin/jobs?job=${job.id}`}>
                {jobNames[job.kind] || job.kind}: {job.error}
              </Link>
              <br />
              <small>
                Letzte Statusänderung <TimeAgo value={job.updated_at} /> · Start und Ergebnisse historisch
                nicht erfasst
              </small>
            </p>
          ))}
        </>
      )}
      <details>
        <summary>Gesamtbestand der Aufträge (keine Zuwächse)</summary>
        {data.totals.map((row) => (
          <p key={`${row.kind}:${row.status}`}>
            <Link href={`/admin/jobs?kind=${row.kind}&status=${row.status}`}>
              {jobNames[row.kind] || row.kind} · {jobState(row)}: {row.count}
            </Link>
          </p>
        ))}
      </details>
    </section>
  );
}
export function RefreshRuns({ active }: { active: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  useEffect(() => {
    let busy = false;
    const timer = setInterval(
      async () => {
        if (document.hidden || busy) return;
        busy = true;
        try {
          const r = await fetch('/api/admin/jobs', { cache: 'no-store' });
          if (!r.ok) throw Error();
          setError('');
          router.refresh();
        } catch {
          setError('Aktualisierung nicht möglich. Der angezeigte Stand kann veraltet sein.');
        } finally {
          busy = false;
        }
      },
      active ? 5000 : 30000,
    );
    return () => clearInterval(timer);
  }, [active, router]);
  return error ? (
    <p role="status" className="error">
      {error}
    </p>
  ) : null;
}
export function RetryJob({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const router = useRouter();
  return (
    <>
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await fetch('/api/admin/jobs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobId }),
            });
            const data = await r.json();
            setMessage(data.error || data.message);
            if (r.ok) router.refresh();
          } catch {
            setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Wird eingeplant …' : 'Nach Korrektur erneut prüfen'}
      </button>
      {message && <p role="status">{message}</p>}
    </>
  );
}

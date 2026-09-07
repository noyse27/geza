import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ereignisprotokoll', robots: { index: false, follow: false } };
export default async function Logs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const level = typeof params.level === 'string' ? params.level : '';
  const source = typeof params.source === 'string' ? params.source : '';
  const requestId = typeof params.requestId === 'string' ? params.requestId : '';
  const before = typeof params.before === 'string' && /^\d+$/.test(params.before) ? params.before : null;
  const rows = await query(
    `SELECT * FROM event_logs WHERE created_at >= now()-interval '14 days'
    AND ($1='' OR level=$1) AND ($2='' OR source=$2)
    AND ($3='' OR context->>'requestId'=$3) AND ($4::bigint IS NULL OR id<$4)
    ORDER BY id DESC LIMIT 101`,
    [level, source, requestId, before],
  );
  const next = new URLSearchParams({ level, source, requestId, before: String(rows[99]?.id || '') });
  return (
    <div className="page">
      <h1>Ereignisprotokoll</h1>
      <p>
        <Link href="/admin">← Admin</Link> ·{' '}
        <Link href="/admin/logs">Aktualisieren / Filter zurücksetzen</Link>
      </p>
      <p>
        Webhooks, Anbieterabfragen und Verarbeitungsschritte. Aufbewahrung: 14 Tage. Neueste Einträge zuerst.
        Zugangsdaten und vollständige Request-Bodies werden nicht gespeichert.
      </p>
      <form className="form-grid" method="get">
        <label>
          Schweregrad
          <select name="level" defaultValue={level}>
            <option value="">Alle</option>
            <option value="info">Info</option>
            <option value="warn">Warnung</option>
            <option value="error">Fehler</option>
          </select>
        </label>
        <label>
          Bereich
          <select name="source" defaultValue={source}>
            <option value="">Alle</option>
            {['webhook', 'plex', 'enrich', 'provider', 'worker', 'friends'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Anfrage-ID
          <input name="requestId" defaultValue={requestId} />
        </label>
        <button className="button" type="submit">
          Filtern
        </button>
      </form>
      {requestId && (
        <p>
          <a className="button" href={`/api/admin/logs/export?requestId=${encodeURIComponent(requestId)}`}>
            Gesamten Anfrageverlauf als JSON exportieren
          </a>
        </p>
      )}
      {!rows.length && <p>Keine Ereignisse für diese Auswahl vorhanden.</p>}
      {rows.slice(0, 100).map((row) => (
        <section className="panel" key={row.id}>
          <p className={row.level === 'error' ? 'error' : 'muted'}>
            {new Date(row.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} · {row.level} ·{' '}
            {row.source}
          </p>
          <strong>{row.message}</strong>
          {row.context.title && <p>Titel: {row.context.title}</p>}
          {row.context.requestId && (
            <p>
              <Link href={`/admin/logs?requestId=${encodeURIComponent(row.context.requestId)}`}>
                Gesamten Verlauf dieser Anfrage anzeigen
              </Link>
              {' · '}
              <a href={`/api/admin/logs/export?requestId=${encodeURIComponent(row.context.requestId)}`}>
                JSON exportieren
              </a>
            </p>
          )}
          <details>
            <summary>Details{row.context.status ? ` · HTTP ${row.context.status}` : ''}</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify(row.context, null, 2)}
            </pre>
          </details>
        </section>
      ))}
      {rows.length > 100 && (
        <Link className="button" href={`/admin/logs?${next}`}>
          Ältere Einträge
        </Link>
      )}
    </div>
  );
}

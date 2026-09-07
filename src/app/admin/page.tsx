import { ReviewBoxAdmin } from '@/components/review-box-admin';
import { reviewModules } from '@/lib/review-modules';
import { requireAdmin } from '@/lib/auth';
import { getSetting, settingKeys } from '@/lib/settings';
import { query } from '@/lib/db';
import { AdminControls } from '@/components/admin';
export const metadata = { title: 'Admin', robots: { index: false, follow: false } };
export default async function Page() {
  await requireAdmin();
  const boxes = await query('SELECT provider,name,scale FROM review_boxes ORDER BY provider');
  const settings = Object.fromEntries(
    await Promise.all(settingKeys.map(async (k) => [k, await getSetting(k)])),
  );
  const configured = Object.fromEntries(settingKeys.map((k) => [k, !!settings[k]]));
  const [jobs, imports, errors] = await Promise.all([
    query('SELECT kind,status,count(*)::int AS count FROM jobs GROUP BY kind,status'),
    query('SELECT started_at,finished_at,report FROM import_runs ORDER BY id DESC LIMIT 3'),
    query("SELECT kind,error,updated_at FROM jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 8"),
  ]);
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow accent">HINTER DEN KULISSEN</span>
        <h1>
          Admin<span className="accent">.</span>
        </h1>
        <p>Deine Verbindungen. Deine Daten. Deine Kontrolle.</p>
      </div>
      <div id="reviewanbieter">
        <ReviewBoxAdmin
          boxes={JSON.parse(JSON.stringify(boxes))}
          modules={reviewModules.map(({ id, name }) => ({ id, name }))}
        />
      </div>
      <AdminControls configured={configured} values={settings} publicUrl={process.env.PUBLIC_URL || ''} />
      <p>
        <a className="button" href="/admin/logs">
          Ereignisprotokoll: Webhooks und Fehler ansehen
        </a>
      </p>
      <p>
        <a className="button" href="/api/export">
          Alle persönlichen Daten als JSON exportieren
        </a>
      </p>
      <div className="stats-columns">
        <section className="panel">
          <h2>Verarbeitung</h2>
          {jobs.length ? (
            jobs.map((j, i) => (
              <p key={i} className="status-row">
                <span>
                  {j.kind === 'enrich'
                    ? 'Metadaten'
                    : j.kind === 'plex-review-sync'
                      ? 'Plex-Reviews'
                      : 'Plex'}{' '}
                  · {j.status}
                </span>
                <strong>{j.count.toLocaleString('de-DE')}</strong>
              </p>
            ))
          ) : (
            <p className="muted">Keine offenen Aufgaben.</p>
          )}
          {errors.map((e, i) => (
            <p key={i} className="error">
              {e.kind}: {e.error}
            </p>
          ))}
        </section>
        <section className="panel">
          <h2>Letzte Importe</h2>
          {imports.length ? (
            imports.map((r, i) => (
              <div key={i}>
                <p>{new Date(r.started_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</p>
                <p className="muted">
                  {r.report?.watches?.toLocaleString('de-DE')} Ereignisse ·{' '}
                  {r.report?.ratings?.toLocaleString('de-DE')} Bewertungen · {r.report?.reviews} Kommentare
                </p>
                <p className="small muted">
                  {r.report?.unknownDates} ungeklärte Anschauzeitpunkte bleiben erhalten.{' '}
                  {r.report?.providerCollisions?.length || 0} mehrfach zugeordnete Plex-IDs werden beim
                  Abgleich nicht automatisch zusammengeführt.
                </p>
              </div>
            ))
          ) : (
            <p className="muted">Noch kein Import durchgeführt.</p>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>Plex-Webhook</h2>
        <p>
          Die Webhook-Adresse wird oben aus deinem gespeicherten Webhook-Geheimnis gebaut. Account-ID,
          Server-UUID und das Geheimnis kannst du in den Verbindungen per Auge sichtbar machen.
        </p>
        <p className="muted small">
          Der Server-Webhook überträgt Anschauereignisse, Bewertungen und die dazugehörige Plex-Review
          fortlaufend. Für einen einmaligen Abgleich aller Titel siehe „Plex-Reviews nachziehen“ oben.
        </p>
      </section>
    </div>
  );
}

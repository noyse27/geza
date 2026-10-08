import { isDemo } from '@/lib/demo-mode';
import { ReviewBoxAdmin } from '@/components/review-box-admin';
import { reviewModules } from '@/lib/review-modules';
import { requireAdmin } from '@/lib/auth';
import { getSetting, settingKeys } from '@/lib/settings';
import { query } from '@/lib/db';
import { plexRequest } from '@/lib/plex';
import { AdminControls } from '@/components/admin';
import { TransferExport } from '@/components/transfer';
import { rumpelCounts } from '@/lib/rumpel';
import { FriendsAdmin } from '@/components/friends-admin';
import { federationEnabled, instanceNickname, listFriends } from '@/lib/federation';
import { jobOverview } from '@/lib/job-overview';
import { JobDashboard } from '@/components/job-status';
export const metadata = { title: 'Admin', robots: { index: false, follow: false } };
export default async function Page() {
  await requireAdmin();
  const boxes = await query(
    'SELECT provider,name,scale,automatic_enabled FROM review_boxes ORDER BY provider',
  );
  const settings = Object.fromEntries(
    await Promise.all(settingKeys.map(async (k) => [k, await getSetting(k)])),
  );
  const configured = Object.fromEntries(settingKeys.map((k) => [k, !!settings[k]]));
  let plexSections: { key: string; title: string; type: string }[] = [];
  if (!isDemo() && settings.PLEX_URL && settings.PLEX_TOKEN) {
    try {
      const data = await plexRequest('/library/sections');
      plexSections = (data?.MediaContainer?.Directory || [])
        .filter((s: { type: string }) => ['movie', 'show'].includes(s.type))
        .map((s: { key: string; title: string; type: string }) => ({
          key: s.key,
          title: s.title,
          type: s.type,
        }));
    } catch {
      plexSections = [];
    }
  }
  const friends = (await listFriends()).map(({ id, url, nickname, status }) => ({
    id,
    url,
    nickname,
    status,
  }));
  const [overview, imports, rumpel] = await Promise.all([
    jobOverview(),
    query('SELECT started_at,finished_at,report FROM import_runs ORDER BY id DESC LIMIT 3'),
    rumpelCounts(),
  ]);
  const [lastScan] = await query(
    "SELECT created_at,context FROM event_logs WHERE source='plex-scan' AND message='Plex-Bestand und Einordnung abgeglichen' ORDER BY id DESC LIMIT 1",
  );
  const [nextScan] = await query(
    "SELECT available_at,updated_at,status,error FROM jobs WHERE dedupe_key='plex-scan-daily'",
  );
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
      <FriendsAdmin
        friends={friends}
        enabled={federationEnabled()}
        nickname={await instanceNickname()}
        demo={isDemo()}
      />
      <AdminControls
        demo={isDemo()}
        configured={configured}
        values={settings}
        publicUrl={process.env.PUBLIC_URL || ''}
        plexSections={plexSections}
        lastScan={lastScan ? { createdAt: lastScan.created_at, context: lastScan.context } : null}
        nextScan={
          nextScan
            ? {
                availableAt: nextScan.available_at,
                updatedAt: nextScan.updated_at,
                error: nextScan.error,
              }
            : null
        }
      />
      {isDemo() ? (
        <section className="panel">
          <h2>Sicherung und Umzug</h2>
          <p>
            Geza-Import und vollständiger Export sind in der Demo deaktiviert. Verbindungen zeigen
            ausschließlich Fantasieschlüssel; Änderungen und externe Abfragen sind gesperrt.
          </p>
          <a href="/api/demo/download">demo.geza herunterladen</a>
        </section>
      ) : (
        <TransferExport />
      )}
      <p>
        <a className="button" href="/admin/rumpelkammer">
          Rumpelkammer: {(rumpel.movies + rumpel.shows).toLocaleString('de-DE')} Titel ohne Sichtung,
          Bewertung und Bucketliste aufräumen
        </a>
      </p>
      <p>
        <a className="button" href="/admin/facetten">
          Länder und Genres: doppelte Schreibweisen zusammenführen
        </a>
      </p>
      <p>
        <a className="button" href="/admin/logs">
          Ereignisprotokoll: Webhooks und Fehler ansehen
        </a>
      </p>
      <p>
        <a className="button" href="/api/export">
          Medienauszug als JSON exportieren (kein Umzugsbackup)
        </a>
      </p>
      <div className="stats-columns">
        <JobDashboard initial={JSON.parse(JSON.stringify(overview))} />
        <section className="panel">
          <h2>Letzte Importe</h2>
          <p className="small muted">
            Historischer Stand beim Import. Korrekturen ändern diese Zahlen nicht.
          </p>
          <p>
            <a href="/admin/issues">Aktuell offene Fälle prüfen und bearbeiten</a>
          </p>
          {imports.length ? (
            imports.map((r, i) => (
              <div key={i}>
                <p>{new Date(r.started_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</p>
                <p className="muted">
                  {r.report?.watches?.toLocaleString('de-DE')} Ereignisse ·{' '}
                  {r.report?.ratings?.toLocaleString('de-DE')} Bewertungen · {r.report?.reviews} Kommentare
                </p>
                {r.report?.rumpel != null && (
                  <p className="small muted">
                    {r.report.rumpel.toLocaleString('de-DE')} Titel in der Rumpelkammer
                    {r.report.skippedDeleted
                      ? ` · ${r.report.skippedDeleted.toLocaleString('de-DE')} gelöschte übersprungen`
                      : ''}
                    .
                  </p>
                )}
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

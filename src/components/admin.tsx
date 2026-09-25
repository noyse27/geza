'use client';
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
type Props = {
  demo?: boolean;
  configured: Record<string, boolean>;
  values: Record<string, string>;
  publicUrl: string;
  plexSections: { key: string; title: string; type: string }[];
};
type ImportReport = {
  dryRun?: boolean;
  files: number;
  media: number;
  watches: number;
  unknownDates: number;
  ratings: number;
  reviews: number;
  providerCollisions?: unknown[];
  plexFollowup?: string;
};
const fields = [
  ['TMDB_TOKEN', 'TMDB Read Access Token'],
  ['TVDB_API_KEY', 'TVDB API-Key'],
  ['TVDB_PIN', 'TVDB PIN (falls erforderlich)'],
  ['PLEX_URL', 'Plex-Server URL'],
  ['PLEX_TOKEN', 'Plex-Token'],
  ['PLEX_ACCOUNT_ID', 'Plex Account-ID'],
  ['PLEX_SERVER_ID', 'Plex Server-UUID'],
  ['PLEX_WEBHOOK_SECRET', 'Webhook-Geheimnis'],
] as const;
const sensitive = new Set(['TMDB_TOKEN', 'TVDB_API_KEY', 'TVDB_PIN', 'PLEX_TOKEN', 'PLEX_WEBHOOK_SECRET']);
export function AdminControls({ configured, values, publicUrl, plexSections, demo = false }: Props) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [importing, setImporting] = useState(false),
    [importReport, setImportReport] = useState<ImportReport | null>(null),
    [shown, setShown] = useState<Record<string, boolean>>({}),
    [formValues, setFormValues] = useState<Record<string, string>>(values),
    [watchedOnly, setWatchedOnly] = useState(values.PLEX_SCAN_WATCHED_ONLY !== '0'),
    [scanEnabled, setScanEnabled] = useState(values.PLEX_SCAN_ENABLED !== '0'),
    [scanHour, setScanHour] = useState(Number(values.PLEX_SCAN_HOUR || '3')),
    [scanPreview, setScanPreview] = useState<{
      changed: number;
      changes: {
        id: string;
        title: string;
        kind: string;
        before: string;
        after: string;
        assignment_reason: string;
      }[];
    } | null>(null),
    [scanSections, setScanSections] = useState<string[]>(
      (values.PLEX_SCAN_SECTIONS || '').split(',').filter(Boolean),
    ),
    [origin, setOrigin] = useState('');
  const router = useRouter();
  useEffect(() => setOrigin(window.location.origin), []);
  const plexConfigured = configured.PLEX_URL && configured.PLEX_TOKEN;
  const webhookSecret = formValues.PLEX_WEBHOOK_SECRET || values.PLEX_WEBHOOK_SECRET || '';
  const webhookBase = publicUrl || origin;
  const webhookUrl = webhookSecret && webhookBase ? `${webhookBase}/api/plex/${webhookSecret}` : '';
  const plexIdentityUrl = useMemo(() => {
    const value = formValues.PLEX_URL?.trim();
    if (!value) return '';
    try {
      const url = new URL(value);
      url.pathname = '/identity';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return '';
    }
  }, [formValues.PLEX_URL]);
  async function action(body: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error((await r.json()).error);
      const data = await r.json();
      if (data.settings) setFormValues((current) => ({ ...current, ...data.settings }));
      if (data.preview) setScanPreview(data.preview);
      setMessage(
        data.message || (data.preview ? 'Vorschau berechnet; keine Zuordnung gespeichert.' : 'Gespeichert.'),
      );
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveScanSettings(next: { watchedOnly: boolean; enabled: boolean; sections: string[] }) {
    setWatchedOnly(next.watchedOnly);
    setScanEnabled(next.enabled);
    setScanSections(next.sections);
    await action({ action: 'plex-scan-settings', data: { ...next, hour: scanHour } });
  }
  async function uploadTrakt(form: HTMLFormElement, preview = false) {
    setImporting(true);
    setImportReport(null);
    setMessage('');
    try {
      const body = new FormData(form);
      if (preview) body.set('preview', '1');
      const r = await fetch('/api/import/trakt', { method: 'POST', body });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setImportReport(data.report);
      setMessage(
        data.report?.dryRun
          ? 'Import-Vorschau: Diese Datensätze würden verarbeitet. Nichts wurde gespeichert; vorhandene Dubletten wurden nicht abgeglichen.'
          : 'Trakt-Import abgeschlossen.',
      );
      if (!data.report?.dryRun) form.reset();
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setImporting(false);
    }
  }
  return (
    <>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void action({ action: 'settings', data: Object.fromEntries(f) });
        }}
      >
        <h2>Verbindungen{demo ? ' · Demo, schreibgeschützt' : ''}</h2>
        <p className="muted">
          Zugangsdaten werden verschlüsselt gespeichert. Geheime Werte bleiben maskiert, bis du sie per Auge
          einblendest.
        </p>
        <div className="form-grid">
          {fields.map(([key, label]) => (
            <label key={key}>
              {label}
              <span className={`connection-status ${configured[key] ? 'connected' : ''}`}>
                {configured[key] ? 'Eingerichtet' : 'Noch offen'}
              </span>
              <span className="secret-input">
                <input
                  readOnly={demo}
                  name={key}
                  type={sensitive.has(key) && !shown[key] ? 'password' : 'text'}
                  autoComplete="off"
                  value={formValues[key] || ''}
                  onChange={(event) =>
                    setFormValues((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
                {sensitive.has(key) && (
                  <button
                    className="icon-button"
                    type="button"
                    title={shown[key] ? 'Wert ausblenden' : 'Wert anzeigen'}
                    aria-label={shown[key] ? 'Wert ausblenden' : 'Wert anzeigen'}
                    onClick={() => setShown((current) => ({ ...current, [key]: !current[key] }))}
                  >
                    {shown[key] ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </span>
            </label>
          ))}
        </div>
        <div className="button-row">
          <button className="button primary" disabled={busy}>
            Verbindungen speichern
          </button>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => action({ action: 'generate-webhook-secret' })}
          >
            <RefreshCw size={16} /> Webhook-Secret generieren
          </button>
        </div>
      </form>
      {plexConfigured ? (
        <div className="panel">
          <h2>Plex-Webhook</h2>
          <p className="muted">
            Diese Adresse trägst du in Plex als Webhook ein. Das Secret am Ende gehört nur dir und kann bei
            Bedarf neu erzeugt werden.
          </p>
          <div className="webhook-box">
            <code>{webhookUrl || 'Erst ein Webhook-Geheimnis speichern oder generieren.'}</code>
            <button
              className="icon-button"
              type="button"
              disabled={!webhookUrl}
              title="Webhook-Adresse kopieren"
              aria-label="Webhook-Adresse kopieren"
              onClick={() => {
                if (webhookUrl) void navigator.clipboard.writeText(webhookUrl);
              }}
            >
              <Copy size={16} />
            </button>
          </div>
          <div className="form-grid webhook-help">
            <label>
              Account-ID aus dem Plex-Webhook
              <span className="secret-input">
                <input readOnly value={formValues.PLEX_ACCOUNT_ID || ''} />
                <button
                  className="icon-button"
                  type="button"
                  title="Account-ID kopieren"
                  aria-label="Account-ID kopieren"
                  disabled={!formValues.PLEX_ACCOUNT_ID}
                  onClick={() => void navigator.clipboard.writeText(formValues.PLEX_ACCOUNT_ID || '')}
                >
                  <Copy size={16} />
                </button>
              </span>
            </label>
            <label>
              Server-UUID
              <span className="secret-input">
                <input readOnly value={formValues.PLEX_SERVER_ID || ''} />
                <button
                  className="icon-button"
                  type="button"
                  title="Server-UUID kopieren"
                  aria-label="Server-UUID kopieren"
                  disabled={!formValues.PLEX_SERVER_ID}
                  onClick={() => void navigator.clipboard.writeText(formValues.PLEX_SERVER_ID || '')}
                >
                  <Copy size={16} />
                </button>
              </span>
            </label>
            <label>
              Plex Identity-URL
              <input readOnly value={plexIdentityUrl || ''} />
            </label>
          </div>
        </div>
      ) : (
        <div className="panel">
          <h2>Plex-Funktionen</h2>
          <p className="muted">
            Speichere zuerst Plex-Server-URL und -Token oben unter „Verbindungen“, um Webhook,
            Bibliotheks-Scan und Review-Abgleich zu nutzen.
          </p>
        </div>
      )}
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void uploadTrakt(e.currentTarget);
        }}
      >
        <h2>{demo ? 'Trakt-Import ausprobieren' : 'Trakt-Export importieren'}</h2>
        <p className="muted">
          Lade die ZIP aus deinem Trakt-Export hoch. Geza entpackt sie, erkennt die passenden JSON-Dateien und
          importiert Sichtungen, Watchlist, Bewertungen, Reviews und Sammlung.
        </p>
        <h3>Einordnung nach dem Import</h3>
        <p>
          {plexConfigured
            ? `Anschließend wird Plex abgeglichen. ${watchedOnly ? 'Vorhandene ungesehene Filme und Serien kommen in die Bucketliste; bei begonnenen Serien nur Staffeln ohne gesehene Episode.' : 'Die automatische Aufnahme des Plex-Bestands ist ausgeschaltet.'}`
            : 'Du kannst jetzt schon importieren. Collection-Titel ohne eigene Aktivität bleiben zunächst in der Rumpelkammer. Sobald Plex verbunden ist, wird der vorhandene Bestand ohne erneuten Import eingeordnet.'}
        </p>
        {!plexConfigured && (
          <label className="checkbox">
            <input type="checkbox" name="collectionWishes" />
            Ungesehene Collection-Titel als Wünsche übernehmen (keine bestätigte Verfügbarkeit)
          </label>
        )}
        {demo && (
          <p>
            Nur Vorschau (max. 10 MiB ZIP / 20 MiB JSON): Es werden keine importierten Daten gespeichert. Kein
            Dublettenabgleich.
          </p>
        )}
        <div className="upload-box">
          <input name="file" type="file" accept=".zip,application/zip" required />
          <button
            type="button"
            className="button"
            disabled={importing || busy}
            onClick={(e) => {
              const form = e.currentTarget.form;
              if (form?.reportValidity()) void uploadTrakt(form, true);
            }}
          >
            Import-Vorschau
          </button>
          <button className="button primary" disabled={importing || busy}>
            {importing ? 'Import lauft ...' : 'ZIP importieren'}
          </button>
        </div>
        {importReport && (
          <div className="import-report" role="status">
            {importReport.plexFollowup && (
              <p>
                {importReport.plexFollowup === 'queued'
                  ? 'Import gespeichert. Plex-Abgleich eingeplant.'
                  : importReport.plexFollowup === 'failed-to-queue'
                    ? 'Import gespeichert. Plex-Abgleich konnte nicht eingeplant werden; bitte manuell starten.'
                    : 'Import gespeichert. Plex-Prüfung erfolgt nach Einrichtung.'}
              </p>
            )}
            <span>
              Dateien <strong>{importReport.files.toLocaleString('de-DE')}</strong>
            </span>
            <span>
              Titel <strong>{importReport.media.toLocaleString('de-DE')}</strong>
            </span>
            <span>
              Watches <strong>{importReport.watches.toLocaleString('de-DE')}</strong>
            </span>
            <span>
              Bewertungen <strong>{importReport.ratings.toLocaleString('de-DE')}</strong>
            </span>
            <span>
              Reviews <strong>{importReport.reviews.toLocaleString('de-DE')}</strong>
            </span>
            <span>
              Unklare Zeiten <strong>{importReport.unknownDates.toLocaleString('de-DE')}</strong>
            </span>
          </div>
        )}
      </form>
      <div className="panel">
        <h2>Metadaten ergänzen</h2>
        <p className="muted">
          Erst Plex, danach TMDB für Filme und TVDB für Serien. Dein Tagebuch bleibt währenddessen benutzbar.
        </p>
        <div className="button-row">
          <button className="button primary" disabled={busy} onClick={() => action({ action: 'enrich' })}>
            Fehlende Metadaten laden
          </button>
          <button className="button" disabled={busy} onClick={() => action({ action: 'retry' })}>
            Fehlgeschlagene Aufgaben wiederholen
          </button>
        </div>
      </div>
      {plexConfigured && (
        <div className="panel">
          <h2>Plex-Bibliotheks-Scan</h2>
          <p className="muted">
            Prüft den aktuellen Bestand einschließlich Staffeln. Eine vollständig ungesehene Serie erscheint
            einmal auf der Bucketliste; bei begonnenen Serien nur vorhandene Staffeln ohne gesehene Episode.
            Sichtungen aus Trakt und Geza zählen mit. Specials (Staffel 0) werden wie andere Staffeln
            behandelt.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={watchedOnly}
              disabled={busy}
              onChange={(e) =>
                void saveScanSettings({
                  watchedOnly: e.target.checked,
                  enabled: scanEnabled,
                  sections: scanSections,
                })
              }
            />
            Ungesehenen Plex-Bestand automatisch in die Bucketliste übernehmen
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={scanEnabled}
              disabled={busy}
              onChange={(e) =>
                void saveScanSettings({ watchedOnly, enabled: e.target.checked, sections: scanSections })
              }
            />
            Plex-Abgleich täglich automatisch ausführen
          </label>
          <label>
            Uhrzeit (Europe/Berlin)
            <select
              value={scanHour}
              disabled={busy}
              onChange={(e) => {
                const hour = Number(e.target.value);
                setScanHour(hour);
                void action({
                  action: 'plex-scan-settings',
                  data: { watchedOnly, enabled: scanEnabled, sections: scanSections, hour },
                });
              }}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, '0')}:00 Uhr
                </option>
              ))}
            </select>
          </label>
          {plexSections.length > 0 && (
            <fieldset>
              <legend>Bibliotheken für automatische Wünsche</legend>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={!scanSections.length}
                  disabled={busy}
                  onChange={(e) =>
                    void saveScanSettings({
                      watchedOnly,
                      enabled: scanEnabled,
                      sections: e.target.checked ? [] : ['none'],
                    })
                  }
                />
                Alle Bibliotheken
              </label>
              <p className="muted">
                Die Verfügbarkeit wird immer in allen Bibliotheken geprüft. Die Auswahl begrenzt automatische
                Wünsche.
              </p>
              {plexSections.map((s) => (
                <label key={s.key} className="checkbox">
                  <input
                    type="checkbox"
                    checked={scanSections.includes(s.key)}
                    disabled={busy}
                    onChange={(e) =>
                      void saveScanSettings({
                        watchedOnly,
                        enabled: scanEnabled,
                        sections: e.target.checked
                          ? [...scanSections.filter((k) => k !== 'none'), s.key]
                          : scanSections.filter((k) => k !== s.key).length
                            ? scanSections.filter((k) => k !== s.key)
                            : ['none'],
                      })
                    }
                  />
                  {s.title} ({s.type === 'movie' ? 'Filme' : 'Serien'})
                </label>
              ))}
            </fieldset>
          )}
          <div className="button-row">
            <button
              className="button"
              disabled={busy}
              onClick={() => action({ action: 'plex-scan-preview' })}
            >
              Änderungen vorab prüfen
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => action({ action: 'plex-scan' })}
            >
              Jetzt scannen
            </button>
          </div>
          {scanPreview && (
            <div>
              <h3>Vorschau: {scanPreview.changed} Änderungen</h3>
              <p>
                Bis zu 200 Änderungen werden angezeigt. „Jetzt scannen“ prüft den dann aktuellen Bestand
                erneut.
              </p>
              <ul>
                {scanPreview.changes.map((c) => (
                  <li key={c.id}>
                    {c.title} ({c.kind}): {c.before} → {c.after} · {c.assignment_reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {plexConfigured && (
        <div className="panel">
          <h2>Plex-Reviews nachziehen</h2>
          <p className="muted">
            Ruft für alle Titel mit Plex-Verweis die persönliche Plex-Review erneut ab und speichert sie.
            Läuft im Hintergrund über die Warteschlange, ein erneuter Klick stößt einen frischen Abgleich an.
          </p>
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => action({ action: 'plex-review-batch' })}
            >
              Plex-Reviews für alle Titel abgleichen
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </>
  );
}

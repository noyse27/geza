'use client';
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
type Props = {
  configured: Record<string, boolean>;
  values: Record<string, string>;
  publicUrl: string;
};
type ImportReport = {
  files: number;
  media: number;
  watches: number;
  unknownDates: number;
  ratings: number;
  reviews: number;
  providerCollisions?: unknown[];
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
export function AdminControls({ configured, values, publicUrl }: Props) {
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [importing, setImporting] = useState(false),
    [importReport, setImportReport] = useState<ImportReport | null>(null),
    [shown, setShown] = useState<Record<string, boolean>>({}),
    [formValues, setFormValues] = useState<Record<string, string>>(values),
    [origin, setOrigin] = useState('');
  const router = useRouter();
  useEffect(() => setOrigin(window.location.origin), []);
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
      setMessage('Gespeichert.');
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadTrakt(form: HTMLFormElement) {
    setImporting(true);
    setImportReport(null);
    setMessage('');
    try {
      const r = await fetch('/api/import/trakt', { method: 'POST', body: new FormData(form) });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setImportReport(data.report);
      setMessage('Trakt-Import abgeschlossen.');
      form.reset();
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
        <h2>Verbindungen</h2>
        <p className="muted">
          Zugangsdaten werden verschlüsselt gespeichert. Geheime Werte bleiben maskiert, bis du sie per
          Auge einblendest.
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
      <div className="panel">
        <h2>Plex-Webhook</h2>
        <p className="muted">
          Diese Adresse trägst du in Plex als Webhook ein. Das Secret am Ende gehört nur dir und kann
          bei Bedarf neu erzeugt werden.
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
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void uploadTrakt(e.currentTarget);
        }}
      >
        <h2>Trakt-Export importieren</h2>
        <p className="muted">
          Lade die ZIP aus deinem Trakt-Export hoch. Geza entpackt sie, erkennt die passenden JSON-Dateien
          und importiert Watch-History, Bewertungen, Reviews und Sammlung.
        </p>
        <div className="upload-box">
          <input name="file" type="file" accept=".zip,application/zip" required />
          <button className="button primary" disabled={importing || busy}>
            {importing ? 'Import lauft ...' : 'ZIP importieren'}
          </button>
        </div>
        {importReport && (
          <div className="import-report" role="status">
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
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </>
  );
}

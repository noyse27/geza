'use client';
import { useEffect, useState } from 'react';
import { LoginForm } from './login';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function TransferExport() {
  const [key, setKey] = useState(''),
    [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <section className="panel">
      <h2>Sicherung und Umzug</h2>
      <p>
        Vollständiger Nutzdatenexport einschließlich Cover, History, Reviews, Filmreihen und offener
        Scrobbles. Konten und Zugangsdaten sind verschlüsselt. Persönliche Mediendaten einschließlich
        Entwürfen und privater History sind ohne Schlüssel lesbar.
      </p>
      {!key ? (
        <button
          className="button"
          onClick={() => {
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            setKey(
              Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
                .join('')
                .match(/.{8}/g)!
                .join('-'),
            );
          }}
        >
          Umzugsexport vorbereiten
        </button>
      ) : (
        <>
          <label>
            Wiederherstellungsschlüssel
            <input readOnly value={key} onFocus={(e) => e.target.select()} />
          </label>
          <p>
            Den Schlüssel separat und sicher aufbewahren. Ohne ihn können Konten und API-Zugänge nicht
            wiederhergestellt werden.
          </p>
          <div className="button-row">
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(key);
                  setMessage('Schlüssel kopiert.');
                } catch {
                  setMessage('Bitte den Schlüssel im Feld markieren und kopieren.');
                }
              }}
            >
              Schlüssel kopieren
            </button>
            <button
              className="button"
              onClick={() =>
                download(
                  new Blob([key + '\n'], { type: 'text/plain' }),
                  'geza-wiederherstellungsschluessel.txt',
                )
              }
            >
              Schlüssel herunterladen
            </button>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Ich habe
            den Schlüssel separat gesichert.
          </label>
          <button
            className="button primary"
            disabled={!saved || busy}
            onClick={async () => {
              setBusy(true);
              setMessage('Vollständiger Export wird erstellt …');
              try {
                const response = await fetch('/api/transfer/export', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ key }),
                });
                if (!response.ok) throw Error((await response.json()).error);
                download(await response.blob(), `geza-${new Date().toISOString().slice(0, 10)}.geza`);
                setMessage('Export erstellt. Exportdatei und Schlüssel für den Umzug aufbewahren.');
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Export läuft …' : 'Vollständige Exportdatei herunterladen'}
          </button>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}

type Preview = {
  exportedAt: string;
  counts: Record<string, number>;
  modules: string[];
  unlocked: boolean;
  hasAccount: boolean;
};
const labels: Record<string, string> = {
  media: 'Medieneinträge',
  watches: 'Anschauereignisse',
  ratings: 'Bewertungen',
  reviews: 'Eigene Reviews',
  posters: 'Gespeicherte Cover',
  friend_reviews: 'Externe Reviews',
  provider_ratings: 'Anbieterbewertungen',
  film_series: 'Filmreihen',
  film_series_members: 'Filmreihenzuordnungen',
  review_boxes: 'Reviewanbieter',
  jobs: 'Hintergrundaufgaben / Scrobbles',
  import_runs: 'Importberichte',
};
export function SetupWizard() {
  const [mode, setMode] = useState<'loading' | 'choose' | 'new' | 'restore' | 'admin' | 'done' | 'locked'>(
    'loading',
  );
  const [file, setFile] = useState<File | null>(null),
    [key, setKey] = useState('');
  const [accounts, setAccounts] = useState(true),
    [apiKeys, setApiKeys] = useState(true),
    [modules, setModules] = useState(true);
  const [withoutKey, setWithoutKey] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/setup/transfer')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        setMode(!result.owned ? 'locked' : result.needsAdmin ? 'admin' : 'choose');
      })
      .catch((error) => setError(error.message));
  }, []);
  async function submit(action: 'inspect' | 'restore') {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set(
        'options',
        JSON.stringify({
          action,
          key,
          accounts: withoutKey ? false : accounts,
          apiKeys: withoutKey ? false : apiKeys,
          modules,
          withoutKey,
        }),
      );
      const response = await fetch('/api/setup/transfer', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (action === 'inspect') {
        setPreview(result);
        setAccounts(result.hasAccount);
      } else {
        setKey('');
        setFile(null);
        setMode(result.needsAdmin ? 'admin' : 'done');
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (mode === 'new')
    return (
      <div>
        <button className="text-link" onClick={() => setMode('choose')}>
          Zurück
        </button>
        <LoginForm setupRequired />
      </div>
    );
  if (mode === 'admin')
    return (
      <div>
        <p role="status">
          Nutzdaten erfolgreich importiert. Zum Abschluss einen neuen Admin anlegen. Geza bleibt bis dahin
          gesperrt.
        </p>
        <p>
          API-Zugänge wurden entsprechend deiner Auswahl übernommen. Fehlende Zugänge und den neuen
          Plex-Webhook anschließend unter Admin einrichten.
        </p>
        <LoginForm setupRequired />
      </div>
    );
  if (mode === 'done')
    return (
      <div>
        <p role="status">
          Wiederherstellung erfolgreich. Melde dich mit deinem bisherigen Admin und Passwort an.
        </p>
        <p>
          Unter Admin die Verbindungen prüfen und die neue Webhook-Adresse in Plex eintragen. Alte
          Hintergrundaufgaben wurden pausiert.
        </p>
        <LoginForm />
      </div>
    );
  return (
    <section className="panel login-form" aria-busy={busy}>
      <h2>Geza einrichten</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {mode === 'loading' && <p>Einrichtung wird geladen …</p>}
      {mode === 'locked' && (
        <p>Die Daten wurden bereits importiert. Bitte im ursprünglichen Browser den neuen Admin anlegen.</p>
      )}
      {mode === 'choose' && (
        <div className="button-row">
          <button className="button" onClick={() => setMode('new')}>
            Neu einrichten
          </button>
          <button className="button primary" onClick={() => setMode('restore')}>
            Geza wiederherstellen
          </button>
        </div>
      )}
      {mode === 'restore' && (
        <>
          <p>
            Für eine leere Installation. Vorhandene Installationen werden nicht zusammengeführt. Maximal 256
            MiB Exportdatei / 512 MiB entpackte Daten.
          </p>
          <label>
            Geza-Exportdatei
            <input
              type="file"
              accept=".geza"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
                setWithoutKey(false);
              }}
            />
          </label>
          <label>
            Wiederherstellungsschlüssel
            <input
              type="password"
              autoComplete="off"
              value={key}
              disabled={busy}
              onChange={(e) => {
                setKey(e.target.value);
                setPreview(null);
                setWithoutKey(false);
              }}
            />
          </label>
          <button className="button" disabled={!file || busy} onClick={() => submit('inspect')}>
            {busy ? 'Bitte warten …' : 'Datei und Schlüssel prüfen'}
          </button>
          {preview && (
            <>
              <h3>Export vom {new Date(preview.exportedAt).toLocaleString('de-DE')}</h3>
              <dl>
                {Object.entries(preview.counts).map(([table, count]) => (
                  <div className="status-row" key={table}>
                    <dt>{labels[table] || table}</dt>
                    <dd>{count.toLocaleString('de-DE')}</dd>
                  </div>
                ))}
              </dl>
              {!preview.unlocked && (
                <p role="alert">
                  {key
                    ? 'Der Schlüssel passt nicht oder die Zugangsdaten sind beschädigt.'
                    : 'Kein Schlüssel angegeben.'}{' '}
                  Erneut versuchen oder ausdrücklich ohne Konten und Zugangsdaten fortfahren. Dann musst du
                  einen neuen Admin anlegen und alle API-Zugänge neu eintragen.
                </p>
              )}
              <label className="checkbox">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={withoutKey}
                  onChange={(e) => setWithoutKey(e.target.checked)}
                />{' '}
                Ohne Konten und Zugangsdaten fortfahren
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  disabled={busy || !preview.unlocked || !preview.hasAccount || withoutKey}
                  checked={!withoutKey && accounts}
                  onChange={(e) => setAccounts(e.target.checked)}
                />{' '}
                Admin-Konto mit bisherigem Passwort übernehmen
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  disabled={busy || !preview.unlocked || withoutKey}
                  checked={!withoutKey && apiKeys}
                  onChange={(e) => setApiKeys(e.target.checked)}
                />{' '}
                API-Schlüssel und Verbindungen übernehmen
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={modules}
                  onChange={(e) => setModules(e.target.checked)}
                />{' '}
                Bisher aktive Reviewmodule wieder aktivieren
              </label>
              <p className="muted">
                {preview.modules.length ? preview.modules.join(', ') : 'Keine aktiven Module im Export.'}{' '}
                Gespeicherte Reviews bleiben in jedem Fall erhalten.
              </p>
              <button
                className="button primary"
                disabled={busy || (!withoutKey && (!preview.unlocked || (!accounts && !apiKeys)))}
                onClick={() => submit('restore')}
              >
                Jetzt wiederherstellen
              </button>
            </>
          )}
          {busy && (
            <p role="status">
              Datei wird übertragen und geprüft. Beim Import werden alle Daten gemeinsam übernommen. Bitte
              diese Seite geöffnet lassen.
            </p>
          )}
          <button className="text-link" disabled={busy} onClick={() => setMode('choose')}>
            Zurück
          </button>
        </>
      )}
    </section>
  );
}

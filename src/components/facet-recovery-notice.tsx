'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
type Status = {
  status: string;
  error: string | null;
  unresolved: number;
  payload: {
    phase: string;
    total: number;
    checked: number;
    dismissed?: boolean;
    countries?: number;
    genres?: number;
  };
  issues: { id: string; title: string; note: string }[];
};
export function FacetRecoveryNotice() {
  const router = useRouter();
  const lastStatus = useRef<string | null>(null);
  const [state, setState] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/admin/facet-recovery', { cache: 'no-store' });
        if (!response.ok) throw Error('Fortschritt kann gerade nicht geladen werden.');
        const data = await response.json();
        if (lastStatus.current && lastStatus.current !== data?.status) router.refresh();
        lastStatus.current = data?.status ?? null;
        if (!stopped) {
          setState(data);
          setError('');
        }
      } catch {
        if (!stopped) setError('Fortschritt kann gerade nicht geladen werden.');
      }
      if (!stopped) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [router]);
  if (!state || state.payload.dismissed) return null;
  const running = ['pending', 'running'].includes(state.status);
  async function action(action: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/facet-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw Error('Aktion konnte nicht gespeichert werden.');
      setState(await (await fetch('/api/admin/facet-recovery', { cache: 'no-store' })).json());
      router.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="facet-recovery-notice" aria-label="Wiederherstellung der Originalwerte">
      <strong>Länder und Genres: Originalwerte</strong>
      <p role="status">
        {running
          ? state.payload.phase === 'aliases'
            ? 'Quellprüfung abgeschlossen. Gespeicherte Alias-Regeln werden angewendet …'
            : `Einmalige Prüfung nach dem Update: ${state.payload.checked || 0} von ${state.payload.total} Titeln geprüft.`
          : state.status === 'failed'
            ? 'Die Wiederherstellung wurde unterbrochen.'
            : state.unresolved
              ? `Prüfung abgeschlossen. Bei ${state.unresolved} Titeln fehlen noch eindeutige Originalwerte.`
              : 'Originalwerte wiederhergestellt und bestehende Alias-Regeln angewendet.'}
      </p>
      {running && (
        <>
          <progress max={Math.max(1, state.payload.total)} value={state.payload.checked || 0} />
          <p>Geza bleibt nutzbar. Zuordnungen sind bis zum Abschluss gesperrt.</p>
        </>
      )}
      {state.error && <p className="error">{state.error}</p>}
      {!!state.issues.length && (
        <details>
          <summary>Offene Titel prüfen ({state.unresolved})</summary>
          <p>
            Die betroffenen Werte bleiben unverändert. Originalwerte im Titel korrigieren oder die Quellen
            erneut prüfen.
          </p>
          <ul>
            {state.issues.map((item) => (
              <li key={item.id}>
                <a href={`/title/${item.id}`}>{item.title}</a>
                <small>{item.note}</small>
              </li>
            ))}
          </ul>
          {state.unresolved > 20 && (
            <p>Die ersten 20 offenen Titel. Korrigierte Titel verschwinden aus der Liste.</p>
          )}
        </details>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!running && (
        <div className="button-row">
          {(state.status === 'failed' || state.unresolved > 0) && (
            <button className="button" disabled={busy} onClick={() => action('retry')}>
              Erneut prüfen
            </button>
          )}
          <button className="button" disabled={busy} onClick={() => action('dismiss')}>
            Schließen
          </button>
        </div>
      )}
    </aside>
  );
}

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function IdCorrection({ mediaId, ids }: { mediaId: string; ids: Record<string, string | number> }) {
  // Keep the version the form was opened with, even when background refreshes update props.
  const [expected, setExpected] = useState(ids);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const router = useRouter();
  return (
    <details>
      <summary>Anbieter-IDs korrigieren</summary>
      <p>
        Nur falsche Zuordnungen ändern. Ein leeres Feld entfernt die betreffende ID; Sichtungen und
        Bewertungen bleiben erhalten. Die Plex-ID ist der 24-stellige Schlüssel, ohne „plex://movie/“.
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          try {
            const response = await fetch('/api/admin/issues', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mediaId,
                expected,
                ids: Object.fromEntries(
                  ['imdb', 'tmdb', 'tvdb', 'plex'].map((key) => [key, String(form.get(key) || '').trim()]),
                ),
              }),
            });
            const data = await response.json();
            setMessage(data.error || data.message);
            if (response.ok) {
              setExpected(data.ids);
              router.refresh();
            }
          } catch {
            setMessage('Verbindung fehlgeschlagen.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {['imdb', 'tmdb', 'tvdb', 'plex'].map((key) => (
          <label key={key}>
            {key.toUpperCase()}
            <input name={key} defaultValue={ids[key] ?? ''} />
          </label>
        ))}
        <button className="button" disabled={busy}>
          {busy ? 'Speichert …' : 'IDs speichern'}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </details>
  );
}

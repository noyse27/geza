'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SeriesCatalog({
  mediaId,
  checked,
  configured,
}: {
  mediaId: string;
  checked: boolean;
  configured: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const router = useRouter();
  return (
    <div className="season-catalog">
      <p className="muted small">
        {!configured
          ? 'Für den vollständigen Episodenkatalog bitte TMDB im Adminbereich einrichten.'
          : checked
            ? 'Staffeln und Episoden aus dem Serienkatalog ergänzt.'
            : 'Der vollständige Episodenkatalog wird mit TMDB im Hintergrund ergänzt.'}
      </p>
      <button
        className="text-link"
        disabled={busy || !configured}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            const response = await fetch('/api/admin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'series-catalog', mediaId }),
            });
            const result = await response.json();
            if (!response.ok) throw Error(result.error);
            setMessage(`${result.seasons} Staffeln, ${result.episodes} Episoden abgeglichen.`);
            router.refresh();
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Katalog wird geladen …' : 'Staffeln und Episoden ergänzen'}
      </button>
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
    </div>
  );
}

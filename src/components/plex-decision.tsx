'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function PlexDecision({
  mediaId,
  ids,
  details,
  selected,
}: {
  mediaId: string;
  ids: Record<string, string>;
  details: Record<string, any>;
  selected: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(remove = false) {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/plex-decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId,
          expected: ids,
          ratingKey: String(details.ratingKey),
          providerIds: details.providerIds,
          providerIdValues: details.providerIdValues,
          serverId: details.serverId,
          guid: details.guid,
          remove,
        }),
      });
      const result = await response.json();
      setMessage(result.message || result.error);
      if (response.ok) router.refresh();
    } catch {
      setMessage('Verbindung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {selected ? (
        <>
          <p>Dieser Datensatz ist dauerhaft für den Plex-Eintrag ausgewählt.</p>
          <button className="button" disabled={busy} onClick={() => save(true)}>
            Zuordnung aufheben
          </button>
        </>
      ) : (
        <button className="button" disabled={busy} onClick={() => save()}>
          {busy ? 'Wird gespeichert …' : 'Diesen Datensatz dauerhaft verwenden'}
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

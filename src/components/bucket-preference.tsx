'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function BucketPreference({ id, preference }: { id: string; preference: string }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <label>
      Bucketliste{' '}
      <select
        value={preference}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError('');
          try {
            const r = await fetch('/api/admin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'bucketlist-preference', id, preference: e.target.value }),
            });
            if (!r.ok) throw Error('Zuordnung konnte nicht gespeichert werden.');
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="auto">Automatisch einordnen</option>
        <option value="include">Manueller Wunsch (bis zur Sichtung)</option>
        <option value="exclude">Von der Bucketliste ausschließen</option>
      </select>
      {error && <span role="alert">{error}</span>}
    </label>
  );
}

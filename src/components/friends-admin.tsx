'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export type FriendRow = {
  id: string;
  url: string;
  nickname: string;
  status: 'outgoing' | 'incoming' | 'accepted';
};
export function FriendsAdmin({
  friends,
  enabled,
  nickname,
  demo,
}: {
  friends: FriendRow[];
  enabled: boolean;
  nickname: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function send(body: object, success = '') {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Aktion fehlgeschlagen.');
      setMessage(success);
      router.refresh();
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const group = (status: FriendRow['status']) => friends.filter((f) => f.status === status);
  return (
    <section className="panel" id="friends">
      <h2>Friends of Geza</h2>
      <p>
        Befreundete Geza-Instanzen zeigen sich gegenseitig, ob sie zu einem Titel eine Bewertung oder ein
        Review haben. Der Review-Text wird nicht übertragen. Deine Instanz heißt bei Freunden{' '}
        <strong>{nickname}</strong> (änderbar unter Verbindungen).
      </p>
      {!enabled && (
        <p className="error" role="alert">
          {demo
            ? 'In der Demo nicht verfügbar.'
            : 'Friends of Geza braucht eine gesetzte PUBLIC_URL, damit Freunde dich erreichen können.'}
        </p>
      )}
      {enabled && (
        <form
          className="friend-request"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const url = String(new FormData(form).get('url') || '').trim();
            const sent = await send(
              { action: 'friend-request', url },
              'Anfrage gesendet. Die andere Instanz muss sie bestätigen.',
            );
            if (sent) form.reset();
          }}
        >
          <label>
            Adresse der befreundeten Geza-Instanz
            <input name="url" type="url" placeholder="https://geza.example.org" required disabled={busy} />
          </label>
          <button className="button primary" disabled={busy}>
            Freundschaft beantragen
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {group('incoming').length > 0 && (
        <>
          <h3>Offene Anfragen an dich</h3>
          <ul>
            {group('incoming').map((f) => (
              <li key={f.id}>
                <strong>{f.nickname}</strong> ({f.url}) möchte sich mit dir verbinden.{' '}
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    send({ action: 'friend-accept', id: f.id }, `${f.nickname} ist jetzt befreundet.`)
                  }
                >
                  Annehmen
                </button>{' '}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => send({ action: 'friend-remove', id: f.id })}
                >
                  Ablehnen
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {group('outgoing').length > 0 && (
        <>
          <h3>Gesendete Anfragen</h3>
          <ul>
            {group('outgoing').map((f) => (
              <li key={f.id}>
                {f.url} wartet auf Bestätigung.{' '}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => send({ action: 'friend-remove', id: f.id })}
                >
                  Zurückziehen
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {group('accepted').length > 0 && (
        <>
          <h3>Freunde</h3>
          <ul>
            {group('accepted').map((f) => (
              <li key={f.id}>
                <strong>{f.nickname}</strong> ({f.url}){' '}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Freundschaft mit ${f.nickname} beenden?`))
                      void send({ action: 'friend-remove', id: f.id });
                  }}
                >
                  Beenden
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

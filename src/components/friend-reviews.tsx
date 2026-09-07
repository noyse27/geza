'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type FriendReview = {
  provider: string;
  url: string | null;
  rating: string | number | null;
  status: string;
  name?: string;
  scale?: number;
};
export function FriendReviews({
  mediaId,
  rows,
  admin,
  title,
  year,
}: {
  mediaId: string;
  rows: FriendReview[];
  admin: boolean;
  title: string;
  year: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!rows.length) return null;
  return (
    <section className="friend-reviews">
      <span className="eyebrow">ANDERE PERSPEKTIVEN</span>
      <h2>Reviews bei Freunden</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="friend-grid">
        {rows.map((row) => {
          const provider = row.provider;
          const name =
            provider === 'wortvogel'
              ? 'wortvogel.de'
              : provider === 'filmdienst'
                ? 'Filmdienst.de'
                : row?.name || 'Neue Quelle';
          const scale = row?.scale || 5;
          return (
            <article className="panel" key={provider}>
              <h3>{name}</h3>
              {provider !== 'wortvogel' && row?.url && row.rating != null && (
                <p
                  className="accent"
                  aria-label={`${Number(row.rating).toLocaleString('de-DE')} von ${scale} Sternen`}
                >
                  ★ {Number(row.rating).toLocaleString('de-DE')} / {scale} Sterne
                </p>
              )}
              {row?.url ? (
                <a className="text-link" href={row.url} target="_blank" rel="noopener noreferrer">
                  Zum Review ↗
                </a>
              ) : (
                <p className="muted small">Noch kein Review verlinkt.</p>
              )}
              {admin && (
                <>
                  {provider === 'filmdienst' && (
                    <p className="muted small">
                      {row?.status === 'pending'
                        ? 'Suche im Hintergrund vorgemerkt.'
                        : row?.status === 'missing'
                          ? 'Kein eindeutiger Treffer gefunden.'
                          : row?.status === 'error'
                            ? 'Quelle derzeit nicht abrufbar. Neuer Versuch frühestens nach einem Tag.'
                            : ''}{' '}
                      <a
                        href={`https://www.filmdienst.de/suche/alle?searchText=${encodeURIComponent(`${title} ${year || ''}`)}#results`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Bei Filmdienst suchen ↗
                      </a>
                    </p>
                  )}
                  <button
                    className="text-link"
                    onClick={() => {
                      setEditing(editing === provider ? '' : provider);
                      setError('');
                    }}
                  >
                    Link / Angaben bearbeiten
                  </button>
                  {editing === provider && (
                    <form
                      className="review-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setBusy(true);
                        setError('');
                        const data = new FormData(e.currentTarget);
                        try {
                          const response = await fetch('/api/admin', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'friend-review',
                              id: mediaId,
                              data: {
                                provider,
                                name: String(data.get('name') || name),
                                scale: Number(scale),
                                url: String(data.get('url') || ''),
                                rating: data.get('rating') ? Number(data.get('rating')) : null,
                              },
                            }),
                          });
                          if (!response.ok) throw Error('Bitte Link und Bewertung prüfen.');
                          setEditing('');
                          router.refresh();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <label>
                        Review-Link (leer lassen zum Entfernen)
                        <input
                          name="url"
                          type="url"
                          maxLength={2000}
                          defaultValue={row?.url || ''}
                          placeholder={`https://${provider === 'wortvogel' ? 'wortvogel.de/' : 'www.filmdienst.de/film/details/'}`}
                        />
                      </label>
                      {provider.startsWith('custom-') && (
                        <>
                          <label>
                            Bewertung (optional)
                            <input
                              name="rating"
                              type="number"
                              min="0"
                              max={scale}
                              step="0.1"
                              defaultValue={row?.rating ?? ''}
                            />
                          </label>
                        </>
                      )}
                      {provider === 'filmdienst' && (
                        <label>
                          Filmdienst-Sterne
                          <select name="rating" defaultValue={row?.rating ?? ''}>
                            <option value="">Keine Angabe</option>
                            {Array.from({ length: 11 }, (_, i) => (
                              <option key={i} value={i / 2}>
                                {(i / 2).toLocaleString('de-DE')} / 5
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {error && (
                        <p role="alert" className="error">
                          {error}
                        </p>
                      )}
                      <button className="button primary" disabled={busy}>
                        {busy ? 'Speichert …' : 'Speichern'}
                      </button>
                      <p className="muted small">Manuelle Angaben werden nicht automatisch überschrieben.</p>
                    </form>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

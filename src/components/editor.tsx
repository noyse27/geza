'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Save, X, Globe, LockKeyhole, Trash2 } from 'lucide-react';
import type { Media } from '@/lib/types';
import { AssignmentEditor } from './assignment-editor';
import { DeleteMediaButton } from './delete-media-button';
async function post(body: unknown) {
  const r = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw Error((await r.json()).error || 'Speichern fehlgeschlagen');
}
export function MediaEditor({ item }: { item: Media }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const router = useRouter();
  return (
    <>
      <div className="button-row media-actions">
        <button className="button" onClick={() => setOpen(!open)}>
          <Pencil size={15} /> Details bearbeiten
        </button>
        {['episode', 'season'].includes(item.kind) && <AssignmentEditor item={item} />}
        <DeleteMediaButton item={item} />
      </div>
      {open && (
        <div className="modal-backdrop">
          <section role="dialog" aria-modal="true" aria-label="Details bearbeiten" className="modal">
            <div className="section-heading">
              <h2>Details bearbeiten</h2>
              <button className="icon-button" onClick={() => setOpen(false)} aria-label="Schließen">
                <X />
              </button>
            </div>
            <p className="muted small">
              Gespeicherte Felder bleiben bei automatischen Metadatenupdates erhalten.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                const form = new FormData(e.currentTarget);
                const data: Record<string, unknown> = {};
                for (const k of ['title', 'original_title', 'summary', 'certification'])
                  data[k] = String(form.get(k) || '');
                for (const k of ['year', 'runtime']) data[k] = form.get(k) ? Number(form.get(k)) : null;
                for (const k of ['countries', 'genres', 'directors', 'actors'])
                  data[k] = String(form.get(k) || '')
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean);
                try {
                  await post({ action: 'media', id: item.id, data });
                  setOpen(false);
                  router.refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="form-grid">
                {[
                  ['title', 'Titel'],
                  ['original_title', 'Originaltitel'],
                  ['year', 'Erscheinungsjahr'],
                  ['runtime', 'Laufzeit (Minuten)'],
                  ['certification', 'Altersfreigabe'],
                  ['countries', 'Länder, mit Komma getrennt'],
                  ['genres', 'Genres'],
                  ['directors', 'Regie'],
                  ['actors', 'Besetzung (maximal 10)'],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      required={key === 'title'}
                      name={key}
                      type={['year', 'runtime'].includes(key) ? 'number' : 'text'}
                      defaultValue={
                        Array.isArray(item[key as keyof Media])
                          ? (item[key as keyof Media] as string[]).join(', ')
                          : String(item[key as keyof Media] ?? '')
                      }
                    />
                  </label>
                ))}
              </div>
              <label>
                Zusammenfassung
                <textarea name="summary" rows={6} defaultValue={item.summary} />
              </label>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                <Save size={16} />
                {busy ? 'Speichert …' : 'Änderungen speichern'}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
type Review = {
  id: string;
  body: string;
  spoiler: boolean;
  is_public: boolean;
  parent_source_id?: string;
  created_at: string;
};
export function ReviewEditor({ review, mediaId }: { review?: Review; mediaId: string }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loadingPlexReview, setLoadingPlexReview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null),
    spoilerRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  return (
    <>
      <button className="text-link" onClick={() => setOpen(!open)}>
        {review ? (
          <>
            <Pencil size={13} /> Bearbeiten / Sichtbarkeit
          </>
        ) : (
          '＋ Review schreiben'
        )}
      </button>
      {open && (
        <form
          className="review-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              await post({
                action: 'review',
                id: review?.id,
                mediaId,
                data: {
                  body: f.get('body'),
                  spoiler: f.get('spoiler') === 'on',
                  is_public: f.get('is_public') === 'on',
                },
              });
              setOpen(false);
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea
            ref={bodyRef}
            name="body"
            rows={7}
            required
            maxLength={30000}
            defaultValue={review?.body}
            aria-label="Dein Review"
            placeholder="Was bleibt von diesem Film?"
          />
          <button
            type="button"
            className="text-link"
            disabled={loadingPlexReview}
            onClick={async () => {
              setLoadingPlexReview(true);
              setError('');
              try {
                const r = await fetch('/api/admin', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'plex-review', mediaId }),
                });
                const data = await r.json();
                if (!r.ok) throw Error(data.error || 'Laden fehlgeschlagen');
                if (bodyRef.current) bodyRef.current.value = data.body;
                if (spoilerRef.current) spoilerRef.current.checked = data.spoiler;
                if (typeof data.rating === 'number')
                  window.dispatchEvent(
                    new CustomEvent('plex-rating', { detail: { mediaId, rating: data.rating } }),
                  );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setLoadingPlexReview(false);
              }
            }}
          >
            {loadingPlexReview ? 'Lädt …' : 'Review laden'}
          </button>
          <label className="checkbox">
            <input ref={spoilerRef} name="spoiler" type="checkbox" defaultChecked={review?.spoiler} /> Enthält
            Spoiler
          </label>
          <label className="checkbox">
            <input name="is_public" type="checkbox" defaultChecked={review?.is_public ?? true} />
            <Globe size={15} /> Öffentlich veröffentlichen — ohne Anschauinformationen
          </label>
          {error && <p className="error">{error}</p>}
          <button disabled={busy} className="button primary">
            {busy ? 'Speichert …' : 'Review speichern'}
          </button>
        </form>
      )}
    </>
  );
}
export function RatingEditor({ id, rating }: { id: string; rating: number | null }) {
  const router = useRouter();
  const [error, setError] = useState(''),
    [value, setValue] = useState(rating),
    [pending, setPending] = useState<number | null>(null);
  useEffect(() => setValue(rating), [rating]);
  useEffect(() => {
    function onPlexRating(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.mediaId === id && typeof detail.rating === 'number') setPending(detail.rating);
    }
    window.addEventListener('plex-rating', onPlexRating);
    return () => window.removeEventListener('plex-rating', onPlexRating);
  }, [id]);
  async function save(n: number | null) {
    try {
      await post({ action: 'rating', id, rating: n });
      setValue(n);
      setPending(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div>
      <label>
        Deine Bewertung
        <select
          aria-label="Deine Bewertung"
          value={pending ?? value ?? ''}
          onChange={(e) => save(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Nicht bewertet</option>
          {Array.from({ length: 10 }, (_, i) => (
            <option key={i} value={i + 1}>
              {'★'.repeat(i + 1)} {i + 1}/10
            </option>
          ))}
        </select>
      </label>
      {pending != null && pending !== value && (
        <p className="muted small">
          Aus Plex geladen ({pending}/10), noch nicht gespeichert.{' '}
          <button type="button" className="text-link" onClick={() => save(pending)}>
            Übernehmen
          </button>{' '}
          <button type="button" className="text-link" onClick={() => setPending(null)}>
            Verwerfen
          </button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
function berlinLocalInputValue(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
function invalidateHistoryCache() {
  try {
    sessionStorage.setItem('history:invalidated', String(Date.now()));
  } catch {
    /* Storage-Zugriff darf die Aktion nicht blockieren. */
  }
}
type Watch = { id: string; watched_at: string | null; time_estimated: boolean };
export function WatchEditor({ mediaId, watch }: { mediaId: string; watch: Watch }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  if (!open)
    return (
      <>
        {watch.watched_at
          ? new Date(watch.watched_at).toLocaleString('de-DE', {
              timeZone: 'Europe/Berlin',
              dateStyle: 'medium',
              timeStyle: 'short',
            })
          : 'Zeitpunkt ungeklärt'}
        {watch.time_estimated && <small>Empfangszeit verwendet</small>}
        <button
          type="button"
          className="icon-button"
          aria-label="Anschauzeitpunkt bearbeiten"
          onClick={() => setOpen(true)}
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Anschauzeitpunkt löschen"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await post({ action: 'watch-delete', id: watch.id, mediaId });
              invalidateHistoryCache();
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <Trash2 size={13} />
        </button>
        {error && <p className="error">{error}</p>}
      </>
    );
  return (
    <form
      className="watch-edit-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await post({
            action: 'watch',
            id: watch.id,
            mediaId,
            data: { watched_at: inputRef.current?.value || null },
          });
          invalidateHistoryCache();
          setOpen(false);
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        ref={inputRef}
        type="datetime-local"
        aria-label="Anschauzeitpunkt"
        defaultValue={watch.watched_at ? berlinLocalInputValue(watch.watched_at) : ''}
      />
      <button disabled={busy} className="button primary">
        <Save size={14} />
        {busy ? 'Speichert …' : 'Speichern'}
      </button>
      <button type="button" className="button" onClick={() => setOpen(false)}>
        Abbrechen
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
export function WatchCreator({ mediaId }: { mediaId: string }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  if (!open)
    return (
      <button type="button" className="text-link" onClick={() => setOpen(true)}>
        ＋ Anschauzeitpunkt hinzufügen
      </button>
    );
  return (
    <form
      className="watch-edit-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await post({
            action: 'watch-create',
            mediaId,
            data: { watched_at: inputRef.current?.value || null },
          });
          invalidateHistoryCache();
          setOpen(false);
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input ref={inputRef} type="datetime-local" aria-label="Anschauzeitpunkt" />
      <button disabled={busy} className="button primary">
        <Save size={14} />
        {busy ? 'Speichert …' : 'Hinzufügen'}
      </button>
      <button type="button" className="button" onClick={() => setOpen(false)}>
        Abbrechen
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
export function ReviewBody({ review, admin = false }: { review: Review; admin?: boolean }) {
  return (
    <article className="review">
      <div className="review-meta">
        <span>Persönliche Perspektive</span>
        {admin && (
          <span>
            {review.is_public ? (
              <>
                <Globe size={13} /> Öffentlich
              </>
            ) : (
              <>
                <LockKeyhole size={13} /> Privat
              </>
            )}
          </span>
        )}
        {review.parent_source_id && <span>Antwort auf einen Kommentar</span>}
      </div>
      {review.spoiler ? (
        <details>
          <summary>Spoiler anzeigen</summary>
          <p className="review-text">{review.body}</p>
        </details>
      ) : (
        <p className="review-text">{review.body}</p>
      )}
    </article>
  );
}

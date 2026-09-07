'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Media, SearchResult } from '@/lib/types';

export function AssignmentEditor({ item }: { item: Media }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<Media | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResults(null);
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/search?' + new URLSearchParams({ q: term, type: 'series' }), {
          signal: controller.signal,
        });
        if (!response.ok) throw Error('Seriensuche fehlgeschlagen. Bitte erneut versuchen.');
        const data = await response.json();
        if (!controller.signal.aborted) {
          setResults(data);
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, term]);
  return (
    <>
      <button
        className="button"
        onClick={() => {
          setTerm(item.parent_title || '');
          setSelected(null);
          setError('');
          setOpen(true);
        }}
      >
        Zuordnung korrigieren
      </button>
      {open && (
        <div className="modal-backdrop">
          <section role="dialog" aria-modal="true" aria-label="Zuordnung korrigieren" className="modal">
            <div className="section-heading">
              <h2>Zuordnung korrigieren</h2>
              <button className="button" disabled={busy} onClick={() => setOpen(false)}>
                Schließen
              </button>
            </div>
            <p>
              Aktuell: {item.parent_title || 'Keine Serie'} · Staffel {item.season ?? '?'}
              {item.kind === 'episode' ? ` · Episode ${item.episode ?? '?'}` : ''}
            </p>
            <p className="muted small">
              Anschauereignisse, Bewertungen und Reviews bleiben erhalten. Die Korrektur bleibt auch bei
              erneuten Importen bestehen.
            </p>
            <label>
              Richtige Serie suchen
              <input
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setSelected(null);
                }}
                placeholder="Serientitel"
              />
            </label>
            {loading && <p role="status">Suche läuft …</p>}
            {results && (
              <div className="assignment-results">
                {results.items.map((show) => (
                  <div key={show.id} className="assignment-result">
                    {show.poster && (
                      <img src={show.poster} alt="" width={48} height={72} style={{ objectFit: 'cover' }} />
                    )}
                    <label className="checkbox">
                      <input
                        type="radio"
                        name={`series-${item.id}`}
                        checked={selected?.id === show.id}
                        onChange={() => setSelected(show)}
                      />
                      {show.title} ({show.year ?? 'Jahr unbekannt'}) · ID {show.id}
                    </label>
                    <a href={`/title/${show.id}`} target="_blank" rel="noreferrer">
                      Ansehen ↗
                    </a>
                  </div>
                ))}
                {!results.items.length && <p>Keine Serie gefunden.</p>}
                {results.hasMore && <p>Weitere Treffer vorhanden. Bitte die Suche eingrenzen.</p>}
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!selected) return;
                const form = new FormData(e.currentTarget);
                setBusy(true);
                setError('');
                try {
                  const response = await fetch('/api/admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'assignment',
                      data: {
                        id: item.id,
                        parentId: selected.id,
                        season: Number(form.get('season')),
                        episode: item.kind === 'episode' ? Number(form.get('episode')) : null,
                      },
                    }),
                  });
                  if (!response.ok) throw Error((await response.json()).error || 'Speichern fehlgeschlagen');
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
                <label>
                  Staffel
                  <input
                    name="season"
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    required
                    defaultValue={item.season ?? ''}
                  />
                </label>
                {item.kind === 'episode' && (
                  <label>
                    Episode
                    <input
                      name="episode"
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      required
                      defaultValue={item.episode ?? ''}
                    />
                  </label>
                )}
              </div>
              {selected && (
                <p>
                  Neue Serie:{' '}
                  <strong>
                    {selected.title} ({selected.year ?? '?'}) · ID {selected.id}
                  </strong>
                </p>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={!selected || busy}>
                {busy ? 'Speichert …' : 'Zuordnung speichern'}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

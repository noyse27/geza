'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Film, Tv, ArrowUpRight, LoaderCircle, X } from 'lucide-react';
import { MediaCard } from './media';
import type { Media } from '@/lib/types';
type TmdbResult = {
  tmdbId: number;
  title: string;
  original_title: string;
  year: number | null;
  summary: string;
  poster: string | null;
};
function AddBucketlistItem({ kind }: { kind: 'movie' | 'show' }) {
  const [open, setOpen] = useState(false),
    [title, setTitle] = useState(''),
    [year, setYear] = useState(''),
    [results, setResults] = useState<TmdbResult[] | null>(null),
    [loading, setLoading] = useState(false),
    [adding, setAdding] = useState(false),
    [error, setError] = useState('');
  const router = useRouter();
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError('');
    setResults(null);
    try {
      const params = new URLSearchParams({ kind, q: title.trim() });
      if (year.trim()) params.set('year', year.trim());
      const r = await fetch(`/api/admin/tmdb-search?${params}`);
      const data = await r.json();
      if (!r.ok) throw Error(data.error || 'Suche fehlgeschlagen');
      setResults(data.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function pick(result: TmdbResult) {
    setAdding(true);
    setError('');
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bucketlist-add',
          data: {
            kind,
            tmdbId: result.tmdbId,
            title: result.title,
            original_title: result.original_title,
            year: result.year,
            summary: result.summary,
            poster: result.poster,
          },
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || 'Hinzufügen fehlgeschlagen');
      router.push(`/title/${data.id}?new=1`);
    } catch (e) {
      setError((e as Error).message);
      setAdding(false);
    }
  }
  if (!open)
    return (
      <div className="bucketlist-add">
        <button type="button" className="button" onClick={() => setOpen(true)}>
          <Plus size={16} /> {kind === 'movie' ? 'Film hinzufügen' : 'Serie hinzufügen'}
        </button>
      </div>
    );
  return (
    <div className="panel bucketlist-add">
      <div className="section-heading">
        <h3>{kind === 'movie' ? 'Film' : 'Serie'} zur Bucketliste hinzufügen</h3>
        <button
          className="icon-button"
          aria-label="Schließen"
          onClick={() => {
            setOpen(false);
            setResults(null);
            setError('');
          }}
        >
          <X size={16} />
        </button>
      </div>
      <form className="form-grid" onSubmit={search}>
        <label>
          Titel
          <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </label>
        <label>
          Jahr (optional)
          <input
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder="z. B. 2024"
          />
        </label>
        <button className="button primary" disabled={loading || adding}>
          {loading ? <LoaderCircle className="spin" size={16} /> : 'Suchen'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {results && (
        <div className="search-dropdown bucketlist-search-results">
          {results.length ? (
            results.map((r) => (
              <button
                type="button"
                key={r.tmdbId}
                className="suggestion"
                disabled={adding}
                onClick={() => pick(r)}
              >
                <div className="poster">
                  {r.poster ? (
                    <img src={r.poster} alt={`Poster: ${r.title}`} />
                  ) : (
                    <div
                      className="poster-placeholder"
                      style={{ '--poster-hue': String(((r.tmdbId * 37) % 80) + 20) } as React.CSSProperties}
                    >
                      {kind === 'movie' ? <Film /> : <Tv />}
                    </div>
                  )}
                </div>
                <div>
                  <strong>{r.title}</strong>
                  <small>{r.year || 'Jahr offen'}</small>
                </div>
                <ArrowUpRight size={15} />
              </button>
            ))
          ) : (
            <div className="search-message">Keine Treffer bei TMDB.</div>
          )}
        </div>
      )}
    </div>
  );
}
export function BucketlistTabs({ movies, shows }: { movies: Media[]; shows: Media[] }) {
  const [tab, setTab] = useState<'movies' | 'shows'>('movies');
  const items = tab === 'movies' ? movies : shows;
  return (
    <>
      <div className="segmented">
        <button className={tab === 'movies' ? 'active' : ''} onClick={() => setTab('movies')}>
          Filme ({movies.length})
        </button>
        <button className={tab === 'shows' ? 'active' : ''} onClick={() => setTab('shows')}>
          Serien / Staffeln ({shows.length})
        </button>
      </div>
      <AddBucketlistItem kind={tab === 'movies' ? 'movie' : 'show'} />
      {items.length ? (
        <div className="poster-grid">
          {items.map((m) => (
            <MediaCard item={m} key={m.id} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>
            {tab === 'movies' ? 'Keine ungesehenen Filme gefunden.' : 'Keine ungesehenen Serien gefunden.'}
          </h3>
        </div>
      )}
    </>
  );
}

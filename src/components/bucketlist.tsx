'use client';
import { useState } from 'react';
import { MediaCard } from './media';
import type { Media } from '@/lib/types';
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
          Serien ({shows.length})
        </button>
      </div>
      {items.length ? (
        <div className="poster-grid">
          {items.map((m) => (
            <MediaCard item={m} key={m.id} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>{tab === 'movies' ? 'Keine ungesehenen Filme gefunden.' : 'Keine ungesehenen Serien gefunden.'}</h3>
        </div>
      )}
    </>
  );
}

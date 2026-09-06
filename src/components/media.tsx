import Link from 'next/link';
import { Film, Tv, ArrowUpRight, Star } from 'lucide-react';
import type { Media } from '@/lib/types';
export const kindLabel = (kind: string) =>
  ({ movie: 'Film', show: 'Serie', season: 'Staffel', episode: 'Episode' })[kind] || kind;
export function Poster({ item, large = false }: { item: Media; large?: boolean }) {
  return (
    <div
      className={`poster ${large ? 'poster-large' : ''}`}
      style={{ '--poster-hue': String(((Number(item.id) * 37) % 80) + 20) } as React.CSSProperties}
    >
      {item.poster ? (
        <img
          src={item.poster}
          alt={`Poster: ${item.title}`}
          loading={large ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : (
        <div className="poster-placeholder">
          <span className="poster-frame" />
          {item.kind === 'movie' ? <Film /> : <Tv />}
          <span>{item.title}</span>
          <small>{item.year || 'GEZA'}</small>
        </div>
      )}
    </div>
  );
}
export function Stars({ rating }: { rating: number }) {
  return (
    <span className="rating">
      <Star size={13} fill="currentColor" /> {rating}
      <span>/10</span>
    </span>
  );
}
export function MediaRow({
  item,
  watched = false,
  index,
}: {
  item: Media;
  watched?: boolean;
  index?: number;
}) {
  return (
    <Link href={`/title/${item.id}`} className="media-row" prefetch={false}>
      {index !== undefined && <span className="row-index">{String(index + 1).padStart(2, '0')}</span>}
      <Poster item={item} />
      <div className="row-info">
        <span className="eyebrow">
          {kindLabel(item.kind)}
          {item.kind === 'episode' &&
            ` · S${String(item.season).padStart(2, '0')} E${String(item.episode).padStart(2, '0')}`}
        </span>
        {item.parent_title && (
          <span className="parent-title">
            {item.parent_title}
            {item.parent_year ? ` (${item.parent_year})` : ''}
          </span>
        )}
        <h3>
          {item.title} {item.year && <span>({item.year})</span>}
        </h3>
        <span className="muted row-subtitle">
          {item.genres.slice(0, 2).join(' · ') ||
            (item.original_title && item.original_title !== item.title ? item.original_title : '')}
          {item.runtime ? ` · ${item.runtime} Min.` : ''}
        </span>
      </div>
      <div className="row-meta">
        {item.rating != null && <Stars rating={item.rating} />}{' '}
        {watched && item.watched_at && (
          <time>
            {new Date(item.watched_at).toLocaleDateString('de-DE', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              timeZone: 'Europe/Berlin',
            })}
          </time>
        )}
      </div>
      <ArrowUpRight className="row-arrow" size={18} />
    </Link>
  );
}
export function MediaCard({ item }: { item: Media }) {
  return (
    <Link href={`/title/${item.id}`} className="media-card" prefetch={false}>
      <Poster item={item} />
      <div className="card-meta">
        <span>
          {kindLabel(item.kind)} · {item.year || 'Jahr offen'}
        </span>
        {item.rating != null && <Stars rating={item.rating} />}
      </div>
      <h3>{item.title}</h3>
      {item.parent_title && (
        <p className="muted">
          {item.parent_title} · S{item.season} E{item.episode}
        </p>
      )}
    </Link>
  );
}

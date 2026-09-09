import { configuredFriendReviews } from '@/lib/friend-reviews';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getMedia, publicColumns, listFilmSeries } from '@/lib/catalog';
import { query } from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import { Poster, kindLabel, MediaRow, Stars } from '@/components/media';
import { Star } from 'lucide-react';
import { Back } from '@/components/navigation';
import { MediaEditor, ReviewEditor, RatingEditor, WatchEditor, WatchCreator } from '@/components/editor';
import { ReviewBody } from '@/components/review-body';
import type { Media } from '@/lib/types';
import { FriendReviews } from '@/components/friend-reviews';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    m = await getMedia(id);
  if (!m) return { title: 'Nicht gefunden' };
  return {
    title: `${m.title}${m.year ? ` (${m.year})` : ''}`,
    description: m.summary.slice(0, 160) || `${m.title} — Informationen und Reviews auf Geza.`,
    alternates: process.env.PUBLIC_URL ? { canonical: `${process.env.PUBLIC_URL}/title/${id}` } : undefined,
  };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    m = await getMedia(id);
  if (!m) notFound();
  const admin = await isAdmin();
  const seriesOptions = admin ? await listFilmSeries() : [];
  if (['movie', 'show', 'episode'].includes(m.kind))
    await query(
      `INSERT INTO jobs(kind,dedupe_key,payload) VALUES('enrich',$1,$2) ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',attempts=0,available_at=now(),updated_at=now() WHERE jobs.status IN ('done','failed') AND jobs.updated_at<now()-interval '7 days'`,
      [`detail-enrich:${id}`, JSON.stringify({ mediaId: id })],
    );
  const providerRatings = await query('SELECT provider,rating,url FROM provider_ratings WHERE media_id=$1', [
    id,
  ]);

  const friends = await configuredFriendReviews(id, m);
  const reviews = await query(
    `SELECT id,body,spoiler,is_public,parent_source_id,created_at FROM reviews WHERE media_id=$1 ${admin ? '' : 'AND is_public'} ORDER BY created_at DESC`,
    [id],
  );
  const watches = admin
    ? await query(
        'SELECT id,watched_at,time_estimated FROM watches WHERE media_id=$1 ORDER BY watched_at DESC NULLS LAST',
        [id],
      )
    : [];
  const rating = (await query('SELECT rating FROM ratings WHERE media_id=$1', [id]))[0]?.rating;
  const children =
    m.kind === 'show' || m.kind === 'season'
      ? await query<Media>(
          `SELECT ${publicColumns} FROM media m LEFT JOIN media p ON p.id=m.parent_id WHERE m.parent_id=$1 ORDER BY m.season,m.episode,m.id LIMIT 500`,
          [id],
        )
      : [];
  const structured = {
    '@context': 'https://schema.org',
    '@type':
      m.kind === 'movie'
        ? 'Movie'
        : m.kind === 'episode'
          ? 'TVEpisode'
          : m.kind === 'season'
            ? 'TVSeason'
            : 'TVSeries',
    name: m.title,
    alternateName: m.original_title || undefined,
    description: m.summary || undefined,
    image: m.poster || undefined,
    datePublished: m.year ? String(m.year) : undefined,
    genre: m.genres,
    review: reviews
      .filter((r) => r.is_public && !r.parent_source_id)
      .map((r) => ({
        '@type': 'Review',
        author: { '@type': 'Person', name: 'Geza' },
        reviewBody: r.body,
        ...(rating
          ? { reviewRating: { '@type': 'Rating', ratingValue: rating, bestRating: 10, worstRating: 1 } }
          : {}),
      })),
  };
  return (
    <div className="page detail-page">
      <Back />
      <div className="detail-top">
        <div className="detail-poster">
          <Poster item={m} large />
          {m.series_title && (
            <Link className="series-badge" href={`/series/${m.series_id}`}>
              {m.series_title}
            </Link>
          )}
        </div>
        <div className="detail-intro">
          <span className="eyebrow accent">
            {kindLabel(m.kind)}
            {m.season !== null ? ` · Staffel ${m.season}` : ''}
            {m.episode !== null ? ` · Episode ${m.episode}` : ''}
          </span>
          {m.parent_title && (
            <Link className="parent-link" href={`/title/${m.parent_id}`}>
              {m.parent_title} {m.parent_year && `(${m.parent_year})`} ↗
            </Link>
          )}
          <h1>
            {m.title}
            <span className="accent">.</span>
          </h1>
          {m.original_title && m.original_title !== m.title && (
            <p className="original-title">{m.original_title}</p>
          )}
          <div className="detail-facts">
            <span>{m.year || 'Erscheinungsjahr offen'}</span>
            {m.runtime && <span>{m.runtime} Min.</span>}
            {m.certification && <span className="certification">{m.certification}</span>}
            <span>{m.countries.join(' · ')}</span>
          </div>
          <div className="tags">
            {m.genres.map((g) => (
              <span key={g}>{g}</span>
            ))}
          </div>
          {rating != null && (
            <div className="public-rating" aria-label={`Geza-Bewertung: ${rating} von 10 Sternen`}>
              <span className="eyebrow">GEZA-BEWERTUNG</span>
              <div>
                {Array.from({ length: 10 }, (_, i) => (
                  <Star
                    key={i}
                    size={18}
                    fill={i < rating ? 'currentColor' : 'none'}
                    className={i < rating ? 'accent' : 'muted'}
                  />
                ))}
                <Stars rating={rating} />
              </div>
            </div>
          )}
          <p className="synopsis">
            {m.summary || 'Für diesen Titel ist noch keine Zusammenfassung hinterlegt.'}
          </p>
          <div className="external-links" aria-label="Bewertungen anderer Anbieter">
            {['imdb', 'tmdb', 'tvdb'].map((provider) => {
              const value = providerRatings.find((r) => r.provider === provider);
              const url =
                value?.url ||
                (provider === 'imdb' && m.ids.imdb
                  ? `https://www.imdb.com/title/${m.ids.imdb}/ratings/`
                  : provider === 'tmdb' && m.ids.tmdb && ['movie', 'show'].includes(m.kind)
                    ? `https://www.themoviedb.org/${m.kind === 'movie' ? 'movie' : 'tv'}/${m.ids.tmdb}`
                    : provider === 'tvdb' && m.ids.tvdb && ['movie', 'show', 'episode'].includes(m.kind)
                      ? `https://thetvdb.com/dereferrer/${m.kind === 'movie' ? 'movie' : m.kind === 'episode' ? 'episode' : 'series'}/${m.ids.tvdb}`
                      : null);
              const label = `${provider === 'imdb' ? 'IMDb' : provider.toUpperCase()}: ${value ? Number(value.rating).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' / 10 ★' : 'Bewertung nicht verfügbar'}`;
              return url ? (
                <a key={provider} href={url} target="_blank" rel="noopener noreferrer">
                  {label} ↗
                </a>
              ) : (
                <span className="muted small" key={provider}>
                  {label}
                </span>
              );
            })}
          </div>
          <div className="detail-credits">
            <div>
              <span className="eyebrow">REGIE</span>
              <p>{m.directors.join(', ') || 'Noch keine Angabe'}</p>
            </div>
            <div>
              <span className="eyebrow">BESETZUNG</span>
              <p>{m.actors.slice(0, 10).join(', ') || 'Noch keine Angabe'}</p>
            </div>
          </div>
          <div className="external-links">
            {m.ids.imdb && (
              <a href={`https://www.imdb.com/title/${m.ids.imdb}/`} target="_blank" rel="noreferrer">
                IMDb ↗
              </a>
            )}
            {m.ids.tmdb && (m.kind === 'movie' || m.kind === 'show') && (
              <a
                href={`https://www.themoviedb.org/${m.kind === 'movie' ? 'movie' : 'tv'}/${m.kind === 'movie' || m.kind === 'show' ? m.ids.tmdb : ''}`}
                target="_blank"
                rel="noreferrer"
              >
                TMDB ↗
              </a>
            )}
          </div>
          {admin && (
            <MediaEditor item={JSON.parse(JSON.stringify(m))} seriesOptions={JSON.parse(JSON.stringify(seriesOptions))} />
          )}
        </div>
      </div>
      <div className={`detail-lower ${admin ? 'with-private' : ''}`}>
        <section>
          <div className="section-heading">
            <div>
              <span className="eyebrow">WAS BLEIBT</span>
              <h2>Reviews</h2>
            </div>
            {admin && <ReviewEditor mediaId={id} />}
          </div>
          {reviews.length ? (
            reviews.map((r) => (
              <div key={r.id}>
                <ReviewBody review={JSON.parse(JSON.stringify(r))} admin={admin} />
                {admin && <ReviewEditor review={JSON.parse(JSON.stringify(r))} mediaId={id} />}
              </div>
            ))
          ) : (
            <div className="empty">
              {admin
                ? 'Noch kein Review. Was denkst du über diesen Titel?'
                : 'Zu diesem Titel gibt es noch kein öffentliches Review.'}
            </div>
          )}
          <FriendReviews
            mediaId={id}
            rows={JSON.parse(JSON.stringify(friends))}
            admin={admin}
            title={m.title}
            year={m.year}
          />
        </section>
        {admin && (
          <aside className="panel private-panel">
            <span className="eyebrow accent">NUR FÜR DICH</span>
            <h2>Dein Tagebuch</h2>
            <RatingEditor id={id} rating={rating ?? null} />
            <h3>Anschauereignisse</h3>
            {watches.length ? (
              <ul className="watch-dates">
                {watches.map((w) => (
                  <li key={w.id}>
                    <WatchEditor mediaId={id} watch={JSON.parse(JSON.stringify(w))} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Keine Anschauereignisse für diesen Titel.</p>
            )}
            <WatchCreator mediaId={id} />
          </aside>
        )}
      </div>
      {children.length > 0 && (
        <section className="episodes">
          <div className="section-heading">
            <h2>Staffeln & Episoden</h2>
            <span className="muted">{children.length} Einträge</span>
          </div>
          {children.map((c) => (
            <MediaRow key={c.id} item={c} />
          ))}
        </section>
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\\u003c') }}
      />
    </div>
  );
}

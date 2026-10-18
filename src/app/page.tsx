import { Search } from '@/components/search';
import { query } from '@/lib/db';
import { publicColumns } from '@/lib/catalog';
import type { Media } from '@/lib/types';
import { HomeShelf } from '@/components/home-shelf';
export default async function Page() {
  const [reviewed, commented] = await Promise.all([
    query<Media>(
      `SELECT ${publicColumns},rating.rating FROM media m LEFT JOIN media p ON p.id=m.parent_id LEFT JOIN ratings rating ON rating.media_id=m.id WHERE NOT m.rumpel AND NOT m.bucketlist AND EXISTS(SELECT 1 FROM reviews r WHERE r.media_id=m.id AND r.is_public) ORDER BY (SELECT max(r.updated_at) FROM reviews r WHERE r.media_id=m.id AND r.is_public) DESC,m.title LIMIT 12`,
    ),
    query<Media>(
      `WITH latest AS (
         SELECT r.media_id,max(c.published_at) AS commented_at
         FROM review_comments c JOIN reviews r ON r.id=c.review_id
         WHERE c.status='published' AND r.is_public GROUP BY r.media_id
       )
       SELECT ${publicColumns},rating.rating FROM latest l JOIN media m ON m.id=l.media_id
       LEFT JOIN media p ON p.id=m.parent_id LEFT JOIN ratings rating ON rating.media_id=m.id
       WHERE NOT m.rumpel AND NOT m.bucketlist ORDER BY l.commented_at DESC,m.title LIMIT 12`,
    ),
  ]);
  const items = reviewed.length
    ? reviewed
    : await query<Media>(
        `SELECT ${publicColumns},rating.rating FROM media m LEFT JOIN media p ON p.id=m.parent_id LEFT JOIN ratings rating ON rating.media_id=m.id WHERE m.kind='movie' AND NOT m.rumpel ORDER BY m.enriched_at DESC NULLS LAST,m.title LIMIT 12`,
      );
  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow accent">FILM. SERIE. PERSPEKTIVE.</span>
        <h1>
          Gute Geschichten
          <br />
          bleiben<span className="accent">.</span>
        </h1>
        <p>Entdecke Filme, Serien und die Gedanken dazu.</p>
        <Search />
        <div className="search-hint">
          <span>Titel, Originaltitel, Menschen & Reviews</span>
          <span>Dein nächster Film beginnt hier ↗</span>
        </div>
      </section>
      <section>
        <HomeShelf
          fresh={JSON.parse(JSON.stringify(items))}
          commented={JSON.parse(JSON.stringify(commented))}
          freshLabel={reviewed.length ? 'Frisch besprochen' : 'Filme entdecken'}
        />
      </section>
    </div>
  );
}

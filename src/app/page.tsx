import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Search } from '@/components/search';
import { MediaCard } from '@/components/media';
import { query } from '@/lib/db';
import { publicColumns } from '@/lib/catalog';
import type { Media } from '@/lib/types';
export default async function Page() {
  const reviewed = await query<Media>(
    `SELECT ${publicColumns},rating.rating FROM media m LEFT JOIN media p ON p.id=m.parent_id LEFT JOIN ratings rating ON rating.media_id=m.id WHERE EXISTS(SELECT 1 FROM reviews r WHERE r.media_id=m.id AND r.is_public) ORDER BY (SELECT max(r.updated_at) FROM reviews r WHERE r.media_id=m.id AND r.is_public) DESC,m.title LIMIT 12`,
  );
  const items = reviewed.length
    ? reviewed
    : await query<Media>(
        `SELECT ${publicColumns},rating.rating FROM media m LEFT JOIN media p ON p.id=m.parent_id LEFT JOIN ratings rating ON rating.media_id=m.id WHERE m.kind='movie' ORDER BY m.enriched_at DESC NULLS LAST,m.title LIMIT 12`,
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
        <div className="section-heading">
          <div>
            <span className="eyebrow">DAS KATALOGREGAL</span>
            <h2>{reviewed.length ? 'Frisch besprochen' : 'Filme entdecken'}</h2>
          </div>
          <Link className="text-link" href="/search">
            Alle Titel <ArrowUpRight size={16} />
          </Link>
        </div>
        {items.length ? (
          <div className="poster-grid">
            {items.map((m) => (
              <MediaCard key={m.id} item={m} />
            ))}
          </div>
        ) : (
          <div className="empty">
            Der Katalog wird gerade eingerichtet. Bald findest du hier die ersten Titel.
          </div>
        )}
      </section>
    </div>
  );
}

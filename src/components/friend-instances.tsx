import { Stars } from '@/components/media';
import type { FriendRating } from '@/lib/federation';
export function FriendInstances({ rows }: { rows: FriendRating[] }) {
  if (!rows.length) return null;
  return (
    <section className="friend-reviews">
      <span className="eyebrow">FRIENDS OF GEZA</span>
      <h2>Bei befreundeten Instanzen</h2>
      <div className="friend-grid">
        {rows.map((row) => (
          <article className="panel" key={row.url}>
            <h3>
              <a href={row.url} target="_blank" rel="noopener noreferrer">
                {row.nickname} ↗
              </a>
            </h3>
            {row.rating !== null && <Stars rating={row.rating} />}
            {row.hasReview && <p className="muted small">✎ Review vorhanden</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

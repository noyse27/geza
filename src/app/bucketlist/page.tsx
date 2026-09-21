import { getBucketlist } from '@/lib/catalog';
import { requireAdmin } from '@/lib/auth';
import { MediaCard } from '@/components/media';
export const metadata = { title: 'Bucketliste', robots: { index: false, follow: false } };
export default async function Page() {
  await requireAdmin();
  const { movies, shows } = await getBucketlist();
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow accent">NOCH UNGESEHEN</span>
        <h1>
          Bucketliste<span className="accent">.</span>
        </h1>
        <p>Was dein Plex-Server kennt, aber du noch nicht gesehen hast.</p>
      </div>
      <section>
        <h2>Filme</h2>
        {movies.length ? (
          <div className="poster-grid">
            {movies.map((m) => (
              <MediaCard item={m} key={m.id} />
            ))}
          </div>
        ) : (
          <p className="muted">Keine ungesehenen Filme gefunden.</p>
        )}
      </section>
      <section>
        <h2>Serien</h2>
        {shows.length ? (
          <div className="poster-grid">
            {shows.map((m) => (
              <MediaCard item={m} key={m.id} />
            ))}
          </div>
        ) : (
          <p className="muted">Keine ungesehenen Serien gefunden.</p>
        )}
      </section>
    </div>
  );
}

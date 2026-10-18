import Link from 'next/link';
import { query } from '@/lib/db';
import { countryLabel } from '@/lib/countries';
export const metadata = { title: 'Statistik' };
export default async function Page() {
  const [totals, best, worst, genres, countries, monthly, mostViewed, mostReacted, mostCommented] =
    await Promise.all([
      query(
        `SELECT count(*)::int AS events,count(DISTINCT m.id) FILTER(WHERE m.kind='movie')::int AS movies,count(*) FILTER(WHERE m.kind='episode')::int AS episodes,COALESCE(sum(m.runtime),0)::int AS minutes,count(*) FILTER(WHERE m.runtime IS NOT NULL)::int AS with_runtime FROM watches w JOIN media m ON m.id=w.media_id WHERE NOT m.rumpel AND NOT m.bucketlist`,
      ),
      query(
        `SELECT m.id,m.title,m.year,r.rating FROM ratings r JOIN media m ON m.id=r.media_id WHERE m.kind='movie' AND NOT m.rumpel AND NOT m.bucketlist ORDER BY r.rating DESC,random() LIMIT 8`,
      ),
      query(
        `SELECT m.id,m.title,m.year,r.rating FROM ratings r JOIN media m ON m.id=r.media_id WHERE m.kind='movie' AND NOT m.rumpel AND NOT m.bucketlist ORDER BY r.rating ASC,random() LIMIT 8`,
      ),
      query(
        `SELECT genre AS name,count(*)::int AS count FROM media m CROSS JOIN unnest(m.genres) genre WHERE m.kind='movie' AND NOT m.rumpel AND NOT m.bucketlist AND EXISTS(SELECT 1 FROM watches w WHERE w.media_id=m.id) GROUP BY genre ORDER BY count DESC LIMIT 8`,
      ),
      query(
        `SELECT country AS name,count(*)::int AS count FROM media m CROSS JOIN unnest(m.countries) country WHERE m.kind='movie' AND NOT m.rumpel AND NOT m.bucketlist AND EXISTS(SELECT 1 FROM watches w WHERE w.media_id=m.id) GROUP BY country ORDER BY count DESC LIMIT 8`,
      ),
      query(
        `SELECT to_char(w.watched_at AT TIME ZONE 'Europe/Berlin','YYYY-MM') AS month,count(*)::int AS count FROM watches w JOIN media m ON m.id=w.media_id WHERE w.watched_at IS NOT NULL AND NOT m.rumpel AND NOT m.bucketlist GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
      ),
      query(
        `SELECT m.id,m.title,m.year,v.views::int AS count
       FROM media_view_totals v JOIN media m ON m.id=v.media_id
       WHERE m.kind='movie' AND NOT m.rumpel AND NOT m.bucketlist
       ORDER BY v.views DESC,v.last_viewed_at DESC,m.title LIMIT 10`,
      ),
      query(
        `SELECT m.id,m.title,m.year,count(*)::int AS count,max(x.updated_at) AS latest
       FROM review_reactions x JOIN reviews r ON r.id=x.review_id JOIN media m ON m.id=r.media_id
       WHERE r.is_public AND m.kind='movie' AND NOT m.rumpel AND NOT m.bucketlist
       GROUP BY m.id,m.title,m.year ORDER BY count DESC,latest DESC,m.title LIMIT 10`,
      ),
      query(
        `SELECT m.id,m.title,m.year,count(*)::int AS count,max(c.published_at) AS latest
       FROM review_comments c JOIN reviews r ON r.id=c.review_id JOIN media m ON m.id=r.media_id
       WHERE c.status='published' AND r.is_public AND m.kind='movie' AND NOT m.rumpel AND NOT m.bucketlist
       GROUP BY m.id,m.title,m.year ORDER BY count DESC,latest DESC,m.title LIMIT 10`,
      ),
    ]);
  const t = totals[0],
    max = Math.max(1, ...monthly.map((r) => r.count));
  for (const r of countries) r.name = countryLabel(r.name);
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow accent">MEIN FILMLEBEN IN ZAHLEN</span>
        <h1>
          Statistik<span className="accent">.</span>
        </h1>
        <p>Vorlieben, Entdeckungen und ziemlich viele Filmabende.</p>
      </div>
      <div className="stat-grid">
        {[
          [t.events, 'Anschauereignisse'],
          [t.movies, 'Unterschiedliche Filme'],
          [t.episodes, 'Episoden'],
          [Math.round(t.minutes / 60), 'Stunden · geschätzt'],
        ].map(([n, label]) => (
          <div className="stat-card" key={String(label)}>
            <strong>{Number(n).toLocaleString('de-DE')}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="muted small">
        Sehzeit aus bekannten Laufzeiten ({Number(t.with_runtime).toLocaleString('de-DE')} von{' '}
        {Number(t.events).toLocaleString('de-DE')} Ereignissen). Wiederholungen zählen mit.
      </p>
      <div className="stats-columns stats-columns-three public-rankings">
        {[
          [mostViewed, 'Meist aufgerufen', 'Öffentliche Filmseiten', 'Aufrufe'],
          [mostReacted, 'Meist reagiert', 'Reaktionen auf öffentliche Reviews', 'Reaktionen'],
          [mostCommented, 'Meist kommentiert', 'Veröffentlichte Kommentare', 'Kommentare'],
        ].map(([rows, title, sub, unit]) => (
          <section className="panel" key={String(title)}>
            <h2>{String(title)}</h2>
            <p className="muted small">{String(sub)}</p>
            {(rows as typeof mostViewed).length ? (
              <div className="ranking">
                {(rows as typeof mostViewed).map((row, index) => (
                  <Link key={row.id} href={`/title/${row.id}`}>
                    <span className="rank-number">{index + 1}</span>
                    <span>
                      {row.title} <small>({row.year})</small>
                    </span>
                    <strong className="accent">
                      {Number(row.count).toLocaleString('de-DE')}
                      <small> {String(unit)}</small>
                    </strong>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="empty compact">Noch keine Daten vorhanden.</p>
            )}
          </section>
        ))}
      </div>
      <section className="panel chart-panel">
        <span className="eyebrow">MEINE LETZTEN 12 AKTIVEN MONATE</span>
        <h2>Ein guter Monat für Geschichten</h2>
        <div className="bar-chart">
          {[...monthly].reverse().map((r) => (
            <Link
              href={`/history?month=${r.month}`}
              key={r.month}
              title={`${r.month}: ${r.count} Ereignisse`}
            >
              <span className="bar-count">{r.count}</span>
              <div style={{ height: `${Math.max(3, (r.count / max) * 150)}px` }} />
              <small>
                {new Date(r.month + '-15').toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })}
              </small>
            </Link>
          ))}
        </div>
      </section>
      <div className="stats-columns">
        {[
          [best, 'Meine Favoriten', 'Die höchsten persönlichen Bewertungen'],
          [worst, 'Nicht ganz mein Film', 'Die niedrigsten persönlichen Bewertungen'],
        ].map(([rows, title, sub]) => (
          <section className="panel" key={String(title)}>
            <h2>{String(title)}</h2>
            <p className="muted small">{String(sub)}</p>
            <div className="ranking">
              {(rows as typeof best).map((r, i) => (
                <Link key={r.id} href={`/title/${r.id}`}>
                  <span className="rank-number">{i + 1}</span>
                  <span>
                    {r.title} <small>({r.year})</small>
                  </span>
                  <strong className="accent">
                    {r.rating}
                    <small>/10</small>
                  </strong>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="stats-columns">
        {[
          [genres, 'Meine Genres'],
          [countries, 'Kino ohne Grenzen'],
        ].map(([rows, title]) => (
          <section className="panel" key={String(title)}>
            <h2>{String(title)}</h2>
            <p className="muted small">Unterschiedliche gesehene Filme · Mehrfachzuordnung möglich</p>
            {(rows as typeof genres).length ? (
              <div className="horizontal-bars">
                {(rows as typeof genres).map((r) => (
                  <div key={r.name}>
                    <span>{r.name}</span>
                    <strong>{r.count}</strong>
                    <div style={{ width: `${(r.count / (rows as typeof genres)[0].count) * 100}%` }} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty compact">Diese Auswertung erscheint, sobald die Metadaten ergänzt sind.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

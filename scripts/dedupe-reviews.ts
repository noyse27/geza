import { query, pool } from '../src/lib/db';
const duplicates = await query<{ media_id: string; count: number }>(
  'SELECT media_id,count(*)::int AS count FROM reviews GROUP BY media_id HAVING count(*)>1',
);
if (!duplicates.length) {
  console.log('Keine doppelten Reviews gefunden.');
} else {
  const removed = await query<{ id: string; media_id: string; source: string }>(
    `DELETE FROM reviews WHERE id IN (
       SELECT id FROM (
         SELECT id,media_id,source,
           row_number() OVER (PARTITION BY media_id ORDER BY (source<>'plex') DESC,updated_at DESC,id DESC) AS rn
         FROM reviews
       ) ranked WHERE rn>1
     ) RETURNING id,media_id,source`,
  );
  console.log(
    `${duplicates.length} Titel mit doppelten Reviews gefunden, ${removed.length} überzählige Einträge entfernt (behalten wird bevorzugt die selbst geschriebene Review, sonst die zuletzt aktualisierte).`,
  );
  for (const r of removed) console.log(`  media_id=${r.media_id} source=${r.source} review_id=${r.id} entfernt`);
}
await pool.end();

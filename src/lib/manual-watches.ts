import { pool, query } from './db';
import { getSetting } from './settings';
import { syncSeriesCatalog } from './series-catalog';
import { isDemo } from './demo-mode';

export async function createManualWatch(
  mediaId: string,
  watchedAt: string | null,
  includeChildren: boolean,
  existingWatchId?: string,
  catalogReady = false,
) {
  const media = (await query('SELECT * FROM media WHERE id=$1', [mediaId]))[0];
  if (!media) throw Error('Titel nicht gefunden.');
  const cascade = includeChildren && ['show', 'season'].includes(media.kind);
  if (cascade && !catalogReady && !isDemo() && (await getSetting('TMDB_TOKEN')))
    await syncSeriesCatalog(mediaId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM media WHERE id=$1 FOR UPDATE', [
      media.kind === 'season' ? media.parent_id : mediaId,
    ]);
    await client.query("SET LOCAL geza.skip_rumpel='on'");
    const root = existingWatchId
      ? (
          await client.query('SELECT * FROM watches WHERE id=$1 AND media_id=$2 FOR UPDATE', [
            existingWatchId,
            mediaId,
          ])
        ).rows[0]
      : (
          await client.query(
            `INSERT INTO watches(media_id,source,source_id,watched_at,time_estimated)
          VALUES($1,'geza',$2,CASE WHEN $3::text IS NULL THEN NULL ELSE $3::timestamp AT TIME ZONE 'Europe/Berlin' END,false) RETURNING *`,
            [mediaId, crypto.randomUUID(), watchedAt],
          )
        ).rows[0];
    if (!root) throw Error('Anschauereignis nicht gefunden.');
    let added = 0;
    if (cascade) {
      const result = await client.query(
        `WITH episodes AS (
        SELECT m.id,m.season FROM media m WHERE m.kind='episode' AND
        (m.parent_id=$1 OR m.parent_id IN (SELECT id FROM media WHERE parent_id=$1 AND kind='season')
          OR ($2='season' AND m.parent_id=$3 AND m.season=$4))
        AND (m.air_date IS NULL OR m.air_date<=COALESCE(($5::timestamptz AT TIME ZONE 'Europe/Berlin')::date,CURRENT_DATE))
      ), targets AS (
        SELECT id FROM episodes UNION SELECT s.id FROM media s WHERE s.kind='season' AND s.parent_id=$1
        AND EXISTS(SELECT 1 FROM episodes e WHERE e.season=s.season)
      ) INSERT INTO watches(media_id,source,source_id,watched_at,time_estimated)
        SELECT m.id,'geza','cascade:'||$6::text||':'||m.id,$5,false FROM media m JOIN targets t ON t.id=m.id
        WHERE NOT EXISTS(SELECT 1 FROM watches w WHERE w.media_id=m.id)
          AND cardinality(m.seen_sources)=0 AND m.plex_watched IS NOT TRUE
        ON CONFLICT(source,source_id) DO NOTHING`,
        [mediaId, media.kind, media.parent_id, media.season, root.watched_at, root.id],
      );
      added = result.rowCount || 0;
    }
    await client.query('SELECT rumpel_refresh($1::bigint[])', [
      [media.kind === 'season' ? media.parent_id : mediaId],
    ]);
    await client.query('COMMIT');
    return { added };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function processSeriesCatalog(mediaId: string) {
  await syncSeriesCatalog(mediaId);
  const watches = await query(
    `SELECT w.id,w.media_id FROM media s JOIN media m ON
    (m.id=s.id OR (m.parent_id=s.id AND m.kind='season')) JOIN watches w ON w.media_id=m.id
    WHERE s.id=$1 AND s.catalog_backfill_before IS NOT NULL AND w.created_at<=s.catalog_backfill_before
      AND w.source='geza' AND w.source_id NOT LIKE 'cascade:%' AND w.watched_at IS NOT NULL
    ORDER BY w.watched_at,w.id`,
    [mediaId],
  );
  for (const watch of watches) await createManualWatch(watch.media_id, null, true, watch.id, true);
  await query('UPDATE media SET catalog_backfill_before=NULL WHERE id=$1', [mediaId]);
}

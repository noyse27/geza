import { pool, query } from './db';
import { berlinDay, dailyVisitorHash, isAutomatedView } from './page-view-identity';

export { isAutomatedView };

function visitorHash(request: Request, mediaId: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw Error('SESSION_SECRET muss mindestens 32 Zeichen haben.');
  return dailyVisitorHash(request, mediaId, secret);
}

export async function recordPublicView(request: Request, mediaId: string) {
  const day = berlinDay();
  const visitor = visitorHash(request, mediaId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const media = await client.query('SELECT 1 FROM media WHERE id=$1 AND NOT rumpel AND NOT bucketlist', [
      mediaId,
    ]);
    if (!media.rowCount) throw Error('Titel nicht gefunden.');
    const inserted = await client.query(
      `INSERT INTO media_view_dedup(media_id,viewed_on,visitor_hash) VALUES($1,$2,$3)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [mediaId, day, visitor],
    );
    if (inserted.rowCount)
      await client.query(
        `INSERT INTO media_view_totals(media_id,views,last_viewed_at) VALUES($1,1,now())
         ON CONFLICT(media_id) DO UPDATE SET views=media_view_totals.views+1,last_viewed_at=now()`,
        [mediaId],
      );
    await client.query("DELETE FROM media_view_dedup WHERE created_at<now()-interval '48 hours'");
    const total = await client.query<{ views: string }>(
      'SELECT views::text FROM media_view_totals WHERE media_id=$1',
      [mediaId],
    );
    await client.query('COMMIT');
    return Number(total.rows[0]?.views || 0);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function mediaViewCount(mediaId: string) {
  return Number(
    (
      await query<{ views: string }>('SELECT views::text FROM media_view_totals WHERE media_id=$1', [mediaId])
    )[0]?.views || 0,
  );
}

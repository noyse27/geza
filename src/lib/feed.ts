import { isDemo } from './demo-mode';
import { query } from './db';
import { getSetting } from './settings';
import { logEvent } from './logging';
const defaultGraceMinutes = 30;
export async function feedGraceMinutes() {
  const raw = (await getSetting('FEED_GRACE_MINUTES')).trim();
  const value = raw === '' ? NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 1440 ? value : defaultGraceMinutes;
}
type Snapshot = { rating: number | null; body: string | null };
/**
 * Records the current public state of a title for the feed. Call after every live rating or review
 * change. The entry becomes visible after the grace period; further changes inside it replace the
 * waiting entry, and a change back to the published state drops it.
 */
export async function recordFeedEntry(mediaId: string | number) {
  if (isDemo()) return;
  const [media] = await query<{ visible: boolean }>(
    'SELECT NOT rumpel AND NOT bucketlist AS visible FROM media WHERE id=$1',
    [mediaId],
  );
  const dropPending = () =>
    query('DELETE FROM feed_entries WHERE media_id=$1 AND publish_at>now()', [mediaId]);
  if (!media?.visible) return void (await dropPending());
  const [rating] = await query<{ rating: number }>('SELECT rating FROM ratings WHERE media_id=$1', [mediaId]);
  const [review] = await query<{ body: string; spoiler: boolean }>(
    'SELECT body,spoiler FROM reviews WHERE media_id=$1 AND is_public AND parent_source_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1',
    [mediaId],
  );
  const current: Snapshot = { rating: rating?.rating ?? null, body: review?.body ?? null };
  if (current.rating === null && current.body === null) return void (await dropPending());
  const [published] = await query<Snapshot>(
    'SELECT rating,review_body AS body FROM feed_entries WHERE media_id=$1 AND publish_at<=now() ORDER BY publish_at DESC,id DESC LIMIT 1',
    [mediaId],
  );
  const ratingChanged = current.rating !== null && current.rating !== (published?.rating ?? null);
  const reviewChanged = current.body !== null && current.body !== (published?.body ?? null);
  if (!ratingChanged && !reviewChanged) return void (await dropPending());
  const values = [
    mediaId,
    current.rating,
    published?.rating ?? null,
    current.body,
    review?.spoiler ?? false,
    ratingChanged,
    reviewChanged,
    !!published,
    await feedGraceMinutes(),
  ];
  const updated = await query(
    `UPDATE feed_entries SET rating=$2,previous_rating=$3,review_body=$4,spoiler=$5,rating_changed=$6,review_changed=$7,is_update=$8,
     publish_at=now()+make_interval(mins=>$9::int),created_at=now() WHERE media_id=$1 AND publish_at>now() RETURNING id`,
    values,
  );
  if (!updated.length)
    await query(
      `INSERT INTO feed_entries(media_id,rating,previous_rating,review_body,spoiler,rating_changed,review_changed,is_update,publish_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+make_interval(mins=>$9::int))`,
      values,
    );
}
/** Feed problems must never break saving a rating or review. */
export async function recordFeedEntrySafely(mediaId: string | number) {
  try {
    await recordFeedEntry(mediaId);
  } catch (error) {
    await logEvent('warn', 'feed', 'Feed-Eintrag konnte nicht vorgemerkt werden', { mediaId, error }).catch(
      () => undefined,
    );
  }
}

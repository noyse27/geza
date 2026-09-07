import { query } from './db';
import { reviewModule, reviewModules } from './review-modules';
import type { ReviewMedia } from './review-modules/types';
export { parseFilmdienst } from './review-modules/filmdienst';
export function friendUrl(provider: string, value: string) {
  if (!value.trim()) return null;
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw Error('Ungültiger Review-Link');
  if (provider === 'wortvogel' && !['wortvogel.de', 'www.wortvogel.de'].includes(url.hostname))
    throw Error('Ungültiger Review-Link');
  reviewModule(provider)?.validateUrl(url);
  return url.href;
}
export async function configuredFriendReviews(id: string, media: ReviewMedia) {
  if (media.kind !== 'movie') return [];
  const boxes = await query('SELECT provider,name,scale FROM review_boxes ORDER BY provider');
  for (const box of boxes) {
    const module = reviewModule(box.provider);
    const automatic = !!module?.discover && module.supports(media);
    await query(
      `INSERT INTO friend_reviews(media_id,provider,name,scale,manual,status)
      SELECT $1,provider,name,scale,$3,$4 FROM review_boxes WHERE provider=$2 ON CONFLICT DO NOTHING`,
      [id, box.provider, !automatic, automatic ? 'pending' : 'manual'],
    );
  }
  return query(
    `SELECT r.provider,b.name,b.scale,r.url,r.rating,r.status FROM friend_reviews r
    JOIN review_boxes b ON b.provider=r.provider WHERE r.media_id=$1 ORDER BY r.provider`,
    [id],
  );
}
export async function discoverFriendReview() {
  const providers = reviewModules.filter((module) => module.discover).map((module) => module.id);
  const [row] = await query(
    `UPDATE friend_reviews SET next_check_at=now()+interval '1 day'
     WHERE (media_id,provider)=(SELECT media_id,provider FROM friend_reviews WHERE provider=ANY($1::text[]) AND provider IN (SELECT provider FROM review_boxes) AND NOT manual AND status<>'found' AND next_check_at<=now() ORDER BY next_check_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING media_id,provider,next_check_at::text`,
    [providers],
  );
  if (!row) return false;
  const module = reviewModule(row.provider)!;
  try {
    const [media] = await query<ReviewMedia>(
      'SELECT title,original_title,year,kind,ids FROM media WHERE id=$1',
      [row.media_id],
    );
    const found = media && module.supports(media) ? await module.discover!(media) : null;
    await query(
      `UPDATE friend_reviews SET url=$3,rating=$4,status=$5,checked_at=now(),next_check_at=now()+interval '30 days'
       WHERE media_id=$1 AND provider=$2 AND NOT manual AND next_check_at=$6 AND provider IN (SELECT provider FROM review_boxes)`,
      [
        row.media_id,
        row.provider,
        found?.url || null,
        found?.rating ?? null,
        found ? 'found' : 'missing',
        row.next_check_at,
      ],
    );
  } catch (error) {
    console.warn(
      module.name + ' discovery failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    await query(
      `UPDATE friend_reviews SET status='error',checked_at=now(),next_check_at=now()+interval '1 day'
       WHERE media_id=$1 AND provider=$2 AND NOT manual AND next_check_at=$3 AND provider IN (SELECT provider FROM review_boxes)`,
      [row.media_id, row.provider, row.next_check_at],
    );
  }
  return true;
}

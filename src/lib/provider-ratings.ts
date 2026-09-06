import { query } from './db';
type Raw = Record<string, any>;
export async function saveProviderRating(
  id: string,
  provider: string,
  rating: unknown,
  url: string,
  votes: number | null = null,
) {
  if (rating == null || !Number.isFinite(Number(rating)) || Number(rating) < 0 || Number(rating) > 10) return;
  await query(
    `INSERT INTO provider_ratings(media_id,provider,rating,url,votes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(media_id,provider) DO UPDATE SET rating=excluded.rating,url=excluded.url,votes=excluded.votes,updated_at=now()`,
    [id, provider, Number(rating), url, votes],
  );
}
export function plexImdbRating(m: Raw) {
  for (const [value, image] of [
    [m.rating, m.ratingImage],
    [m.audienceRating, m.audienceRatingImage],
    ...(m.Rating || []).map((r: Raw) => [r.value, r.image]),
  ]) {
    if (
      String(image).startsWith('imdb://') &&
      value != null &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0 &&
      Number(value) <= 10
    )
      return Number(value);
  }
  return null;
}
export async function savePlexRatings(id: string, m: Raw, ids: Raw) {
  const rating = plexImdbRating(m);
  if (rating !== null && /^tt\d+$/.test(String(ids.imdb)))
    await saveProviderRating(id, 'imdb', rating, `https://www.imdb.com/title/${ids.imdb}/ratings/`);
}

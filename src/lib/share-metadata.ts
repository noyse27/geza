import { decodeMentions } from './mentions';

export function shareDescription(
  title: string,
  summary: string,
  rating: number | null | undefined,
  review?: { body: string; spoiler: boolean },
) {
  const text = review && !review.spoiler ? decodeMentions(review.body).text : summary;
  const teaser =
    text.replace(/\s+/g, ' ').trim().slice(0, 160) || `${title} — Informationen und Reviews auf Geza.`;
  const stars = rating != null ? '★'.repeat(rating) + '☆'.repeat(10 - rating) + ` (${rating}/10) — ` : '';
  return stars + teaser;
}

import { decodeMentions } from './mentions';

export function shareTitle(
  title: string,
  year: number | null,
  rating: number | null | undefined,
  facts: (string | null)[],
) {
  return [title + (year ? ` (${year})` : ''), rating != null ? `${rating}/10` : null, ...facts]
    .filter(Boolean)
    .join(' · ');
}

export function shareExcerpt(summary: string, review?: { body: string; spoiler: boolean }) {
  const reviewText =
    review && !review.spoiler ? decodeMentions(review.body).text.replace(/\s+/g, ' ').trim() : '';
  const text = reviewText || summary.replace(/\s+/g, ' ').trim();
  return {
    label: reviewText ? 'Mein Review' : 'Zum Film',
    text: text.length > 180 ? text.slice(0, 177).trimEnd() + '…' : text,
  };
}

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

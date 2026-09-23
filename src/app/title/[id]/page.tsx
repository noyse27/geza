import { getMedia } from '@/lib/catalog';
import { query } from '@/lib/db';
import { MediaDetail } from '@/components/media-detail';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    m = await getMedia(id);
  if (!m) return { title: 'Nicht gefunden' };
  const rating = (await query('SELECT rating FROM ratings WHERE media_id=$1', [id]))[0]?.rating;
  const title = `${m.title}${m.year ? ` (${m.year})` : ''}`;
  const stars = rating != null ? '★'.repeat(rating) + '☆'.repeat(10 - rating) + ` (${rating}/10) — ` : '';
  const description = stars + (m.summary.slice(0, 160) || `${m.title} — Informationen und Reviews auf Geza.`);
  const url = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/title/${id}` : undefined;
  const image = m.poster
    ? m.poster.startsWith('http')
      ? m.poster
      : process.env.PUBLIC_URL
        ? `${process.env.PUBLIC_URL}${m.poster}`
        : undefined
    : undefined;
  return {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Geza',
      images: image ? [{ url: image }] : undefined,
      locale: 'de_DE',
      type: 'website',
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MediaDetail id={id} />;
}

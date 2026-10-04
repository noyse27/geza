import { getMedia } from '@/lib/catalog';
import { query } from '@/lib/db';
import { MediaDetail } from '@/components/media-detail';
import { shareDescription } from '@/lib/share-metadata';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    m = await getMedia(id);
  if (!m) return { title: 'Nicht gefunden' };
  const rating = (await query('SELECT rating FROM ratings WHERE media_id=$1', [id]))[0]?.rating;
  const review = (
    await query<{ body: string; spoiler: boolean }>(
      'SELECT body,spoiler FROM reviews WHERE media_id=$1 AND is_public AND parent_source_id IS NULL ORDER BY created_at DESC LIMIT 1',
      [id],
    )
  )[0];
  const name = m.kind === 'season' && m.parent_title ? `${m.parent_title} – Staffel ${m.season}` : m.title;
  const facts = [m.runtime ? `${m.runtime} Min.` : null, m.certification || null].filter(Boolean);
  const title = `${name}${m.year ? ` (${m.year})` : ''}${facts.length ? ` · ${facts.join(' · ')}` : ''}`;
  const description = shareDescription(m.title, m.summary, rating, review);
  const url = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/title/${id}` : undefined;
  return {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Geza',
      locale: 'de_DE',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MediaDetail id={id} />;
}

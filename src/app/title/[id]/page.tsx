import { getMedia } from '@/lib/catalog';
import { getShareData } from '@/lib/share-data';
import { MediaDetail } from '@/components/media-detail';
import { shareDescription, shareTitle } from '@/lib/share-metadata';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    m = await getMedia(id);
  if (!m) return { title: 'Nicht gefunden' };
  const { rating, review } = await getShareData(id);
  const name = m.kind === 'season' && m.parent_title ? `${m.parent_title} – Staffel ${m.season}` : m.title;
  const facts = [m.runtime ? `${m.runtime} Min.` : null, m.certification || null].filter(Boolean);
  const title = `${name}${m.year ? ` (${m.year})` : ''}${facts.length ? ` · ${facts.join(' · ')}` : ''}`;
  const socialTitle = shareTitle(name, m.year, rating, facts);
  const description = shareDescription(m.title, m.summary, rating, review);
  const url = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/title/${id}` : undefined;
  return {
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      title: socialTitle,
      description,
      url,
      siteName: 'Geza',
      locale: 'de_DE',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
    },
  };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MediaDetail id={id} />;
}

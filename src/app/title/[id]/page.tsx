import { getMedia } from '@/lib/catalog';
import { MediaDetail } from '@/components/media-detail';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    m = await getMedia(id);
  if (!m) return { title: 'Nicht gefunden' };
  return {
    title: `${m.title}${m.year ? ` (${m.year})` : ''}`,
    description: m.summary.slice(0, 160) || `${m.title} — Informationen und Reviews auf Geza.`,
    alternates: process.env.PUBLIC_URL ? { canonical: `${process.env.PUBLIC_URL}/title/${id}` } : undefined,
  };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MediaDetail id={id} />;
}

import { notFound } from 'next/navigation';
import { getFilmSeries } from '@/lib/catalog';
import { isAdmin } from '@/lib/auth';
import { Back } from '@/components/navigation';
import { FilmSeriesList } from '@/components/film-series-list';
export const metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    result = await getFilmSeries(id);
  if (!result) notFound();
  const admin = await isAdmin();
  return (
    <div className="page">
      <Back />
      <div className="page-heading">
        <span className="eyebrow accent">FILMREIHE</span>
        <h1>
          {result.series.title}
          <span className="accent">.</span>
        </h1>
      </div>
      <FilmSeriesList
        seriesId={result.series.id}
        items={JSON.parse(JSON.stringify(result.items))}
        admin={admin}
      />
    </div>
  );
}

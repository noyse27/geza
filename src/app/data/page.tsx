import { searchCatalog } from '@/lib/catalog';
import { requireAdmin } from '@/lib/auth';
import { CatalogBrowser } from '@/components/catalog';
export const metadata = { title: 'Data', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const result = await searchCatalog(new URLSearchParams(await searchParams), true);
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow accent">DEINE SAMMLUNG, DEIN BLICK</span>
        <h1>
          Data<span className="accent">.</span>
        </h1>
        <p>Alle Titel. Gezielt gefiltert.</p>
      </div>
      <CatalogBrowser result={JSON.parse(JSON.stringify(result))} privateMode />
    </div>
  );
}

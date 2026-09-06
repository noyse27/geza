import { requireAdmin } from '@/lib/auth';
import { history, months } from '@/lib/catalog';
import { HistoryBrowser } from '@/components/history';
export const metadata = { title: 'History', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const p = new URLSearchParams(await searchParams);
  const [initial, list] = await Promise.all([history(p), months(p.get('type') || 'all')]);
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow accent">DEIN FILMTAGEBUCH</span>
        <h1>
          History<span className="accent">.</span>
        </h1>
        <p>Jeder Filmabend hat seinen Platz.</p>
      </div>
      <HistoryBrowser
        key={p.toString()}
        initial={JSON.parse(JSON.stringify(initial))}
        months={list as { month: string; count: number }[]}
      />
    </div>
  );
}

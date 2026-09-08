import { isAdmin } from '@/lib/auth';
import { history, months } from '@/lib/catalog';
import { HistoryBrowser } from '@/components/history';
import { openScrobbleCount } from '@/lib/scrobbles';
export const metadata = { title: 'History', robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const admin = await isAdmin();
  const p = new URLSearchParams(await searchParams);
  const openScrobbles = admin ? await openScrobbleCount() : 0;
  const [initial, list] = await Promise.all([
    history(p, admin),
    months(p.get('type') || 'all', admin, p.get('reviews') === '1'),
  ]);
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
        admin={admin}
        openScrobbles={openScrobbles}
        key={p.toString()}
        initial={JSON.parse(JSON.stringify(initial))}
        months={list as { month: string; count: number }[]}
      />
    </div>
  );
}

'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LogOut, ArrowLeft, Rss } from 'lucide-react';
export function Navigation({
  admin,
  feed = false,
  pending = 0,
}: {
  admin: boolean;
  feed?: boolean;
  pending?: number;
}) {
  const path = usePathname();
  const links = admin
    ? [
        ['/home', 'Home'],
        ['/history', 'History'],
        ['/collections', 'Sammlungen'],
        ['/data', 'Data'],
        ['/bucketlist', 'Bucketliste'],
        ['/admin/rumpelkammer', 'Rumpelkammer'],
        ['/stats', 'Statistik'],
        ['/admin', 'Admin'],
      ]
    : [
        ['/', 'Entdecken'],
        ['/search', 'Suche'],
        ['/history', 'History'],
        ['/collections', 'Sammlungen'],
      ];
  return (
    <nav aria-label="Hauptnavigation">
      {links.map(([url, label]) => (
        <Link
          key={url}
          href={url}
          className={
            path === url || (url === '/collections' && path.startsWith('/collections/')) ? 'active' : ''
          }
        >
          {label}
          {url === '/admin' && pending > 0 && (
            <span className="nav-badge" title="Offene Freundschaftsanfragen">
              {pending}
            </span>
          )}
        </Link>
      ))}
      {!admin && feed && (
        <a href="/feed.xml" target="_blank" rel="noopener" title="RSS-Feed abonnieren">
          <Rss size={15} aria-hidden="true" /> ABO
        </a>
      )}
    </nav>
  );
}
export function Logout() {
  const router = useRouter();
  return (
    <button
      className="icon-button"
      title="Abmelden"
      onClick={async () => {
        await fetch('/api/logout', { method: 'POST' });
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith('history:') || key.startsWith('scroll:')) sessionStorage.removeItem(key);
        }
        router.push('/');
        router.refresh();
      }}
    >
      <LogOut size={17} />
    </button>
  );
}
export function Back() {
  const router = useRouter();
  return (
    <button
      className="back-link"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
    >
      <ArrowLeft size={16} /> Zurück
    </button>
  );
}
export function RestoreScroll() {
  const path = usePathname();
  useEffect(() => {
    const key = 'scroll:' + path + window.location.search;
    const pop = (e: PageTransitionEvent) => {
      if (e.persisted) window.scrollTo(0, Number(sessionStorage.getItem(key) || 0));
    };
    const save = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener('pagehide', save);
    window.addEventListener('pageshow', pop);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
      window.removeEventListener('pageshow', pop);
    };
  }, [path]);
  return null;
}

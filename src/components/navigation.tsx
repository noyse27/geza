'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LogOut, ArrowLeft } from 'lucide-react';
export function Navigation({ admin }: { admin: boolean }) {
  const path = usePathname();
  const links = admin
    ? [
        ['/home', 'Home'],
        ['/history', 'History'],
        ['/data', 'Data'],
        ['/stats', 'Statistik'],
        ['/admin', 'Admin'],
      ]
    : [
        ['/', 'Entdecken'],
        ['/search', 'Suche'],
        ['/history', 'History'],
      ];
  return (
    <nav aria-label="Hauptnavigation">
      {links.map(([url, label]) => (
        <Link key={url} href={url} className={path === url ? 'active' : ''}>
          {label}
        </Link>
      ))}
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

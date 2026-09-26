import { isDemo, demoResetMinutes } from '@/lib/demo-mode';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Film, LockKeyhole } from 'lucide-react';
import '@fontsource/syne/400.css';
import '@fontsource/syne/500.css';
import '@fontsource/syne/600.css';
import '@fontsource/syne/700.css';
import '@fontsource/syne/800.css';
import './globals.css';
import { isAdmin } from '@/lib/auth';
import { pendingFriendCount } from '@/lib/federation';
import { Navigation, Logout, RestoreScroll } from '@/components/navigation';
import { ScrollTop } from '@/components/scroll-top';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  metadataBase: process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL) : undefined,
  title: { default: 'Geza — Film & Serie', template: '%s · Geza' },
  description: 'Filme, Serien und persönliche Perspektiven.',
  robots: !isDemo() && process.env.PUBLIC_URL ? undefined : { index: false, follow: false },
  icons: { icon: '/icon.svg' },
  alternates:
    !isDemo() && process.env.PUBLIC_URL ? { types: { 'application/rss+xml': '/feed.xml' } } : undefined,
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();
  const year = new Date().getFullYear();
  const pendingFriends = admin ? await pendingFriendCount() : 0;
  return (
    <html lang="de" data-scroll-behavior="smooth">
      <body>
        <header className="site-header">
          <Link className="brand" href={admin ? '/home' : '/'} aria-label="Geza Startseite">
            <Film size={24} />
            <span>
              geza<span className="brand-dot">.</span>
            </span>
          </Link>
          <Navigation admin={admin} pending={pendingFriends} feed={!isDemo() && !!process.env.PUBLIC_URL} />
          <div className="account">
            {admin ? (
              <>
                <span className="status-dot" />
                <span className="desktop-label">Dein Tagebuch</span>
                <Logout />
              </>
            ) : (
              <Link className="login-link" href="/login">
                <LockKeyhole size={15} /> Anmelden
              </Link>
            )}
          </div>
        </header>
        {isDemo() && (
          <aside className="demo-banner">
            Öffentliche Demo · <Link href="/login">Admin ausprobieren: admin / admin</Link> · Gemeinsame
            Testdaten, Reset alle {demoResetMinutes()} Minuten (auch deine Änderungen und Anmeldung). Bitte
            keine persönlichen Daten eingeben.
          </aside>
        )}
        <main>{children}</main>
        <footer>
          <Link className="footer-brand" href="/">
            <Film size={18} />
            <span>
              geza<span className="brand-dot">.</span>
            </span>
          </Link>
          <span>Für die Filme, die bleiben.</span>
          <span className="footer-copyright">
            &copy; 2026{year > 2026 ? ` - ${year}` : ''} Binged with love &bull; Curated with care &bull;
            Served with style by <a href="https://polze.net/geza.html">PolzeSoft</a>
          </span>
          <Link href="/credits">Daten & Quellen</Link>
          <span className="footer-note">{admin ? 'Privater Bereich verfügbar' : 'Film & Serie'}</span>
        </footer>
        <RestoreScroll />
        <ScrollTop />
      </body>
    </html>
  );
}

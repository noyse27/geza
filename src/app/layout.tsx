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
import { Navigation, Logout, RestoreScroll } from '@/components/navigation';
import { ScrollTop } from '@/components/scroll-top';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: { default: 'Geza — Film & Serie', template: '%s · Geza' },
  description: 'Filme, Serien und persönliche Perspektiven.',
  robots: process.env.PUBLIC_URL ? undefined : { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();
  const year = new Date().getFullYear();
  return (
    <html lang="de">
      <body>
        <header className="site-header">
          <Link className="brand" href={admin ? '/home' : '/'} aria-label="Geza Startseite">
            <Film size={24} />
            <span>
              geza<span className="brand-dot">.</span>
            </span>
          </Link>
          <Navigation admin={admin} />
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
            &copy; 2026{year > 2026 ? ` - ${year}` : ''} Binged with love &bull; Curated with care &bull; Served
            with style by <a href="https://polze.net/geza.html">PolzeSoft</a>
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

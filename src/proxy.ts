import { isDemo, demoBlocked } from './lib/demo-mode';
import { NextResponse, type NextRequest } from 'next/server';
import { installationReady } from './lib/setup';
export async function proxy(request: NextRequest) {
  const next = () => {
    const response = NextResponse.next();
    const origins = (process.env.DEMO_FRAME_ANCESTORS || '').split(/\s+/).filter(Boolean);
    const valid =
      origins.length > 0 &&
      origins.every((value) => {
        try {
          const u = new URL(value);
          return u.protocol === 'https:' && u.origin === value;
        } catch {
          return false;
        }
      });
    if (isDemo() && valid)
      response.headers.set('Content-Security-Policy', 'frame-ancestors ' + origins.join(' '));
    else response.headers.set('X-Frame-Options', 'DENY');
    if (isDemo()) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  };
  const path = request.nextUrl.pathname;
  if (
    isDemo() &&
    (path.startsWith('/api/plex/') ||
      path.startsWith('/api/federation/') ||
      path.startsWith('/api/admin/now-playing/cover'))
  )
    return demoBlocked();
  if (path === '/login' || path === '/api/login' || path === '/api/setup/transfer' || path === '/api/health')
    return next();
  if (await installationReady()) return next();
  if (path.startsWith('/api/'))
    return NextResponse.json(
      { error: 'Die Einrichtung ist noch nicht abgeschlossen.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  return NextResponse.redirect(new URL('/login', request.url));
}
// Upload routes enforce their own setup/auth checks. Bypass proxy body cloning (10 MiB default)
// so large archives are read exactly once with the route's explicit size limit.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|api/setup/transfer|api/import/trakt).*)'],
};

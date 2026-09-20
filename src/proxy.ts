import { NextResponse, type NextRequest } from 'next/server';
import { installationReady } from './lib/setup';
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/login' || path === '/api/login' || path === '/api/setup/transfer' || path === '/api/health')
    return NextResponse.next();
  if (await installationReady()) return NextResponse.next();
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

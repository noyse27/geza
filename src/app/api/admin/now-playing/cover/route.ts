import { isAdmin } from '@/lib/auth';
import { getSetting } from '@/lib/settings';
import { validPlexCoverPath } from '@/lib/plex-cover';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!(await isAdmin())) return new Response(null, { status: 401, headers });
  const path = new URL(req.url).searchParams.get('path');
  if (!validPlexCoverPath(path)) return new Response(null, { status: 400, headers });
  try {
    const [base, token] = await Promise.all([getSetting('PLEX_URL'), getSetting('PLEX_TOKEN')]);
    if (!base || !token) return new Response(null, { status: 404, headers });
    const response = await fetch(new URL(path, base), {
      headers: { 'X-Plex-Token': token, Accept: 'image/*' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    if (
      !response.ok ||
      !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type)
    ) {
      await response.body?.cancel();
      return new Response(null, { status: 502, headers });
    }
    return new Response(response.body, { headers: { ...headers, 'Content-Type': type } });
  } catch {
    return new Response(null, { status: 502, headers });
  }
}

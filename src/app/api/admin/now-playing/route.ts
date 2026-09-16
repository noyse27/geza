import { isAdmin } from '@/lib/auth';
import { plexRequest } from '@/lib/plex';
import { nowPlayingCatalog } from '@/lib/now-playing-catalog';
import { playbackItem } from '@/lib/now-playing';
import { plexCoverFallback } from '@/lib/plex-cover';

export const dynamic = 'force-dynamic';
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401, headers });
  try {
    const data = await plexRequest('/status/sessions');
    const items = [];
    for (const raw of data?.MediaContainer?.Metadata || []) {
      const item = playbackItem(raw);
      if (!item) continue;
      const match = await nowPlayingCatalog(raw);
      if (match) {
        item.mediaId = match.id;
        item.poster = match.poster || undefined;
      }
      item.poster ||= plexCoverFallback(raw);
      items.push(item);
    }
    return Response.json({ items }, { headers });
  } catch {
    return Response.json({ error: 'Plex ist momentan nicht erreichbar.' }, { status: 502, headers });
  }
}

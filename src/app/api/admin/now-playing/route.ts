import { isDemo } from '@/lib/demo-mode';
import { isAdmin } from '@/lib/auth';
import { plexRequest } from '@/lib/plex';
import { nowPlayingCatalog } from '@/lib/now-playing-catalog';
import { playbackItem } from '@/lib/now-playing';
import { plexCoverFallback } from '@/lib/plex-cover';
import { query } from '@/lib/db';
import { demoPlaybackItems, type DemoPlaybackMedia } from '@/lib/demo-now-playing';

export const dynamic = 'force-dynamic';
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401, headers });
  if (isDemo()) {
    const media = await query<DemoPlaybackMedia>(
      `SELECT * FROM (
        SELECT DISTINCT ON (m.kind) m.id,m.kind,m.title,m.year,m.runtime,m.poster,
          p.title AS parent_title,m.season,m.episode
        FROM media m LEFT JOIN media p ON p.id=m.parent_id
        WHERE m.kind IN ('movie','episode') ORDER BY m.kind,m.id
      ) samples ORDER BY kind DESC`,
    );
    return Response.json({ items: demoPlaybackItems(media) }, { headers });
  }
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

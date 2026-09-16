import { isAdmin } from '@/lib/auth';
import { plexIds, plexRequest } from '@/lib/plex';
import { query } from '@/lib/db';
import { playbackItem } from '@/lib/now-playing';

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
      const matches = await query<{ id: string; poster: string | null }>(
        `SELECT m.id,COALESCE(m.poster,p.poster) AS poster FROM media m
         LEFT JOIN media p ON p.id=m.parent_id WHERE m.kind=$1 AND
         EXISTS(SELECT 1 FROM jsonb_each_text($2::jsonb) x WHERE m.ids->>x.key=x.value) LIMIT 2`,
        [raw.type, JSON.stringify(plexIds(raw))],
      );
      if (matches.length === 1) {
        item.mediaId = matches[0].id;
        item.poster = matches[0].poster || undefined;
      }
      items.push(item);
    }
    return Response.json({ items }, { headers });
  } catch {
    return Response.json({ error: 'Plex ist momentan nicht erreichbar.' }, { status: 502, headers });
  }
}

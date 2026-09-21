import { isDemo } from './demo-mode';
import { logEvent } from './logging';
import { query } from './db';
import { getSetting } from './settings';
import { plexRequest, ensurePlexMedia } from './plex';
import { mergeMetadata, fromPlex } from './providers';
type PlexMetadata = Record<string, any>;
const RESCHEDULE_SQL = `INSERT INTO jobs(kind,dedupe_key,payload,available_at) VALUES('plex-scan','plex-scan-daily','{}',
  ((date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') + interval '1 day' + interval '3 hours') AT TIME ZONE 'Europe/Berlin'))
  ON CONFLICT(dedupe_key) DO UPDATE SET available_at=excluded.available_at,status='pending',attempts=0,error=NULL`;
async function scanItem(item: PlexMetadata, watched: boolean) {
  const id = await ensurePlexMedia(item);
  await mergeMetadata(id, fromPlex(item));
  return { id, watched };
}
export async function processPlexScan(payload: { manual?: boolean } = {}) {
  if (isDemo()) return;
  try {
    const enabled = (await getSetting('PLEX_SCAN_ENABLED')) === '1';
    if (!enabled && !payload.manual) {
      await logEvent('info', 'plex-scan', 'Bibliotheks-Scan übersprungen: nicht aktiviert');
      return;
    }
    const watchedOnly = (await getSetting('PLEX_SCAN_WATCHED_ONLY')) === '1';
    const sectionFilter = (await getSetting('PLEX_SCAN_SECTIONS'))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const data = await plexRequest('/library/sections');
    const sections = (data?.MediaContainer?.Directory || []).filter(
      (s: PlexMetadata) =>
        ['movie', 'show'].includes(s.type) && (!sectionFilter.length || sectionFilter.includes(String(s.key))),
    );
    let touched = 0,
      bucketed = 0;
    for (const section of sections) {
      const listing = await plexRequest(
        `/library/sections/${encodeURIComponent(section.key)}/all?includeGuids=1`,
      );
      const items: PlexMetadata[] = listing?.MediaContainer?.Metadata || [];
      const entries: { id: string; watched: boolean }[] = [];
      for (const item of items) {
        if (!['movie', 'show'].includes(item.type)) continue;
        const watched = item.type === 'movie' ? Number(item.viewCount) > 0 : Number(item.viewedLeafCount) > 0;
        try {
          entries.push(await scanItem(item, watched));
        } catch (error) {
          await logEvent('warn', 'plex-scan', 'Titel konnte nicht verarbeitet werden', {
            title: item.title,
            type: item.type,
            error,
          });
        }
      }
      if (!entries.length) continue;
      const ids = entries.map((e) => e.id);
      const exceptions = new Set(
        (
          await query<{ id: string }>(
            `SELECT id FROM media WHERE id=ANY($1::bigint[]) AND (EXISTS(SELECT 1 FROM ratings WHERE media_id=media.id) OR EXISTS(SELECT 1 FROM reviews WHERE media_id=media.id))`,
            [ids],
          )
        ).map((r) => r.id),
      );
      const rows = entries.map((e) => ({
        id: e.id,
        bucketlist: watchedOnly && !e.watched && !exceptions.has(e.id),
      }));
      bucketed += rows.filter((r) => r.bucketlist).length;
      await query(
        `UPDATE media m SET bucketlist=x.bucketlist FROM jsonb_to_recordset($1::jsonb) AS x(id bigint,bucketlist boolean) WHERE m.id=x.id AND m.bucketlist IS DISTINCT FROM x.bucketlist`,
        [JSON.stringify(rows)],
      );
      await query(
        `INSERT INTO jobs(kind,dedupe_key,payload) SELECT 'enrich','enrich:'||id,jsonb_build_object('mediaId',id) FROM media WHERE id=ANY($1::bigint[]) AND enriched_at IS NULL ON CONFLICT(dedupe_key) DO NOTHING`,
        [ids],
      );
      touched += ids.length;
    }
    await logEvent('info', 'plex-scan', 'Bibliotheks-Scan abgeschlossen', {
      sections: sections.length,
      titles: touched,
      bucketlist: bucketed,
    });
  } catch (error) {
    await logEvent('error', 'plex-scan', 'Bibliotheks-Scan fehlgeschlagen', { error });
    throw error;
  } finally {
    await query(RESCHEDULE_SQL);
  }
}

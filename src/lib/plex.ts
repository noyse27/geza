import { query } from './db';
import { getSetting } from './settings';
import { watchedTime } from './security';
type PlexMetadata = Record<string, any>;
export function plexIds(m: PlexMetadata) {
  const ids: Record<string, string> = {};
  const guids = [m.guid, ...(m.Guid || []).map((g: { id: string }) => g.id)].filter(Boolean);
  for (const guid of guids) {
    const match = String(guid).match(
      /^(imdb|tmdb|tvdb|plex):\/\/(?:movie\/|show\/|episode\/|season\/)?([^?]+)/,
    );
    if (match) ids[match[1]] = match[2];
  }
  return ids;
}
export async function plexRequest(path: string) {
  const base = await getSetting('PLEX_URL'),
    token = await getSetting('PLEX_TOKEN');
  if (!base || !token) return null;
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) throw Error('Ungültiger Plex-Pfad');
  const r = await fetch(url, {
    headers: { 'X-Plex-Token': token, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
  });
  if (!r.ok) throw Error(`Plex HTTP ${r.status}`);
  return r.json();
}
export async function findPlex(ids: Record<string, unknown>, kind: string) {
  if (!ids.plex) return null;
  const data = await plexRequest(`/library/all?guid=${encodeURIComponent(`plex://${kind}/${ids.plex}`)}`);
  return data?.MediaContainer?.Metadata?.[0] || null;
}
export async function ensurePlexMedia(m: PlexMetadata, parentId?: string): Promise<string> {
  const kind = m.type;
  if (!['movie', 'show', 'season', 'episode'].includes(kind)) throw Error('Nicht unterstützter Medientyp');
  const ids = plexIds(m);
  if (!Object.keys(ids).length) throw Error('Keine verlässliche Medien-ID im Plex-Ereignis');
  const matches = await query(
    `SELECT DISTINCT id FROM media WHERE kind=$1 AND EXISTS(SELECT 1 FROM jsonb_each_text($2::jsonb) x WHERE ids->>x.key=x.value)`,
    [kind, JSON.stringify(ids)],
  );
  if (matches.length > 1) throw Error('Mehrdeutige Provider-IDs: manuelle Zuordnung erforderlich');
  if (matches.length) {
    await query('UPDATE media SET ids=ids||$1::jsonb,parent_id=COALESCE(parent_id,$2) WHERE id=$3', [
      JSON.stringify(ids),
      parentId || null,
      matches[0].id,
    ]);
    return matches[0].id;
  }
  return (
    await query(
      `INSERT INTO media(kind,title,year,ids,parent_id,season,episode) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        kind,
        m.title || 'Unbekannter Titel',
        m.year || null,
        JSON.stringify(ids),
        parentId || null,
        m.parentIndex ?? null,
        kind === 'episode' ? m.index : null,
      ],
    )
  )[0].id;
}
export async function processPlex(payload: {
  event: string;
  metadata: PlexMetadata;
  receivedAt: string;
  eventId: string;
}) {
  let m = payload.metadata;
  if (m.ratingKey) {
    const data = await plexRequest(`/library/metadata/${encodeURIComponent(String(m.ratingKey))}`);
    if (data?.MediaContainer?.Metadata?.[0]) m = { ...m, ...data.MediaContainer.Metadata[0] };
  }
  let parent: string | undefined;
  if (m.type === 'episode' && m.grandparentRatingKey) {
    const p = await plexRequest(`/library/metadata/${encodeURIComponent(String(m.grandparentRatingKey))}`);
    if (p?.MediaContainer?.Metadata?.[0]) parent = await ensurePlexMedia(p.MediaContainer.Metadata[0]);
  }
  const id = await ensurePlexMedia(m, parent);
  const { mergeMetadata, fromPlex, plexPoster } = await import('./providers');
  await mergeMetadata(id, fromPlex(m));
  await plexPoster(id, m);
  if (payload.event === 'media.scrobble') {
    const at =
      typeof m.lastViewedAt === 'number' ? watchedTime(new Date(m.lastViewedAt * 1000).toISOString()) : null;
    await query(
      `INSERT INTO watches(media_id,source,source_id,watched_at,time_estimated) VALUES($1,'plex',$2,$3,$4) ON CONFLICT(source,source_id) DO NOTHING`,
      [id, payload.eventId, at || payload.receivedAt, !at],
    );
  } else if (payload.event === 'media.rate') {
    if (m.userRating === undefined)
      throw Error('Plex liefert keine persönliche Bewertung; Serverzugriff prüfen.');
    const n = Number(m.userRating);
    if (!Number.isFinite(n) || n < 0 || n > 10) throw Error('Unbekannte Plex-Bewertungsskala');
    if (n === 0)
      await query('DELETE FROM ratings WHERE media_id=$1 AND rated_at<=$2', [id, payload.receivedAt]);
    else
      await query(
        `INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,$2,$3,'plex') ON CONFLICT(media_id) DO UPDATE SET rating=excluded.rating,rated_at=excluded.rated_at,source='plex' WHERE ratings.rated_at<=excluded.rated_at`,
        [id, Math.round(n), payload.receivedAt],
      );
  }
  await query(
    `INSERT INTO jobs(kind,dedupe_key,payload) VALUES('enrich',$1,$2) ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',available_at=now(),attempts=0 WHERE jobs.status IN ('done','failed')`,
    ['enrich:' + id, JSON.stringify({ mediaId: id })],
  );
}

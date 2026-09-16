import { plexIds, plexRequest } from './plex';
import { query } from './db';

type Match = { id: string; poster: string | null };
async function find(kind: string, ids: Record<string, string>): Promise<Match[]> {
  if (!Object.keys(ids).length) return [];
  return query<Match>(
    `SELECT m.id,COALESCE(NULLIF(m.poster,''),NULLIF(p.poster,'')) AS poster FROM media m
     LEFT JOIN media p ON p.id=m.parent_id WHERE m.kind=$1 AND
     EXISTS(SELECT 1 FROM jsonb_each_text($2::jsonb) x WHERE m.ids->>x.key=x.value) LIMIT 2`,
    [kind, JSON.stringify(ids)],
  );
}

export async function nowPlayingCatalog(
  raw: Record<string, any>,
  dependencies = { find, request: plexRequest },
): Promise<Match | null> {
  const ids = plexIds(raw);
  let matches = await dependencies.find(raw.type, ids);
  // Session metadata can omit the external IDs used by a Trakt-imported catalog.
  // Only resolve through a numeric library key, never through an arbitrary session URL.
  if (!matches.length && /^\d+$/.test(String(raw.ratingKey ?? ''))) {
    try {
      const data = await dependencies.request(`/library/metadata/${raw.ratingKey}?includeGuids=1`);
      const metadata = data?.MediaContainer?.Metadata?.find(
        (entry: Record<string, any>) =>
          String(entry.ratingKey) === String(raw.ratingKey) && entry.type === raw.type,
      );
      if (metadata) {
        matches = await dependencies.find(raw.type, { ...ids, ...plexIds(metadata) });
      }
    } catch {
      // An optional cover lookup must not hide an otherwise valid playback session.
      return null;
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

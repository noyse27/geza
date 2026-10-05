import type { PoolClient } from 'pg';
import { query } from './db';
import { isDemo } from './demo-mode';
import { logEvent } from './logging';
import { plexRequest, plexIds, selectPlexMatch } from './plex';
import { digest } from './security';
import { getSetting } from './settings';

type Metadata = Record<string, any>;
type RestoreContext = { url: string; token: string; server: string; fingerprint: string };
export type PlexRestore = {
  mediaId: string;
  ratingKey: string;
  guid: string;
  type: 'movie' | 'episode';
  connection: string;
};

export function plexWatched(item: Metadata) {
  const count = item.viewCount ?? 0;
  if (
    !['number', 'string'].includes(typeof count) ||
    String(count).trim() === '' ||
    !Number.isSafeInteger(Number(count)) ||
    Number(count) < 0
  )
    throw Error('Ungültiger Plex-Gesehenstatus');
  return Number(count) > 0;
}

export async function getPlexRestoreContext(): Promise<RestoreContext | null> {
  if (isDemo() || (await getSetting('PLEX_RESTORE_WATCHED')) !== '1') return null;
  const [url, token, server, account] = await Promise.all(
    ['PLEX_URL', 'PLEX_TOKEN', 'PLEX_SERVER_ID', 'PLEX_ACCOUNT_ID'].map(getSetting),
  );
  if (!url || !token || !server || !account)
    throw Error('Plex-Wiederherstellung benötigt URL, Token, Server-UUID und Account-ID.');
  return { url, token, server, fingerprint: digest(JSON.stringify([url, token, server, account])) };
}

// Called inside the scan transaction: preview/failed scans never publish restore jobs.
export async function queuePlexRestore(
  client: PoolClient,
  context: RestoreContext | null,
  mediaId: string,
  item: Metadata,
) {
  if (
    !context ||
    !['movie', 'episode'].includes(item.type) ||
    plexWatched(item) ||
    !item.ratingKey ||
    typeof item.guid !== 'string' ||
    !item.guid
  )
    return false;
  const payload: PlexRestore = {
    mediaId,
    ratingKey: String(item.ratingKey),
    guid: item.guid,
    type: item.type,
    connection: context.fingerprint,
  };
  const result = await client.query(
    `INSERT INTO jobs(kind,dedupe_key,payload)
     SELECT 'plex-watch-restore',$1,$2 WHERE EXISTS(SELECT 1 FROM watches WHERE media_id=$3)
     ON CONFLICT(dedupe_key) DO UPDATE SET payload=excluded.payload,status='pending',
       available_at=now(),attempts=0,error=NULL
     WHERE jobs.status IN ('done','failed') RETURNING id`,
    [`plex-watch-restore:${context.fingerprint}:${payload.ratingKey}`, JSON.stringify(payload), mediaId],
  );
  return !!result.rowCount;
}

export async function processPlexRestore(payload: PlexRestore) {
  const context = await getPlexRestoreContext();
  if (!context || context.fingerprint !== payload.connection) return;
  if (!['movie', 'episode'].includes(payload.type) || !payload.ratingKey || !payload.guid)
    throw Error('Ungültiger Plex-Wiederherstellungsauftrag');
  const options = { connection: context };
  const identity = await plexRequest('/identity', options);
  if (identity?.MediaContainer?.machineIdentifier !== context.server)
    throw Error('Plex-Server-UUID stimmt nicht mit dem Wiederherstellungsauftrag überein.');
  const path = `/library/metadata/${encodeURIComponent(payload.ratingKey)}?includeGuids=1`;
  const read = async () => {
    const data = await plexRequest(path, options);
    const item = data?.MediaContainer?.Metadata?.find(
      (m: Metadata) => String(m.ratingKey) === payload.ratingKey,
    );
    if (!item || item.type !== payload.type || item.guid !== payload.guid)
      throw Error('Plex-Zuordnung hat sich geändert; erneuter Bibliotheks-Scan erforderlich.');
    return item;
  };
  const item = await read();
  if (plexWatched(item)) return;
  // A manual deletion in Geza after queueing must take precedence.
  const [media] = await query(
    `SELECT m.kind,m.ids FROM media m WHERE m.id=$1
       AND EXISTS(SELECT 1 FROM watches w WHERE w.media_id=m.id)`,
    [payload.mediaId],
  );
  if (!media) return;
  if (media.kind !== payload.type || !selectPlexMatch([media], plexIds(item)))
    throw Error('Geza-Zuordnung hat sich geändert; erneuter Bibliotheks-Scan erforderlich.');
  const key = `plex-watch-restore:${context.fingerprint}:${payload.ratingKey}`;
  // Record the attempt before the network call, including when Plex accepts it but the response is lost.
  await query(
    `UPDATE jobs SET payload=payload||jsonb_build_object('restoreStartedAt',now()) WHERE dedupe_key=$1`,
    [key],
  );
  const params = new URLSearchParams({ key: payload.ratingKey, identifier: 'com.plexapp.plugins.library' });
  await plexRequest(`/:/scrobble?${params}`, { ...options, emptyResponse: true });
  if (!plexWatched(await read())) throw Error('Plex hat den Gesehen-Status noch nicht bestätigt.');
  await logEvent('info', 'plex-watch-restore', 'Gesehen-Status aus Geza in Plex wiederhergestellt', {
    mediaId: payload.mediaId,
    ratingKey: payload.ratingKey,
  });
}

// Marking watched is not a new viewing. Never suppress real playback events (with a Player).
export async function isPlexRestoreEcho(item: Metadata, receivedAt: string) {
  if (!item.ratingKey || !item.guid) return false;
  const context = await getPlexRestoreContext();
  if (!context) return false;
  const rows = await query(
    `SELECT 1 FROM jobs WHERE dedupe_key=$1 AND payload->>'guid'=$2
       AND (payload->>'restoreStartedAt')::timestamptz BETWEEN $3::timestamptz-interval '2 minutes' AND $3::timestamptz`,
    [`plex-watch-restore:${context.fingerprint}:${String(item.ratingKey)}`, item.guid, receivedAt],
  );
  return rows.length > 0;
}

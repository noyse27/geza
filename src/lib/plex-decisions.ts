import type { PoolClient } from 'pg';
import { query } from './db';
import { getSetting } from './settings';

export async function plexServerScope() {
  return (await getSetting('PLEX_SERVER_ID')) || (await getSetting('PLEX_URL'));
}

// Bind to the server, local library key AND GUID: a reused key must not inherit a decision.
export async function decidedPlexMedia(item: Record<string, any>, client?: PoolClient, serverScope?: string) {
  if (!item.ratingKey || !item.guid) return undefined;
  const sql = `SELECT m.* FROM plex_match_decisions d JOIN media m ON m.id=d.media_id
    WHERE d.server_id=$1 AND d.rating_key=$2 AND d.guid=$3 AND m.kind=$4`;
  const args = [serverScope ?? (await plexServerScope()), String(item.ratingKey), item.guid, item.type];
  return (client ? (await client.query(sql, args)).rows : await query(sql, args))[0];
}

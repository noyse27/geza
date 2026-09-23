import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool, query } from './db';
import { cardColumns } from './catalog';
import type { Media } from './types';

// Rumpelkammer: Filme und Serien ohne Aktivität, die nicht auf der Bucketliste stehen (siehe Migration 017).
// Die Zugehörigkeit (media.rumpel) pflegen Datenbank-Trigger; hier wird sie nur gelesen und ausgewertet.
export const PAGE_SIZE = 60;
export const MAX_SELECTION = 20000;
const idSchema = z.string().regex(/^[1-9]\d{0,17}$/);
export const filterSchema = z.object({
  q: z.string().trim().max(160).default(''),
  type: z.enum(['all', 'movie', 'show']).default('all'),
  // Herkunft: mit oder ohne Plex-Verweis (die Plex-ID stammt aus Plex-Scan oder Trakt-Collection).
  source: z.enum(['all', 'plex', 'other']).default('all'),
});
export type RumpelFilter = z.infer<typeof filterSchema>;
export const actionSchema = z
  .object({
    action: z.enum(['bucketlist', 'rate', 'delete']),
    ids: z.array(idSchema).min(1).max(MAX_SELECTION).optional(),
    filter: filterSchema.optional(),
    expectedCount: z.number().int().min(1).max(MAX_SELECTION).optional(),
    rating: z.number().int().min(1).max(10).optional(),
  })
  .refine((v) => !!v.ids !== !!v.filter, 'Entweder Einträge oder ein Filter angeben.')
  .refine((v) => !v.filter || v.expectedCount !== undefined, 'Erwartete Anzahl fehlt.')
  .refine((v) => v.action !== 'rate' || v.rating !== undefined, 'Bewertung fehlt.');

function where(filter: RumpelFilter, values: unknown[]) {
  const conditions = ["m.rumpel", "m.kind IN ('movie','show')"];
  if (filter.type !== 'all') conditions.push(`m.kind=$${values.push(filter.type)}`);
  if (filter.source === 'plex') conditions.push("m.ids ? 'plex'");
  if (filter.source === 'other') conditions.push("NOT (m.ids ? 'plex')");
  if (filter.q) {
    values.push('%' + filter.q.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%');
    conditions.push(`m.search_text LIKE $${values.length}`);
  }
  return conditions.join(' AND ');
}

export async function listRumpel(filter: RumpelFilter, page: number) {
  const values: unknown[] = [];
  const clause = where(filter, values);
  const [{ total }] = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM media m WHERE ${clause}`,
    values,
  );
  const rows = await query<Media & { children: number; has_plex: boolean }>(
    `SELECT ${cardColumns},m.summary,m.ids,(m.ids ? 'plex') AS has_plex,
       (SELECT count(*)::int FROM media c WHERE c.parent_id=m.id OR c.parent_id IN (SELECT s.id FROM media s WHERE s.parent_id=m.id)) AS children
     FROM media m LEFT JOIN media p ON p.id=m.parent_id WHERE ${clause}
     ORDER BY lower(m.title),m.id LIMIT ${PAGE_SIZE} OFFSET ${Math.max(0, page) * PAGE_SIZE}`,
    values,
  );
  return { items: rows, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function rumpelCounts() {
  const [row] = await query<{ movies: number; shows: number }>(
    `SELECT count(*) FILTER(WHERE kind='movie')::int AS movies,count(*) FILTER(WHERE kind='show')::int AS shows FROM media WHERE rumpel AND kind IN ('movie','show')`,
  );
  return row;
}

async function selectIds(client: PoolClient, input: z.infer<typeof actionSchema>) {
  if (input.ids) {
    const ids = [...new Set(input.ids)];
    const found = (
      await client.query<{ id: string }>(
        `SELECT id FROM media WHERE id=ANY($1::bigint[]) AND rumpel AND kind IN ('movie','show') ORDER BY id FOR UPDATE`,
        [ids],
      )
    ).rows.map((r) => r.id);
    return { ids: found, skipped: ids.length - found.length };
  }
  const values: unknown[] = [];
  const clause = where(input.filter!, values);
  const found = (
    await client.query<{ id: string }>(`SELECT m.id FROM media m WHERE ${clause} ORDER BY m.id FOR UPDATE OF m`, values)
  ).rows.map((r) => r.id);
  if (found.length !== input.expectedCount)
    throw new RumpelError('Die Auswahl hat sich geändert. Bitte die Seite neu laden und erneut auswählen.');
  return { ids: found, skipped: 0 };
}

export class RumpelError extends Error {}

export async function runRumpelAction(raw: unknown) {
  const input = actionSchema.parse(raw);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout=120000');
    const { ids, skipped } = await selectIds(client, input);
    if (!ids.length) {
      await client.query('ROLLBACK');
      return { count: 0, skipped };
    }
    if (input.action === 'bucketlist') {
      // bucketlist_pinned schützt den Eintrag vor dem Plex-Scan; der Trigger nimmt ihn aus der Rumpelkammer.
      await client.query('UPDATE media SET bucketlist=true,bucketlist_pinned=true WHERE id=ANY($1::bigint[])', [
        ids,
      ]);
    } else if (input.action === 'rate') {
      await client.query(
        `INSERT INTO ratings(media_id,rating,rated_at,source) SELECT id,$2,now(),'geza' FROM unnest($1::bigint[]) id
         ON CONFLICT(media_id) DO UPDATE SET rating=excluded.rating,rated_at=now(),source='geza'`,
        [ids, input.rating],
      );
    } else {
      await deleteRoots(client, ids);
    }
    await client.query('COMMIT');
    return { count: ids.length, skipped };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Löscht Wurzeln samt Staffeln/Episoden und merkt sie in rumpel_deleted, damit Importe sie nicht erneut anlegen.
export async function deleteRoots(client: PoolClient, rootIds: string[]) {
  await client.query("SET LOCAL geza.skip_rumpel='on'");
  await client.query(
    `INSERT INTO rumpel_deleted(kind,title,year,ids)
     SELECT kind,title,year,ids||CASE WHEN trakt_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('trakt',trakt_id) END
     FROM media WHERE id=ANY($1::bigint[]) AND kind IN ('movie','show')`,
    [rootIds],
  );
  const tree = (
    await client.query<{ id: string }>(
      `WITH RECURSIVE t(id) AS (SELECT id FROM media WHERE id=ANY($1::bigint[])
         UNION ALL SELECT c.id FROM media c JOIN t ON c.parent_id=t.id) SELECT id FROM t`,
      [rootIds],
    )
  ).rows.map((r) => r.id);
  for (const table of ['watches', 'ratings', 'reviews', 'posters'])
    await client.query(`DELETE FROM ${table} WHERE media_id=ANY($1::bigint[])`, [tree]);
  await client.query("DELETE FROM jobs WHERE payload->>'mediaId'=ANY($1::text[])", [tree]);
  await client.query('DELETE FROM media WHERE id=ANY($1::bigint[])', [tree]);
}

// --- Gedächtnis gelöschter Titel (Import und Plex-Scan) ---
const TOMBSTONE_KEYS = ['trakt', 'tmdb', 'imdb', 'tvdb', 'plex'];
export type Tombstones = {
  matches(kind: string, ids: Record<string, unknown>): number[];
};
export async function loadTombstones(client?: PoolClient): Promise<Tombstones> {
  const run = client ? (s: string) => client.query(s).then((r) => r.rows) : (s: string) => query(s);
  const rows = (await run('SELECT id,kind,ids FROM rumpel_deleted')) as {
    id: string;
    kind: string;
    ids: Record<string, unknown>;
  }[];
  const index = new Map<string, number[]>();
  for (const row of rows)
    for (const key of TOMBSTONE_KEYS) {
      const value = row.ids?.[key];
      if (value == null || value === '') continue;
      const k = `${row.kind}:${key}:${value}`;
      index.set(k, [...(index.get(k) || []), Number(row.id)]);
    }
  return {
    matches(kind, ids) {
      const found = new Set<number>();
      for (const key of TOMBSTONE_KEYS) {
        const value = ids?.[key];
        if (value == null || value === '') continue;
        for (const id of index.get(`${kind}:${key}:${value}`) || []) found.add(id);
      }
      return [...found];
    },
  };
}
export async function forgetTombstones(ids: number[], client?: PoolClient) {
  if (!ids.length) return;
  const sql = 'DELETE FROM rumpel_deleted WHERE id=ANY($1::bigint[])';
  if (client) await client.query(sql, [ids]);
  else await query(sql, [ids]);
}

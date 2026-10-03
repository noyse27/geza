import { pool, query } from './db';
import { normalizeCountryToken } from './countries';
import { normalizeGenreToken } from './genres';
import type { PoolClient } from 'pg';

export type FacetCategory = 'country' | 'genre';
export const facetColumn: Record<FacetCategory, 'countries' | 'genres'> = {
  country: 'countries',
  genre: 'genres',
};
const staticNormalize: Record<FacetCategory, (raw: string) => string> = {
  country: normalizeCountryToken,
  genre: normalizeGenreToken,
};

async function aliasMap(category: FacetCategory, client?: PoolClient): Promise<Record<string, string>> {
  const rows = client
    ? (await client.query('SELECT alias,canonical FROM facet_aliases WHERE category=$1', [category])).rows
    : await query<{ alias: string; canonical: string }>(
        'SELECT alias,canonical FROM facet_aliases WHERE category=$1',
        [category],
      );
  const map = Object.fromEntries(rows.map((r) => [r.alias, r.canonical]));
  return map;
}

export function resolveFacet(value: string, aliases: Record<string, string>): string {
  const visited = new Set<string>();
  while (Object.hasOwn(aliases, value) && aliases[value] !== value) {
    if (visited.has(value)) throw Error('Zirkuläre Alias-Zuordnung. Bitte Zuordnung lösen.');
    visited.add(value);
    value = aliases[value];
  }
  return value;
}

// Explicit mappings and chosen target names take precedence over built-in spelling normalization.
export async function normalizeFacetArray(
  category: FacetCategory,
  raw: string[] | null | undefined,
  client?: PoolClient,
): Promise<string[] | undefined> {
  if (!raw) return raw ?? undefined;
  const project = await facetProjector(category, client);
  return project(raw);
}

export async function facetProjector(category: FacetCategory, client?: PoolClient) {
  const aliases = await aliasMap(category, client);
  const run = client
    ? async (sql: string, values: unknown[]) => (await client.query(sql, values)).rows
    : query;
  const targets = new Set(
    (await run('SELECT value FROM facet_terms WHERE category=$1 AND is_target=true', [category])).map(
      (row) => row.value,
    ),
  );
  const normalize = staticNormalize[category];
  return (raw: string[]) => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const rawValue = item.trim();
      const value = resolveFacet(
        Object.hasOwn(aliases, rawValue) || targets.has(rawValue) ? rawValue : normalize(rawValue),
        aliases,
      );
      if (value && !seen.has(value)) {
        seen.add(value);
        result.push(value);
      }
    }
    return result;
  };
}

export class FacetReleaseError extends Error {}

export async function assertFacetRecoveryIdle(client: PoolClient) {
  if (
    (
      await client.query(
        "SELECT 1 FROM jobs WHERE dedupe_key='facet-recovery-v1' AND status IN ('pending','running')",
      )
    ).rowCount
  )
    throw new FacetReleaseError(
      'Die Originalwerte werden gerade wiederhergestellt. Bitte den Abschluss abwarten.',
    );
}

// Always derive the display from immutable source values, never from an earlier merge result.
export async function reprojectFacets(client: PoolClient, category: FacetCategory) {
  const column = facetColumn[category];
  const project = await facetProjector(category, client);
  await client.query("SET LOCAL geza.facet_projection='on'");
  let cursor = '0',
    affected = 0;
  for (;;) {
    const { rows } = await client.query(
      `SELECT id::text,original_${column} AS original,${column} AS current FROM media
      WHERE id>$1 AND original_${column} IS NOT NULL ORDER BY id LIMIT 500`,
      [cursor],
    );
    if (!rows.length) break;
    const updates = rows
      .map((row) => ({ id: row.id, values: project(row.original), current: row.current }))
      .filter((row) => JSON.stringify(row.values) !== JSON.stringify(row.current));
    if (updates.length) {
      const result = await client.query(
        `UPDATE media m SET ${column}=x.values FROM
        jsonb_to_recordset($1::jsonb) AS x(id bigint,values text[]) WHERE m.id=x.id`,
        [JSON.stringify(updates)],
      );
      affected += result.rowCount || 0;
    }
    cursor = rows[rows.length - 1].id;
  }
  return affected;
}

async function assertOriginalsKnown(client: PoolClient, category: FacetCategory, values: string[]) {
  const column = facetColumn[category];
  if (
    (
      await client.query(
        `SELECT 1 FROM media WHERE original_${column} IS NULL AND ${column} && $1::text[] LIMIT 1`,
        [values],
      )
    ).rowCount
  )
    throw new FacetReleaseError(
      'Für betroffene Titel fehlen noch verlässliche Originalwerte. Bitte zuerst die Wiederherstellung abschließen oder deren Originalwerte im Titel bearbeiten.',
    );
}

export async function facetManagerItems(category: FacetCategory) {
  const [groups, terms, aliases] = await Promise.all([
    rawFacetGroups(category),
    query<{ value: string; is_target: boolean }>(
      'SELECT value,is_target FROM facet_terms WHERE category=$1',
      [category],
    ),
    aliasMap(category),
  ]);
  const values = new Set([
    ...groups.map((g) => g.value),
    ...terms.map((t) => t.value),
    ...Object.keys(aliases),
    ...Object.values(aliases),
  ]);
  const targets = new Set([
    ...terms.filter((t) => t.is_target).map((t) => t.value),
    ...Object.values(aliases),
  ]);
  return [...values]
    .filter((value) => !Object.hasOwn(aliases, value))
    .map((value) => ({
      value,
      count: groups.find((g) => g.value === value)?.count ?? 0,
      isTarget: targets.has(value),
      aliases: Object.keys(aliases).filter((alias) => resolveFacet(alias, aliases) === value),
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'de'));
}

export async function rawFacetGroups(category: FacetCategory) {
  const column = facetColumn[category];
  return query<{ value: string; count: number }>(
    `SELECT value,count(*)::int AS count FROM media m CROSS JOIN unnest(m.${column}) value
     GROUP BY value ORDER BY count DESC,value`,
  );
}

export async function mergeFacetAlias(category: FacetCategory, aliases: string[], canonical: string) {
  const column = facetColumn[category];
  const target = canonical.trim();
  const sources = [...new Set(aliases.map((a) => a.trim()).filter(Boolean))].filter((a) => a !== target);
  if (!target || !sources.length) return { affected: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    await assertFacetRecoveryIdle(client);
    const map = Object.fromEntries(
      (
        await client.query('SELECT alias,canonical FROM facet_aliases WHERE category=$1', [category])
      ).rows.map((r) => [r.alias, r.canonical]),
    );
    if (Object.hasOwn(map, target) || sources.some((source) => Object.hasOwn(map, source)))
      throw Error('Die Auswahl wurde inzwischen zugeordnet. Bitte Seite neu laden.');
    await assertOriginalsKnown(client, category, sources);
    await client.query(
      `INSERT INTO facet_terms(category,value,is_target) VALUES($1,$2,true)
      ON CONFLICT(category,value) DO UPDATE SET is_target=true`,
      [category, target],
    );
    for (const alias of sources)
      await client.query(
        `INSERT INTO facet_aliases(category,alias,canonical) VALUES($1,$2,$3)
         ON CONFLICT (category,alias) DO UPDATE SET canonical=EXCLUDED.canonical`,
        [category, alias, target],
      );
    const affected = await reprojectFacets(client, category);
    await client.query('COMMIT');
    return { affected };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseFacetTarget(category: FacetCategory, value: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    await assertFacetRecoveryIdle(client);
    const linked = await client.query(
      'SELECT 1 FROM facet_aliases WHERE category=$1 AND (alias=$2 OR canonical=$2) LIMIT 1',
      [category, value],
    );
    if (linked.rowCount)
      throw new FacetReleaseError(
        'Der Begriff hat noch Aliase oder wurde inzwischen zugeordnet. Bitte die Ansicht aktualisieren und zuerst seine Aliase lösen.',
      );
    const result = await client.query(
      'UPDATE facet_terms SET is_target=false WHERE category=$1 AND value=$2 AND is_target=true',
      [category, value],
    );
    if (!result.rowCount)
      throw new FacetReleaseError(
        'Der Begriff ist kein gespeichertes Ziel mehr. Bitte die Ansicht aktualisieren.',
      );
    await client.query('COMMIT');
    return { affected: result.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function unmergeFacetAliases(category: FacetCategory, aliases: string[], canonical: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    await assertFacetRecoveryIdle(client);
    const map = Object.fromEntries(
      (
        await client.query('SELECT alias,canonical FROM facet_aliases WHERE category=$1', [category])
      ).rows.map((r) => [r.alias, r.canonical]),
    );
    const selected = [...new Set(aliases)];
    if (selected.some((alias) => !Object.hasOwn(map, alias) || resolveFacet(alias, map) !== canonical))
      throw Error('Die Zuordnung wurde inzwischen geändert. Bitte Seite neu laden.');
    await assertOriginalsKnown(client, category, [canonical]);
    for (const alias of selected)
      await client.query('INSERT INTO facet_terms(category,value) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        category,
        alias,
      ]);
    await client.query('DELETE FROM facet_aliases WHERE category=$1 AND alias=ANY($2::text[])', [
      category,
      selected,
    ]);
    const affected = await reprojectFacets(client, category);
    await client.query('COMMIT');
    return { affected, aliases: selected.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

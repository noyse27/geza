import { pool, query } from './db';
import { normalizeCountryToken } from './countries';
import { normalizeGenreToken } from './genres';

export type FacetCategory = 'country' | 'genre';
export const facetColumn: Record<FacetCategory, 'countries' | 'genres'> = {
  country: 'countries',
  genre: 'genres',
};
const staticNormalize: Record<FacetCategory, (raw: string) => string> = {
  country: normalizeCountryToken,
  genre: normalizeGenreToken,
};

async function aliasMap(category: FacetCategory): Promise<Record<string, string>> {
  const rows = await query<{ alias: string; canonical: string }>(
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

// Wendet erst die statische Normalisierung (ISO-Codes/EN-DE-Dubletten) und dann die im
// Adminbereich manuell festgelegten Zusammenführungen an; entfernt danach Dubletten im Array.
export async function normalizeFacetArray(
  category: FacetCategory,
  raw: string[] | null | undefined,
): Promise<string[] | undefined> {
  if (!raw) return raw ?? undefined;
  const aliases = await aliasMap(category);
  const normalize = staticNormalize[category];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = resolveFacet(normalize(item), aliases);
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
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
  const target = staticNormalize[category](canonical);
  const sources = [
    ...new Set(aliases.flatMap((a) => [a.trim(), staticNormalize[category](a)]).filter(Boolean)),
  ].filter((a) => a !== target);
  if (!target || !sources.length) return { affected: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    const map = Object.fromEntries(
      (
        await client.query('SELECT alias,canonical FROM facet_aliases WHERE category=$1', [category])
      ).rows.map((r) => [r.alias, r.canonical]),
    );
    if (Object.hasOwn(map, target) || sources.some((source) => Object.hasOwn(map, source)))
      throw Error('Die Auswahl wurde inzwischen zugeordnet. Bitte Seite neu laden.');
    for (const alias of Object.keys(map)) {
      if (sources.includes(resolveFacet(alias, map))) sources.push(alias);
    }
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
    const { rowCount } = await client.query(
      `UPDATE media SET ${column} = (
         SELECT array_agg(DISTINCT CASE WHEN v = ANY($1::text[]) THEN $2::text ELSE v END
                           ORDER BY CASE WHEN v = ANY($1::text[]) THEN $2::text ELSE v END)
         FROM unnest(${column}) AS v
       ) WHERE ${column} && $1::text[]`,
      [sources, target],
    );
    await client.query('COMMIT');
    return { affected: rowCount || 0 };
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
    const map = Object.fromEntries(
      (
        await client.query('SELECT alias,canonical FROM facet_aliases WHERE category=$1', [category])
      ).rows.map((r) => [r.alias, r.canonical]),
    );
    const selected = [...new Set(aliases)];
    if (selected.some((alias) => !Object.hasOwn(map, alias) || resolveFacet(alias, map) !== canonical))
      throw Error('Die Zuordnung wurde inzwischen geändert. Bitte Seite neu laden.');
    // Flatten old chains first: detaching one alias must not detach its children.
    for (const alias of Object.keys(map))
      await client.query('UPDATE facet_aliases SET canonical=$3 WHERE category=$1 AND alias=$2', [
        category,
        alias,
        resolveFacet(alias, map),
      ]);
    for (const alias of selected)
      await client.query('INSERT INTO facet_terms(category,value) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        category,
        alias,
      ]);
    await client.query('DELETE FROM facet_aliases WHERE category=$1 AND alias=ANY($2::text[])', [
      category,
      selected,
    ]);
    await client.query('COMMIT');
    return { affected: selected.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

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

let cache: { category: FacetCategory; map: Record<string, string>; expires: number } | null = null;
async function aliasMap(category: FacetCategory): Promise<Record<string, string>> {
  if (cache && cache.category === category && cache.expires > Date.now()) return cache.map;
  const rows = await query<{ alias: string; canonical: string }>(
    'SELECT alias,canonical FROM facet_aliases WHERE category=$1',
    [category],
  );
  const map = Object.fromEntries(rows.map((r) => [r.alias, r.canonical]));
  cache = { category, map, expires: Date.now() + 60000 };
  return map;
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
    const value = aliases[normalize(item)] || normalize(item);
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
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
    cache = null;
    return { affected: rowCount || 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

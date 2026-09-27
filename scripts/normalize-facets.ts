import { query, pool } from '../src/lib/db';
import { normalizeFacetArray, facetColumn, type FacetCategory } from '../src/lib/facets';
for (const category of ['country', 'genre'] as FacetCategory[]) {
  const column = facetColumn[category];
  const rows = await query<{ id: string; values: string[] }>(
    `SELECT id,${column} AS values FROM media WHERE array_length(${column},1)>0`,
  );
  let changed = 0;
  const examples = new Set<string>();
  for (const row of rows) {
    const normalized = (await normalizeFacetArray(category, row.values)) || [];
    const same = normalized.length === row.values.length && normalized.every((v, i) => v === row.values[i]);
    if (same) continue;
    await query(`UPDATE media SET ${column}=$2 WHERE id=$1`, [row.id, normalized]);
    changed++;
    for (const v of row.values) {
      const [mapped] = (await normalizeFacetArray(category, [v])) || [];
      if (mapped && mapped !== v) examples.add(`${v} → ${mapped}`);
    }
  }
  console.log(
    `${category === 'country' ? 'Länder' : 'Genres'}: ${rows.length} Titel geprüft, ${changed} aktualisiert.`,
  );
  for (const e of [...examples].sort().slice(0, 40)) console.log(`  ${e}`);
  if (examples.size > 40) console.log(`  … und ${examples.size - 40} weitere Zuordnungen.`);
}
await pool.end();

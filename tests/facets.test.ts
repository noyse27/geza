import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

test('facet mappings persist, flatten, import and detach without changing existing titles', async () => {
  assert.ok(
    process.env.DATABASE_URL,
    'DATABASE_URL required; creates and removes an isolated test database.',
  );
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const database = `geza_facets_test_${Date.now()}`;
  let testPool: pg.Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.toString();
    const { pool } = await import('../src/lib/db');
    testPool = pool;
    const {
      mergeFacetAlias,
      unmergeFacetAliases,
      normalizeFacetArray,
      facetManagerItems,
      releaseFacetTarget,
    } = await import('../src/lib/facets');
    await pool.query('CREATE TABLE media(id serial PRIMARY KEY, countries text[], genres text[])');
    await pool.query(await readFile('migrations/024_facet_aliases.sql', 'utf8'));
    await pool.query(await readFile('migrations/026_facet_terms.sql', 'utf8'));
    await pool.query(
      "INSERT INTO media(genres,countries) VALUES(ARRAY['Test A','Test B'],ARRAY['US']), (ARRAY['Test B'],ARRAY['DE']), (ARRAY['Test Z'],ARRAY['GB'])",
    );
    assert.equal((await mergeFacetAlias('genre', ['Test A', 'Test B'], 'Test Z')).affected, 2);
    assert.deepEqual(await normalizeFacetArray('genre', ['Test A', 'Test B', 'Test Z']), ['Test Z']);
    let items = await facetManagerItems('genre');
    assert.equal(items.length, 1);
    assert.equal(items[0].isTarget, true);
    assert.equal(items[0].count, 3);
    assert.deepEqual(items[0].aliases.sort(), ['Test A', 'Test B']);
    await assert.rejects(releaseFacetTarget('genre', 'Test Z'), /noch Aliase/);
    await assert.rejects(releaseFacetTarget('genre', 'Test A'), /zugeordnet/);
    await mergeFacetAlias('genre', ['Test Z'], 'Test Final');
    assert.deepEqual(await normalizeFacetArray('genre', ['Test A', 'Test B', 'Test Z']), ['Test Final']);
    await assert.rejects(mergeFacetAlias('genre', ['Test Final'], 'Test A'), /inzwischen/);
    await assert.rejects(unmergeFacetAliases('genre', ['Test A'], 'Wrong'), /inzwischen/);
    await unmergeFacetAliases('genre', ['Test A'], 'Test Final');
    assert.deepEqual(await normalizeFacetArray('genre', ['Test A', 'Test B']), ['Test A', 'Test Final']);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM media WHERE genres=ARRAY['Test Final']")).rows[0].n,
      3,
    );
    items = await facetManagerItems('genre');
    assert.equal(items.find((i) => i.value === 'Test A')?.isTarget, false);
    assert.equal(items.find((i) => i.value === 'Test A')?.count, 0);
    await unmergeFacetAliases('genre', ['Test B', 'Test Z'], 'Test Final');
    items = await facetManagerItems('genre');
    assert.equal(items.find((i) => i.value === 'Test Final')?.isTarget, true);
    assert.equal(items.find((i) => i.value === 'Test Z')?.isTarget, true);
    await releaseFacetTarget('genre', 'Test Final');
    assert.equal((await facetManagerItems('genre')).find((i) => i.value === 'Test Final')?.isTarget, false);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM media WHERE genres=ARRAY['Test Final']")).rows[0].n,
      3,
    );
    await assert.rejects(releaseFacetTarget('genre', 'Test Final'), /kein gespeichertes Ziel/);
    await releaseFacetTarget('genre', 'Test Z');
    assert.equal((await facetManagerItems('genre')).find((i) => i.value === 'Test Z')?.count, 0);
    await mergeFacetAlias('genre', ['Test Final'], 'Test New Target');
    assert.deepEqual(await normalizeFacetArray('genre', ['Test Final']), ['Test New Target']);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM media WHERE genres=ARRAY['Test New Target']")).rows[0]
        .n,
      3,
    );
    await mergeFacetAlias('country', ['US'], 'DE');
    assert.deepEqual(await normalizeFacetArray('country', ['USA', 'United States', 'DE']), ['DE']);
    await unmergeFacetAliases('country', ['US'], 'DE');
    assert.deepEqual(await normalizeFacetArray('country', ['USA', 'DE']), ['US', 'DE']);
    assert.deepEqual(await normalizeFacetArray('genre', ['Comedy']), ['Komödie']);
    // A human-readable existing target must not be replaced by its built-in ISO alias.
    await pool.query(
      "INSERT INTO facet_aliases VALUES('country','GB','Vereinigtes Königreich',now()),('country','United Kingdom','Vereinigtes Königreich',now())",
    );
    await pool.query("INSERT INTO media(countries) VALUES(ARRAY['gbr'])");
    assert.equal((await mergeFacetAlias('country', ['gbr'], 'Vereinigtes Königreich')).affected, 1);
    assert.deepEqual(
      await normalizeFacetArray('country', ['gbr', 'GB', 'United Kingdom', 'Vereinigtes Königreich']),
      ['Vereinigtes Königreich'],
    );
    assert.equal(
      (await facetManagerItems('country'))
        .find((i) => i.value === 'Vereinigtes Königreich')
        ?.aliases.includes('gbr'),
      true,
    );
    await unmergeFacetAliases('country', ['gbr'], 'Vereinigtes Königreich');
    assert.deepEqual(await normalizeFacetArray('country', ['gbr', 'GB']), ['gbr', 'Vereinigtes Königreich']);
    // Exact selected sources must not silently redirect another normalized term.
    await mergeFacetAlias('country', ['United States'], 'Eigener Länderbegriff');
    assert.deepEqual(await normalizeFacetArray('country', ['United States', 'US', 'Eigener Länderbegriff']), [
      'Eigener Länderbegriff',
      'US',
    ]);
    // Existing chained mappings resolve and detaching a parent leaves its children at the old target.
    await pool.query(
      "INSERT INTO facet_aliases VALUES('genre','Legacy A','Legacy B',now()),('genre','Legacy B','Legacy C',now())",
    );
    assert.deepEqual(await normalizeFacetArray('genre', ['Legacy A']), ['Legacy C']);
    await unmergeFacetAliases('genre', ['Legacy B'], 'Legacy C');
    assert.deepEqual(await normalizeFacetArray('genre', ['Legacy A', 'Legacy B']), ['Legacy C', 'Legacy B']);
  } finally {
    if (testPool) await testPool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.end();
  }
});

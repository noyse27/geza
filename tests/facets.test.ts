import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

test('reversible facets and resumable one-time recovery preserve raw country and genre provenance', async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL required; creates an isolated test database.');
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
    const { processFacetRecovery, resumeFacetRecovery, plexRecoveryValues } =
      await import('../src/lib/facet-recovery');
    assert.deepEqual(
      plexRecoveryValues([
        {
          Country: [{ id: 1, tag: 'Italy' }],
          Genre: [
            { id: 2, tag: 'Drama' },
            { id: 3, tag: 'Crime' },
          ],
        },
        {
          Country: [{ id: 99, tag: 'Italy' }],
          Genre: [
            { id: 55, tag: 'Crime' },
            { id: 77, tag: 'Drama' },
          ],
        },
      ]),
      { countries: ['Italy'], genres: ['Drama', 'Crime'] },
    );
    assert.deepEqual(
      plexRecoveryValues([
        { Country: [{ tag: 'Italy' }], Genre: [{ tag: 'Drama' }] },
        { Country: [{ tag: 'USSR' }], Genre: [{ tag: 'Drama' }] },
      ]),
      { genres: ['Drama'] },
    );
    assert.deepEqual(plexRecoveryValues([{ Country: [{ tag: 'Italy' }] }, {}]), { countries: ['Italy'] });
    const { mergeMetadata } = await import('../src/lib/providers');
    await pool.query(`CREATE TABLE media(id bigserial PRIMARY KEY,kind text DEFAULT 'movie',title text DEFAULT 'Test',ids jsonb DEFAULT '{}',
      countries text[] NOT NULL DEFAULT '{}',genres text[] NOT NULL DEFAULT '{}',locked_fields text[] DEFAULT '{}',field_sources jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now());
      CREATE TABLE jobs(id bigserial PRIMARY KEY,kind text,dedupe_key text UNIQUE,payload jsonb DEFAULT '{}',status text DEFAULT 'pending',attempts int DEFAULT 0,available_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),error text)`);
    for (const file of ['024_facet_aliases.sql', '026_facet_terms.sql'])
      await pool.query(await readFile(`migrations/${file}`, 'utf8'));
    await pool.query(
      `INSERT INTO media(title,countries,genres) VALUES('The Hanging Sun',ARRAY['SU'],ARRAY['Drama']),('Soviet film',ARRAY['SU'],ARRAY['Drama']),('Missing source',ARRAY['Unknown'],ARRAY[]::text[])`,
    );
    await pool.query(await readFile('migrations/027_reversible_facets.sql', 'utf8'));
    const job = (await pool.query("SELECT * FROM jobs WHERE dedupe_key='facet-recovery-v1'")).rows[0];
    assert.equal(job.payload.total, 3);
    await assert.rejects(mergeFacetAlias('country', ['SU'], 'Sowjetunion'), /gerade wiederhergestellt/);
    // Existing rules are reapplied after recovering the sources.
    await pool.query(
      "INSERT INTO facet_aliases VALUES('country','IT','Italien',now()),('country','SUHH','Sowjetunion',now())",
    );
    const seen: string[] = [];
    await processFacetRecovery(String(job.id), async (media) => {
      seen.push(media.title);
      return media.title === 'Missing source'
        ? null
        : {
            countries: [media.title === 'The Hanging Sun' ? 'Italy' : 'USSR'],
            genres: ['Drama'],
            source: 'plex',
          };
    });
    assert.equal(seen.length, 3);
    let rows = (await pool.query('SELECT * FROM media ORDER BY id')).rows;
    assert.deepEqual(rows[0].original_countries, ['Italy']);
    assert.deepEqual(rows[0].countries, ['Italien']);
    assert.deepEqual(rows[1].countries, ['Sowjetunion']);
    assert.equal(rows[2].original_countries, null);
    assert.deepEqual(rows[2].countries, ['Unknown']);
    assert.ok(rows[2].facet_recovery_note);
    assert.equal(
      (await pool.query('SELECT payload FROM jobs WHERE id=$1', [job.id])).rows[0].payload.unresolved,
      1,
    );
    await processFacetRecovery(String(job.id), async () => {
      throw Error('completed job must not run again');
    });
    await assert.rejects(mergeFacetAlias('country', ['Unknown'], 'Other'), /Originalwerte/);
    // Detaching IT restores only Italy-derived titles, not genuine Soviet titles.
    await unmergeFacetAliases('country', ['IT'], 'Italien');
    rows = (await pool.query('SELECT * FROM media ORDER BY id')).rows;
    assert.deepEqual(rows[0].countries, ['IT']);
    assert.deepEqual(rows[1].countries, ['Sowjetunion']);
    await mergeFacetAlias('country', ['IT'], 'Sowjetunion');
    assert.deepEqual((await pool.query('SELECT countries FROM media WHERE id=1')).rows[0].countries, [
      'Sowjetunion',
    ]);
    await unmergeFacetAliases('country', ['IT'], 'Sowjetunion');
    assert.deepEqual((await pool.query('SELECT countries FROM media WHERE id=1')).rows[0].countries, ['IT']);
    assert.deepEqual(
      (await pool.query('SELECT original_countries FROM media WHERE id=1')).rows[0].original_countries,
      ['Italy'],
    );
    // Same-provider refresh updates raw values; unrelated normalizations do not mutate caller input.
    const incoming = { countries: ['Italy', 'France'], genres: ['Drama', 'Comedy'] };
    await mergeMetadata('1', incoming, 'plex');
    assert.deepEqual(incoming.countries, ['Italy', 'France']);
    assert.deepEqual(
      (await pool.query('SELECT original_countries FROM media WHERE id=1')).rows[0].original_countries,
      ['Italy', 'France'],
    );
    await mergeFacetAlias('country', ['IT', 'FR'], 'Europe');
    assert.deepEqual((await pool.query('SELECT countries FROM media WHERE id=1')).rows[0].countries, [
      'Europe',
    ]);
    await unmergeFacetAliases('country', ['IT'], 'Europe');
    assert.deepEqual((await pool.query('SELECT countries FROM media WHERE id=1')).rows[0].countries, [
      'IT',
      'Europe',
    ]);
    await unmergeFacetAliases('country', ['FR'], 'Europe');
    assert.deepEqual((await pool.query('SELECT countries FROM media WHERE id=1')).rows[0].countries, [
      'IT',
      'FR',
    ]);
    await releaseFacetTarget('country', 'Europe');
    assert.equal((await facetManagerItems('country')).find((i) => i.value === 'Europe')?.isTarget, false);
    // Preserve mapping edges as well as original values across a merge of an existing target.
    await pool.query(
      "INSERT INTO media(genres) VALUES(ARRAY['Test A','Test B']), (ARRAY['Test B']), (ARRAY['Test Z'])",
    );
    await mergeFacetAlias('genre', ['Test A', 'Test B'], 'Test Z');
    await mergeFacetAlias('genre', ['Test Z'], 'Test Final');
    await assert.rejects(releaseFacetTarget('genre', 'Test Final'), /noch Aliase/);
    await assert.rejects(mergeFacetAlias('genre', ['Test Final'], 'Test A'), /inzwischen/);
    await unmergeFacetAliases('genre', ['Test Z'], 'Test Final');
    assert.deepEqual(await normalizeFacetArray('genre', ['Test A', 'Test B']), ['Test Z']);
    await unmergeFacetAliases('genre', ['Test A'], 'Test Z');
    assert.deepEqual(
      (await pool.query("SELECT genres FROM media WHERE original_genres=ARRAY['Test A','Test B']")).rows[0]
        .genres,
      ['Test A', 'Test Z'],
    );
    // Checkpoint resume: don't re-fetch titles whose originals were already saved.
    await pool.query(
      "UPDATE jobs SET status='pending',payload=jsonb_build_object('cursor','2','upperBound','3','total',3,'checked',2,'phase','sources') WHERE id=$1",
      [job.id],
    );
    let calls = 0;
    await pool.query("UPDATE jobs SET status='running' WHERE id=$1", [job.id]);
    await resumeFacetRecovery();
    assert.equal(
      (await pool.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0].status,
      'pending',
    );
    await processFacetRecovery(String(job.id), async (m) => {
      calls++;
      assert.equal(String(m.id), '3');
      return { countries: ['Canada'], source: 'plex' };
    });
    assert.equal(calls, 1);
    assert.deepEqual((await pool.query('SELECT countries FROM media WHERE id=3')).rows[0].countries, ['CA']);
    assert.equal(
      (await pool.query('SELECT payload FROM jobs WHERE id=$1', [job.id])).rows[0].payload.unresolved,
      0,
    );
    // Explicit display names stay valid targets even when their ISO form is already an alias.
    await pool.query("INSERT INTO facet_aliases VALUES('country','GB','Vereinigtes Königreich',now())");
    await pool.query("INSERT INTO media(countries) VALUES(ARRAY['gbr'])");
    await mergeFacetAlias('country', ['gbr'], 'Vereinigtes Königreich');
    assert.deepEqual(await normalizeFacetArray('country', ['gbr', 'GB', 'Vereinigtes Königreich']), [
      'Vereinigtes Königreich',
    ]);
    await unmergeFacetAliases('country', ['gbr'], 'Vereinigtes Königreich');
    assert.equal((await facetManagerItems('country')).find((i) => i.value === 'gbr')?.count, 1);
  } finally {
    if (testPool) await testPool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.end();
  }
});

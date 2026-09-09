import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/lib/db';
import { collectionGroups, collectionItems } from '../src/lib/collections';
import { collectionHref, isCollectionCategory } from '../src/lib/collection-links';

after(() => pool.end());
test('collections filter exact values, deduplicate films, paginate, and preserve film-series order', async () => {
  const suffix = crypto.randomUUID();
  const genre = `Genre ${suffix}`;
  const ids: string[] = [];
  let seriesId: string | undefined;
  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO media(kind,title,year,genres,countries,certification,directors,actors)
      SELECT 'movie','Collection test ' || lpad(n::text,3,'0'),2025,ARRAY[$1,$1],ARRAY['Deutschland','Frankreich'],'FSK 12',ARRAY['Director ' || $1],ARRAY['Actor ' || $1]
      FROM generate_series(1,53) n RETURNING id`,
      [genre],
    );
    ids.push(...rows.map((row) => row.id));
    ids.push(
      (
        await query(
          `INSERT INTO media(kind,title,genres,certification) VALUES('show','Excluded series',ARRAY[$1],'FSK 12') RETURNING id`,
          [genre],
        )
      )[0].id,
    );
    const uncertifiedId = (
      await query(`INSERT INTO media(kind,title) VALUES('movie','Uncertified ' || $1) RETURNING id`, [suffix])
    )[0].id;
    ids.push(uncertifiedId);
    await query(
      "INSERT INTO watches(media_id,source,source_id,watched_at) VALUES($1,'test',$2,now()),($1,'test',$3,now())",
      [ids[0], suffix + 'a', suffix + 'b'],
    );
    await query("INSERT INTO ratings(media_id,rating,source,rated_at) VALUES($1,8,'test',now())", [ids[0]]);
    const groups = await collectionGroups('genre');
    assert.equal(groups.find((group) => group.value === genre)?.count, 53);
    assert.equal(
      (await collectionGroups('director')).find((group) => group.value === `Director ${genre}`)?.count,
      53,
    );
    const first = await collectionItems('genre', genre, new URLSearchParams());
    const second = await collectionItems('genre', genre, new URLSearchParams({ page: '1' }));
    assert.equal(first.items.length, 50);
    assert.equal(first.hasMore, true);
    assert.equal(second.items.length, 3);
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 53);
    assert.equal(first.items[0].rating, 8);
    for (const key of ['watched_at', 'watch_id', 'summary', 'locked_fields'])
      assert.ok(!(key in first.items[0]));
    assert.equal(
      (await collectionItems('genre', genre, new URLSearchParams({ q: 'test 053' }))).items[0].id,
      ids[52],
    );
    assert.equal((await collectionItems('genre', genre, new URLSearchParams({ q: '%' }))).items.length, 0);
    assert.equal((await collectionItems('genre', "' OR true --", new URLSearchParams())).items.length, 0);
    for (const [category, value] of [
      ['country', 'Deutschland'],
      ['country', 'Frankreich'],
      ['certification', 'FSK 12'],
      ['director', `Director ${genre}`],
      ['actor', `Actor ${genre}`],
      ['year', '2025'],
      ['rating', '8'],
    ] as const) {
      assert.ok(
        (
          await collectionItems(category, value, new URLSearchParams({ q: 'Collection test 001' }))
        ).items.some((item) => item.id === ids[0]),
      );
    }
    assert.equal(
      (await collectionItems('certification', 'FSK 16', new URLSearchParams({ q: 'Collection test' }))).items
        .length,
      0,
    );
    assert.ok(
      (await collectionItems('certification', 'none', new URLSearchParams({ q: 'Uncertified' }))).items.some(
        (item) => item.id === uncertifiedId,
      ),
    );
    assert.equal(
      (await collectionGroups('certification')).find((group) => group.value === 'none')?.label,
      'Keine Altersangabe',
    );
    assert.equal((await collectionItems('year', 'NaN', new URLSearchParams())).items.length, 0);
    assert.equal(
      (
        await collectionItems(
          'genre',
          genre,
          new URLSearchParams({ page: 'Infinity', sort: 'malicious sql' }),
        )
      ).page,
      0,
    );
    seriesId = (await query('INSERT INTO film_series(title) VALUES($1) RETURNING id', [suffix]))[0].id;
    await query('INSERT INTO film_series_members(series_id,media_id,position) VALUES($1,$2,2),($1,$3,1)', [
      seriesId,
      ids[0],
      ids[1],
    ]);
    assert.deepEqual(
      (await collectionItems('series', seriesId!, new URLSearchParams())).items.map((item) => item.id),
      [ids[1], ids[0]],
    );
    assert.equal((await collectionGroups('series')).find((group) => group.value === seriesId)?.count, 2);
    assert.equal(
      new URL(collectionHref('genre', 'Action & Abenteuer'), 'http://localhost').searchParams.get('value'),
      'Action & Abenteuer',
    );
    assert.equal(isCollectionCategory('toString'), false);
  } finally {
    if (seriesId) await query('DELETE FROM film_series WHERE id=$1', [seriesId]);
    await query('DELETE FROM watches WHERE media_id=ANY($1::bigint[])', [ids]);
    await query('DELETE FROM ratings WHERE media_id=ANY($1::bigint[])', [ids]);
    await query('DELETE FROM media WHERE id=ANY($1::bigint[])', [ids]);
  }
});

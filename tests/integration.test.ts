import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/lib/db';
import { searchCatalog, history } from '../src/lib/catalog';
import { mergeMetadata } from '../src/lib/providers';
import { processPlex } from '../src/lib/plex';
import { GET as sitemapIndex } from '../src/app/sitemap.xml/route';
import { GET as sitemapPage } from '../src/app/sitemaps/[page]/route';
test('ratings and published reviews are public; drafts and watch events remain private', async () => {
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const term = 'privateterm' + suffix,
    publicTerm = 'publicterm' + suffix;
  let id: string | undefined;
  try {
    id = (
      await query("INSERT INTO media(kind,title,year,ids) VALUES('movie',$1,2020,$2) RETURNING id", [
        'Test ' + suffix,
        JSON.stringify({ imdb: 'tt' + suffix }),
      ])
    )[0].id;
    await query("INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,8,now(),'test')", [id]);
    const review = (
      await query(
        "INSERT INTO reviews(media_id,source,source_id,body,is_public) VALUES($1,'test',$2,$3,false) RETURNING id",
        [id, suffix, term],
      )
    ).at(0)!;
    const p = new URLSearchParams({ q: term });
    assert.equal((await searchCatalog(p, false)).items.length, 0);
    const privateResult = await searchCatalog(p, true);
    assert.equal(privateResult.items[0].id, id);
    assert.equal(privateResult.items[0].rating, 8);
    await query('UPDATE reviews SET is_public=true,body=$1 WHERE id=$2', [publicTerm, review.id]);
    const pub = await searchCatalog(new URLSearchParams({ q: publicTerm }), false);
    assert.equal(pub.items[0].id, id);
    assert.equal(pub.items[0].rating, 8);
    for (const forbidden of ['watched_at', 'watch_count', 'last_watched_at'])
      assert.equal(forbidden in pub.items[0], false);
    await query('UPDATE reviews SET is_public=false WHERE id=$1', [review.id]);
    assert.equal((await searchCatalog(new URLSearchParams({ q: publicTerm }), false)).items.length, 0);
    for (let i = 0; i < 3; i++)
      await query(
        "INSERT INTO watches(media_id,source,source_id,watched_at) VALUES($1,'test',$2,'2199-01-01T12:00:00Z')",
        [id, suffix + i],
      );
    const first = await history(new URLSearchParams(), 2);
    assert.equal(first.items.length, 2);
    assert.ok(first.cursor);
    const second = await history(new URLSearchParams({ cursor: first.cursor! }), 2);
    assert.ok(!second.items.some((x) => first.items.some((y) => y.watch_id === x.watch_id)));
    await query("UPDATE media SET summary='My manual summary',locked_fields=ARRAY['summary'] WHERE id=$1", [
      id,
    ]);
    await mergeMetadata(id!, { summary: 'Provider summary', original_title: 'Provider original' }, 'tmdb');
    const edited = (await query('SELECT summary,original_title FROM media WHERE id=$1', [id]))[0];
    assert.equal(edited.summary, 'My manual summary');
    assert.equal(edited.original_title, 'Provider original');
    const previous = process.env.PUBLIC_URL;
    try {
      delete process.env.PUBLIC_URL;
      assert.equal((await sitemapIndex()).status, 404);
      process.env.PUBLIC_URL = 'https://geza.schwarzesherz.info:777';
      const index = await (await sitemapIndex()).text();
      assert.ok(index.includes('https://geza.schwarzesherz.info:777/sitemaps/0'));
      assert.ok(!index.includes('/history'));
      const xml = await (
        await sitemapPage(new Request('https://geza.schwarzesherz.info:777/sitemaps/0'), {
          params: Promise.resolve({ page: '0' }),
        })
      ).text();
      assert.ok(xml.includes('/title/'));
      assert.ok(!xml.includes('watched_at') && !xml.includes('rating'));
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = previous;
    }
    const receivedAt = new Date(Date.now() + 1000).toISOString();
    const metadata = {
      type: 'movie',
      title: 'Plex fixture',
      guid: `plex://movie/${suffix}`,
      Guid: [{ id: `imdb://tt${suffix}` }],
      lastViewedAt: Math.floor(Date.now() / 1000),
    };
    const event = { event: 'media.scrobble', metadata, receivedAt, eventId: 'test-' + suffix };
    await processPlex(event);
    await processPlex(event);
    assert.equal(
      Number(
        (await query("SELECT count(*) FROM watches WHERE media_id=$1 AND source='plex'", [id]))[0].count,
      ),
      1,
    );
    await processPlex({ ...event, eventId: 'repeat-' + suffix });
    assert.equal(
      Number(
        (await query("SELECT count(*) FROM watches WHERE media_id=$1 AND source='plex'", [id]))[0].count,
      ),
      2,
    );
    await processPlex({ ...event, event: 'media.rate', metadata: { ...metadata, userRating: 9 } });
    assert.equal((await query('SELECT rating FROM ratings WHERE media_id=$1', [id]))[0].rating, 9);
    await processPlex({ ...event, event: 'media.rate', metadata: { ...metadata, userRating: 0 } });
    assert.equal((await query('SELECT 1 FROM ratings WHERE media_id=$1', [id])).length, 0);
  } finally {
    if (id) {
      await query("DELETE FROM jobs WHERE payload->>'mediaId'=$1", [id]);
      await query('DELETE FROM reviews WHERE media_id=$1', [id]);
      await query('DELETE FROM ratings WHERE media_id=$1', [id]);
      await query('DELETE FROM watches WHERE media_id=$1', [id]);
      await query('DELETE FROM media WHERE id=$1', [id]);
    }
    await pool.end();
  }
});

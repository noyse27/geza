import { query } from './db';
import { cardColumns } from './catalog';
import type { Media } from './types';
import type { CollectionCategory } from './collection-links';

export async function collectionGroups(category: CollectionCategory) {
  if (category === 'series')
    return query<{ value: string; label: string; count: number }>(
      `SELECT fs.id::text AS value,fs.title AS label,count(*)::int AS count FROM film_series fs
     JOIN film_series_members fsm ON fsm.series_id=fs.id JOIN media m ON m.id=fsm.media_id
     WHERE m.kind='movie' GROUP BY fs.id ORDER BY fs.title,fs.id`,
    );
  const expressions = {
    genre: 'unnest(m.genres)',
    country: 'unnest(m.countries)',
    certification: 'm.certification',
    year: 'm.year::text',
    rating: 'r.rating::text',
  };
  return query<{ value: string; label: string; count: number }>(
    `SELECT value,value AS label,count(DISTINCT id)::int AS count FROM (
      SELECT m.id,${expressions[category]} AS value FROM media m
      ${category === 'rating' ? 'JOIN ratings r ON r.media_id=m.id' : ''} WHERE m.kind='movie'
    ) groups WHERE value IS NOT NULL AND trim(value)<>'' GROUP BY value
    ORDER BY ${category === 'year' || category === 'rating' ? 'value::integer DESC' : 'value'}`,
  );
}

export async function collectionItems(category: CollectionCategory, value: string, params: URLSearchParams) {
  const values: unknown[] = [value];
  const filters = ["m.kind='movie'"];
  const predicates = {
    genre: 'm.genres @> ARRAY[$1]::text[]',
    country: 'm.countries @> ARRAY[$1]::text[]',
    certification: 'm.certification=$1',
    year: 'm.year=$1::integer',
    rating: 'r.rating=$1::integer',
    series: 'fsm.series_id=$1::bigint',
  };
  if (['year', 'rating', 'series'].includes(category) && !/^\d{1,9}$/.test(value))
    return { items: [] as Media[], hasMore: false, page: 0 };
  filters.push(predicates[category]);
  const q = (params.get('q') || '').trim().slice(0, 160);
  if (q) {
    values.push('%' + q.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%');
    filters.push(`m.search_text LIKE $${values.length}`);
  }
  const sorts: Record<string, string> = {
    title: 'm.title,m.id',
    year: 'm.year DESC NULLS LAST,m.title,m.id',
    rating: 'r.rating DESC NULLS LAST,m.title,m.id',
    series: 'fsm.position,m.id',
  };
  const sort = params.get('sort') || (category === 'series' ? 'series' : 'title');
  const order =
    sort === 'series' && category !== 'series'
      ? sorts.title
      : Object.hasOwn(sorts, sort)
        ? sorts[sort]
        : sorts.title;
  const rawPage = Number(params.get('page'));
  const page = Number.isFinite(rawPage) ? Math.max(0, Math.min(10000, Math.floor(rawPage))) : 0;
  values.push(page * 50);
  const rows = await query<Media>(
    `SELECT ${cardColumns},m.certification,m.countries,r.rating FROM media m
    LEFT JOIN media p ON p.id=m.parent_id LEFT JOIN ratings r ON r.media_id=m.id
    ${category === 'series' ? 'JOIN film_series_members fsm ON fsm.media_id=m.id' : ''}
    WHERE ${filters.join(' AND ')} ORDER BY ${order} LIMIT 51 OFFSET $${values.length}`,
    values,
  );
  return { items: rows.slice(0, 50), hasMore: rows.length > 50, page };
}

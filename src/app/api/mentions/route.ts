import { query } from '@/lib/db';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');
  if (!['m', 'r', 'a'].includes(kind || ''))
    return Response.json({ error: 'Ungültiger Typ' }, { status: 400 });
  const person = params.get('person');
  const column = kind === 'r' ? 'directors' : 'actors';
  try {
    if (person !== null) {
      if (kind === 'm' || !person.trim() || person.length > 200) return Response.json([], { status: 400 });
      const rows = await query(
        `SELECT m.id::text AS id,m.title AS label,m.year,m.poster FROM media m LEFT JOIN ratings r ON r.media_id=m.id
         WHERE m.kind='movie' AND NOT m.rumpel AND m.${column} @> ARRAY[$1]::text[]
         ORDER BY r.rating DESC NULLS LAST,m.year DESC NULLS LAST,m.title,m.id LIMIT 5`,
        [person],
      );
      return Response.json(rows, { headers: { 'Cache-Control': 'public, max-age=60' } });
    }
    const q = (params.get('q') || '').trim();
    if (q.length < 2 || q.length > 80) return Response.json([]);
    const escaped = q.toLowerCase().replace(/[\\%_]/g, '\\$&');
    const rows =
      kind === 'm'
        ? await query(
            `SELECT id::text AS id,title AS label,year FROM media
          WHERE kind='movie' AND NOT rumpel AND (lower(title) LIKE $1 OR lower(original_title) LIKE $1)
          ORDER BY (lower(title)=$2) DESC,(lower(title) LIKE $3) DESC,title,year,id LIMIT 6`,
            [`%${escaped}%`, q.toLowerCase(), `${escaped}%`],
          )
        : await query(
            `SELECT name AS id,name AS label FROM media m CROSS JOIN LATERAL unnest(m.${column}) AS name
          WHERE m.kind='movie' AND NOT m.rumpel AND m.search_text LIKE $1 AND lower(name) LIKE $1
          GROUP BY name ORDER BY (lower(name)=$2) DESC,(lower(name) LIKE $3) DESC,name LIMIT 6`,
            [`%${escaped}%`, q.toLowerCase(), `${escaped}%`],
          );
    return Response.json(rows, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch {
    return Response.json({ error: 'Suche derzeit nicht verfügbar' }, { status: 503 });
  }
}

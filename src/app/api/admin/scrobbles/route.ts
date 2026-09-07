import { isAdmin, validOrigin } from '@/lib/auth';
import { query } from '@/lib/db';
import { openScrobbleWhere, saveScrobble } from '@/lib/scrobbles';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const headers = { 'Cache-Control': 'private, no-store' };
  if (p.get('mode') === 'inbox') {
    const items = await query(`SELECT id,error,payload->>'requestId' AS request_id,
      payload->'metadata'->>'title' AS title,payload->'metadata'->>'grandparentTitle' AS show_title,
      payload->'metadata'->>'parentIndex' AS season,payload->'metadata'->>'index' AS episode,
      payload->'metadata'->>'type' AS kind,payload->'metadata'->>'lastViewedAt' AS viewed_at,
      payload->>'receivedAt' AS received_at FROM jobs WHERE ${openScrobbleWhere} ORDER BY id DESC`);
    return Response.json({ items }, { headers });
  }
  const parent = p.get('parent');
  if (parent) {
    if (!/^[1-9]\d{0,17}$/.test(parent)) return Response.json({ error: 'Ungültige Serie' }, { status: 400 });
    const items = await query(
      `SELECT id,title,season,episode,kind FROM media WHERE parent_id=$1 AND kind='episode' ORDER BY season,episode,id`,
      [parent],
    );
    return Response.json({ items }, { headers });
  }
  const term = (p.get('q') || '').trim().slice(0, 160);
  if (term.length < 2) return Response.json({ items: [] }, { headers });
  const items = await query(
    `SELECT id,title,year,kind FROM media WHERE kind IN ('movie','show')
    AND (title ILIKE $1 OR original_title ILIKE $1) ORDER BY (lower(title)=lower($2)) DESC,title,year,id LIMIT 30`,
    ['%' + term.replace(/[\\%_]/g, '\\$&') + '%', term],
  );
  return Response.json({ items }, { headers });
}
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  if (!validOrigin(req)) return Response.json({ error: 'Ungültige Anfrage' }, { status: 403 });
  try {
    return Response.json(await saveScrobble(await req.json()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json(
      {
        error:
          message.startsWith('[') || (error as { code?: string }).code
            ? 'Bitte Titel, Datum und Uhrzeit prüfen.'
            : message || 'Speichern fehlgeschlagen.',
      },
      { status: 400 },
    );
  }
}

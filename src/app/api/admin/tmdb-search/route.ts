import { isAdmin } from '@/lib/auth';
import { searchTmdb } from '@/lib/providers';
export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') === 'show' ? 'show' : 'movie';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  const yearRaw = url.searchParams.get('year');
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined;
  if (!q) return Response.json({ results: [] });
  try {
    return Response.json(
      { results: await searchTmdb(kind, q, year) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'TMDB-Suche fehlgeschlagen.' },
      { status: 502 },
    );
  }
}

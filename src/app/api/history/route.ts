import { history, months } from '@/lib/catalog';
import { isAdmin } from '@/lib/auth';
export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  const p = new URL(req.url).searchParams;
  return Response.json(p.has('months') ? await months(p.get('type') || 'all') : await history(p), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

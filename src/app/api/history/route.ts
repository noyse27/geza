import { history, months } from '@/lib/catalog';
import { isAdmin } from '@/lib/auth';
export async function GET(req: Request) {
  const admin = await isAdmin();
  const p = new URL(req.url).searchParams;
  return Response.json(
    p.has('months') ? await months(p.get('type') || 'all', admin) : await history(p, admin),
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

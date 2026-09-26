import { query } from '@/lib/db';
import { friendForRequest } from '@/lib/federation';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const friend = await friendForRequest(req);
  if (!friend) return new Response(null, { status: 401 });
  await query('DELETE FROM friend_instances WHERE id=$1', [friend.id]);
  return Response.json({ ok: true });
}

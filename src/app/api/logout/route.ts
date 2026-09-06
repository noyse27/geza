import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { digest } from '@/lib/security';
import { validOrigin } from '@/lib/auth';
export async function POST(req: Request) {
  if (!validOrigin(req)) return new Response(null, { status: 403 });
  const c = await cookies();
  const token = c.get('geza_session')?.value;
  if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
  c.delete('geza_session');
  return Response.json({ ok: true });
}

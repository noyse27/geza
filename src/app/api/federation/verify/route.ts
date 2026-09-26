import { verifyNonce } from '@/lib/federation';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const ok = await verifyNonce(new URL(req.url).searchParams.get('nonce') || '');
  return ok ? Response.json({ ok: true }) : new Response(null, { status: 404 });
}

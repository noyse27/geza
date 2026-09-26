import { z } from 'zod';
import { federationEnabled, rateLimited, receiveAcceptance } from '@/lib/federation';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (!federationEnabled()) return new Response(null, { status: 404 });
  if (rateLimited('accept', 10)) return Response.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  try {
    const data = z
      .object({
        url: z.string().max(300),
        nickname: z.unknown(),
        nonce: z.string().max(100),
        secret: z.string().max(100),
      })
      .parse(await req.json());
    await receiveAcceptance(data);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Anfrage abgelehnt.' }, { status: 400 });
  }
}

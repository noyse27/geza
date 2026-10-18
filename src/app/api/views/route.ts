import { z } from 'zod';
import { isAdmin, validOrigin } from '@/lib/auth';
import { isAutomatedView, recordPublicView } from '@/lib/page-views';

export async function POST(request: Request) {
  if (!validOrigin(request)) return Response.json({ error: 'Ungültige Anfrage.' }, { status: 403 });
  if (await isAdmin()) return Response.json({ counted: false }, { headers: { 'Cache-Control': 'no-store' } });
  if (isAutomatedView(request))
    return Response.json({ counted: false }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const { mediaId } = z.object({ mediaId: z.string().regex(/^\d+$/) }).parse(await request.json());
    const views = await recordPublicView(request, mediaId);
    return Response.json({ counted: true, views }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof z.ZodError ? 'Ungültiger Titel.' : 'Aufruf konnte nicht erfasst werden.';
    return Response.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}

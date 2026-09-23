import { z } from 'zod';
import { demoBlocked, isDemo } from '@/lib/demo-mode';
import { isAdmin, validOrigin } from '@/lib/auth';
import { RumpelError, runRumpelAction } from '@/lib/rumpel';
const headers = { 'Cache-Control': 'no-store' };
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  if (!validOrigin(req)) return Response.json({ error: 'Ungültige Anfrage' }, { status: 403 });
  if (isDemo()) return demoBlocked();
  try {
    return Response.json(await runRumpelAction(await req.json()), { headers });
  } catch (e) {
    if (e instanceof RumpelError) return Response.json({ error: e.message }, { status: 409, headers });
    if (e instanceof z.ZodError) return Response.json({ error: 'Bitte Eingaben prüfen.' }, { status: 400, headers });
    console.error('Rumpelkammer-Aktion fehlgeschlagen:', e);
    return Response.json({ error: 'Aktion fehlgeschlagen.' }, { status: 500, headers });
  }
}

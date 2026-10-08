import { isAdmin, validOrigin } from '@/lib/auth';
import { isDemo } from '@/lib/demo-mode';
import { query } from '@/lib/db';
import { jobOverview } from '@/lib/job-overview';
import { requestPlexScan } from '@/lib/plex-jobs';
import { z } from 'zod';
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  return Response.json(await jobOverview(), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  if (!validOrigin(req)) return Response.json({ error: 'Ungültige Anfrage' }, { status: 403 });
  if (isDemo()) return Response.json({ error: 'In der Demo deaktiviert' }, { status: 403 });
  try {
    const { jobId } = z.object({ jobId: z.string().regex(/^[1-9]\d{0,17}$/) }).parse(await req.json());
    const [job] = await query('SELECT kind,status FROM jobs WHERE id=$1', [jobId]);
    if (!job) return Response.json({ error: 'Auftrag nicht gefunden' }, { status: 404 });
    if (job.kind === 'plex-scan') await requestPlexScan();
    else {
      const rows = await query(
        "UPDATE jobs SET status='pending',attempts=0,error=NULL,available_at=now() WHERE id=$1 AND status IN ('failed','done') RETURNING id",
        [jobId],
      );
      if (!rows.length)
        return Response.json({ error: 'Dieser Auftrag wartet bereits oder läuft.' }, { status: 409 });
    }
    return Response.json({ message: 'Neuer Versuch eingeplant. Das frühere Ergebnis bleibt erhalten.' });
  } catch {
    return Response.json({ error: 'Auftrag konnte nicht eingeplant werden.' }, { status: 400 });
  }
}

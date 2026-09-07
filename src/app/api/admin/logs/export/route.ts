import { isAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  const requestId = new URL(req.url).searchParams.get('requestId') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    return Response.json({ error: 'Gültige Anfrage-ID erforderlich' }, { status: 400 });
  // Export every retained entry, independent of the page's filters and pagination.
  const events = await query(
    `SELECT id,created_at,level,source,message,context FROM event_logs
     WHERE context->>'requestId'=$1 AND created_at >= now()-interval '14 days'
     ORDER BY id ASC`,
    [requestId],
  );
  if (!events.length) return Response.json({ error: 'Kein gespeicherter Verlauf gefunden' }, { status: 404 });
  return new Response(
    JSON.stringify(
      {
        format: 'geza-request-log',
        version: 1,
        exportedAt: new Date().toISOString(),
        requestId,
        retentionDays: 14,
        eventCount: events.length,
        events,
      },
      null,
      2,
    ),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="geza-request-${requestId}.json"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

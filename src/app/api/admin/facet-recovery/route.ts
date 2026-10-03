import { isAdmin, validOrigin } from '@/lib/auth';
import { isDemo, demoBlocked } from '@/lib/demo-mode';
import { pool, query } from '@/lib/db';

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  const [job] = await query("SELECT status,payload,error FROM jobs WHERE dedupe_key='facet-recovery-v1'");
  if (!job) return Response.json(null, { headers: { 'Cache-Control': 'no-store' } });
  const [count] = await query(
    `SELECT count(*)::int AS unresolved FROM media WHERE (original_countries IS NULL OR original_genres IS NULL) AND facet_recovery_note IS NOT NULL`,
  );
  const issues = await query(`SELECT id::text,title,facet_recovery_note AS note FROM media WHERE
    (original_countries IS NULL OR original_genres IS NULL) AND facet_recovery_note IS NOT NULL ORDER BY id LIMIT 20`);
  return Response.json(
    { ...job, unresolved: count.unresolved, issues },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  if (!validOrigin(request)) return Response.json({ error: 'Ungültige Anfrage' }, { status: 403 });
  if (isDemo()) return demoBlocked();
  const body = await request.json().catch(() => null);
  if (!['dismiss', 'retry', 'show'].includes(body?.action))
    return Response.json({ error: 'Ungültige Aktion' }, { status: 400 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    if (body.action === 'show') {
      await client.query(
        `UPDATE jobs SET payload=payload||'{"dismissed":false}'::jsonb WHERE dedupe_key='facet-recovery-v1'`,
      );
    } else if (body.action === 'dismiss') {
      await client.query(
        `UPDATE jobs SET payload=payload||'{"dismissed":true}'::jsonb WHERE dedupe_key='facet-recovery-v1' AND status IN ('done','failed')`,
      );
    } else {
      await client.query(`UPDATE jobs SET status='pending',attempts=0,error=NULL,available_at=now(),updated_at=now(),
        payload=jsonb_build_object('cursor','0','upperBound',(SELECT COALESCE(max(id),0)::text FROM media),
          'total',(SELECT count(*) FROM media WHERE original_countries IS NULL OR original_genres IS NULL),'checked',0,'phase','sources')
        WHERE dedupe_key='facet-recovery-v1' AND status IN ('done','failed')`);
    }
    await client.query('COMMIT');
    return Response.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

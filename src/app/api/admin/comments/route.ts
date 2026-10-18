import { z } from 'zod';
import { isAdmin, validOrigin } from '@/lib/auth';
import { pool, query } from '@/lib/db';
import { setSetting } from '@/lib/settings';

const statusSchema = z.enum(['pending', 'published', 'spam', 'rejected']);

export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich.' }, { status: 401 });
  if (!validOrigin(request)) return Response.json({ error: 'Ungültige Anfrage.' }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === 'settings') {
      const data = z.object({
        enabled: z.boolean(),
        comments: z.boolean(),
        reactions: z.boolean(),
        threshold: z.number().int().min(0).max(50),
      }).parse(body.data);
      await Promise.all([
        setSetting('COMMENTS_ENABLED', data.enabled ? '1' : '0'),
        setSetting('COMMENTS_TEXT_ENABLED', data.comments ? '1' : '0'),
        setSetting('COMMENTS_REACTIONS_ENABLED', data.reactions ? '1' : '0'),
        setSetting('COMMENTS_TRUST_THRESHOLD', String(data.threshold)),
      ]);
    } else if (body.action === 'status') {
      const id = z.string().regex(/^\d+$/).parse(String(body.id));
      const status = statusSchema.parse(body.status);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query<{ commenter_id: string; status: string }>(
          'SELECT commenter_id::text,status FROM review_comments WHERE id=$1 FOR UPDATE', [id],
        );
        if (!current.rowCount) throw Error('Kommentar nicht gefunden.');
        const previous = current.rows[0];
        await client.query(
          `UPDATE review_comments SET status=$2,updated_at=now(),
           published_at=CASE WHEN $2='published' THEN COALESCE(published_at,now()) ELSE NULL END WHERE id=$1`,
          [id, status],
        );
        const delta = (status === 'published' ? 1 : 0) - (previous.status === 'published' ? 1 : 0);
        if (delta)
          await client.query(
            'UPDATE review_commenters SET approved_count=GREATEST(0,approved_count+$2),updated_at=now() WHERE id=$1',
            [previous.commenter_id, delta],
          );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else if (body.action === 'block') {
      const commenterId = z.string().regex(/^\d+$/).parse(String(body.commenterId));
      const blocked = z.boolean().parse(body.blocked);
      await query('UPDATE review_commenters SET blocked=$2,updated_at=now() WHERE id=$1', [commenterId, blocked]);
    } else if (body.action === 'delete') {
      const id = z.string().regex(/^\d+$/).parse(String(body.id));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const deleted = await client.query<{ commenter_id: string; status: string }>(
          'DELETE FROM review_comments WHERE id=$1 RETURNING commenter_id::text,status', [id],
        );
        if (deleted.rows[0]?.status === 'published')
          await client.query(
            'UPDATE review_commenters SET approved_count=GREATEST(0,approved_count-1),updated_at=now() WHERE id=$1',
            [deleted.rows[0].commenter_id],
          );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      return Response.json({ error: 'Unbekannte Aktion.' }, { status: 400 });
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof z.ZodError ? 'Ungültige Eingabe.' : (error as Error).message;
    return Response.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}

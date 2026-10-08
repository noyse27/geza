import { isAdmin, validOrigin } from '@/lib/auth';
import { isDemo } from '@/lib/demo-mode';
import { pool } from '@/lib/db';
import { z } from 'zod';
const schema = z.object({
  mediaId: z.string().regex(/^[1-9]\d{0,17}$/),
  expected: z.record(z.string(), z.union([z.string(), z.number()])),
  ids: z.object({
    imdb: z.string().regex(/^(tt\d+)?$/),
    tmdb: z.string().regex(/^([1-9]\d*)?$/),
    tvdb: z.string().regex(/^([1-9]\d*)?$/),
    plex: z.string().regex(/^([a-f\d]{24})?$/),
  }),
});
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  if (!validOrigin(req) || isDemo())
    return Response.json({ error: 'Aktion nicht verfügbar' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: 'Bitte gültige Anbieter-IDs eingeben.' }, { status: 400 });
  const { mediaId, expected, ids } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    const [current] = (
      await client.query('SELECT ids FROM media WHERE id=$1 AND ids=$2::jsonb FOR UPDATE', [
        mediaId,
        JSON.stringify(expected),
      ])
    ).rows;
    if (!current) {
      await client.query('ROLLBACK');
      return Response.json(
        { error: 'Die IDs wurden inzwischen geändert. Bitte die Seite aktualisieren und erneut prüfen.' },
        { status: 409 },
      );
    }
    const merged = { ...current.ids };
    const changed: string[] = [];
    for (const [key, value] of Object.entries(ids)) {
      if (String(merged[key] ?? '') !== value) changed.push(key);
      if (value) merged[key] = value;
      else delete merged[key];
    }
    await client.query('UPDATE media SET ids=$2,updated_at=now() WHERE id=$1', [
      mediaId,
      JSON.stringify(merged),
    ]);
    await client.query('DELETE FROM provider_ratings WHERE media_id=$1 AND provider=ANY($2::text[])', [
      mediaId,
      changed,
    ]);
    await client.query(
      "INSERT INTO event_logs(level,source,message,context) VALUES('info','admin','Anbieter-IDs manuell korrigiert',$1)",
      [JSON.stringify({ mediaId, before: expected, after: merged })],
    );
    await client.query('COMMIT');
    return Response.json({
      message: 'IDs gespeichert. Den betroffenen Auftrag jetzt erneut prüfen.',
      ids: merged,
    });
  } catch {
    await client.query('ROLLBACK');
    return Response.json({ error: 'IDs konnten nicht gespeichert werden.' }, { status: 500 });
  } finally {
    client.release();
  }
}

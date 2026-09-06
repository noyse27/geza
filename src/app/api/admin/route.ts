import { isAdmin, validOrigin } from '@/lib/auth';
import { query } from '@/lib/db';
import { setSetting, settingKeys } from '@/lib/settings';
import { z } from 'zod';
const mediaSchema = z.object({
  title: z.string().min(1).max(500),
  original_title: z.string().max(500),
  year: z.number().int().min(1800).max(2200).nullable(),
  summary: z.string().max(20000),
  countries: z.array(z.string().max(100)).max(30),
  genres: z.array(z.string().max(100)).max(30),
  directors: z.array(z.string().max(200)).max(100),
  actors: z.array(z.string().max(200)).max(10),
  certification: z.string().max(40).nullable(),
  runtime: z.number().int().min(0).max(10000).nullable(),
});
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  if (!validOrigin(req)) return Response.json({ error: 'Ungültige Anfrage' }, { status: 403 });
  try {
    const body = await req.json();
    if (body.action === 'media') {
      const data = mediaSchema.parse(body.data),
        fields = Object.keys(data);
      const values = Object.values(data);
      await query(
        `UPDATE media SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(',')},locked_fields=$${values.length + 1},updated_at=now() WHERE id=$${values.length + 2}`,
        [...values, fields, body.id],
      );
    } else if (body.action === 'review') {
      const data = z
        .object({ body: z.string().min(1).max(30000), spoiler: z.boolean(), is_public: z.boolean() })
        .parse(body.data);
      if (body.id)
        await query('UPDATE reviews SET body=$1,spoiler=$2,is_public=$3,updated_at=now() WHERE id=$4', [
          data.body,
          data.spoiler,
          data.is_public,
          body.id,
        ]);
      else
        await query(
          "INSERT INTO reviews(media_id,source,source_id,body,spoiler,is_public) VALUES($1,'geza',$2,$3,$4,$5)",
          [body.mediaId, crypto.randomUUID(), data.body, data.spoiler, data.is_public],
        );
    } else if (body.action === 'rating') {
      const rating = z.number().int().min(1).max(10).nullable().parse(body.rating);
      if (rating === null) await query('DELETE FROM ratings WHERE media_id=$1', [body.id]);
      else
        await query(
          "INSERT INTO ratings(media_id,rating,rated_at,source) VALUES($1,$2,now(),'geza') ON CONFLICT(media_id) DO UPDATE SET rating=excluded.rating,rated_at=now(),source='geza'",
          [body.id, rating],
        );
    } else if (body.action === 'settings') {
      for (const key of settingKeys)
        if (typeof body.data?.[key] === 'string' && body.data[key].trim())
          await setSetting(key, body.data[key].trim());
    } else if (body.action === 'enrich') {
      await query(
        `INSERT INTO jobs(kind,dedupe_key,payload) SELECT 'enrich','enrich:'||id,jsonb_build_object('mediaId',id) FROM media WHERE kind IN ('movie','show','episode') AND enriched_at IS NULL ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',attempts=0,available_at=now(),error=NULL WHERE jobs.status='failed'`,
      );
    } else if (body.action === 'retry') {
      await query(
        "UPDATE jobs SET status='pending',attempts=0,available_at=now(),error=NULL WHERE status='failed'",
      );
    } else return Response.json({ error: 'Unbekannte Aktion' }, { status: 400 });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json(
      { error: e instanceof z.ZodError ? 'Bitte Eingaben prüfen.' : 'Speichern fehlgeschlagen.' },
      { status: 400 },
    );
  }
}

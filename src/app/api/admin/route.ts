import { isAdmin, validOrigin } from '@/lib/auth';
import { query } from '@/lib/db';
import { setSetting, settingKeys } from '@/lib/settings';
import { z } from 'zod';
import { reviewModule } from '@/lib/review-modules';
import { friendUrl } from '@/lib/friend-reviews';
import { fetchPlexReview } from '@/lib/plex';
import { randomBytes } from 'node:crypto';
import { correctAssignment } from '@/lib/assignment';
import { deleteMedia } from '@/lib/delete-media';
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
    if (body.action === 'delete-media') {
      const result = await deleteMedia(body.data);
      return Response.json(result, {
        status: result.error ? 400 : 200,
        headers: { 'Cache-Control': 'no-store' },
      });
    } else if (body.action === 'assignment') {
      if (!(await correctAssignment(body.data)))
        return Response.json(
          { error: 'Bitte eine vorhandene Serie und gültige Staffel/Episode auswählen.' },
          { status: 400 },
        );
    } else if (body.action === 'review-box-delete') {
      const provider = z.string().min(1).max(100).parse(body.data?.provider);
      await query('DELETE FROM review_boxes WHERE provider=$1', [provider]);
    } else if (body.action === 'review-box-edit') {
      const provider = z.string().min(1).max(100).parse(body.data?.provider);
      if (reviewModule(provider)) throw Error('Name und Skala sind durch das Plugin vorgegeben');
      const name = z.string().trim().min(1).max(100).parse(body.data?.name);
      const scale = z.number().int().min(1).max(100).parse(body.data?.scale);
      const updated = await query('UPDATE review_boxes SET name=$2,scale=$3 WHERE provider=$1 RETURNING provider', [
        provider,
        name,
        scale,
      ]);
      if (!updated.length) throw Error('Unbekannter Anbieter');
    } else if (body.action === 'review-box-add') {
      const provider = z.string().min(1).max(100).parse(body.data?.provider);
      const module = reviewModule(provider);
      if (module) {
        await query('INSERT INTO review_boxes(provider,name,scale) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
          provider,
          module.name,
          module.scale,
        ]);
      } else {
        if (!/^custom-[a-z0-9-]{1,50}$/.test(provider)) throw Error('Unbekanntes Plugin');
        const name = z.string().trim().min(1).max(100).parse(body.data?.name);
        const scale = z.number().int().min(1).max(100).parse(body.data?.scale);
        await query('INSERT INTO review_boxes(provider,name,scale) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
          provider,
          name,
          scale,
        ]);
      }
    } else if (body.action === 'friend-review') {
      const data = z
        .object({
          provider: z.string().min(1).max(100),
          url: z.string().max(2000),
          rating: z.number().min(0).max(100).nullable(),
        })
        .parse(body.data);
      const [box] = await query('SELECT * FROM review_boxes WHERE provider=$1', [data.provider]);
      if (!box || (data.rating !== null && data.rating > Number(box.scale)))
        throw Error('Ungültige Reviewbox');
      const url = friendUrl(data.provider, data.url);
      await query(
        `INSERT INTO friend_reviews(media_id,provider,url,rating,name,scale,manual,status,checked_at)
        SELECT $1,provider,$3,$4,name,scale,true,'manual',now() FROM review_boxes WHERE provider=$2
        ON CONFLICT(media_id,provider) DO UPDATE SET url=excluded.url,rating=excluded.rating,name=excluded.name,scale=excluded.scale,manual=true,status='manual',checked_at=now()`,
        [body.id, data.provider, url, url ? data.rating : null],
      );
    } else if (body.action === 'media') {
      const data = mediaSchema.parse(body.data),
        fields = Object.keys(data);
      const values = Object.values(data);
      await query(
        `UPDATE media SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(',')},locked_fields=ARRAY(SELECT DISTINCT unnest(locked_fields || $${values.length + 1}::text[])),updated_at=now() WHERE id=$${values.length + 2}`,
        [...values, fields, body.id],
      );
      const series = z.string().max(300).optional().parse(body.data?.series)?.trim();
      if (!series) await query('DELETE FROM film_series_members WHERE media_id=$1', [body.id]);
      else {
        const [{ id: seriesId }] = await query<{ id: string }>(
          'INSERT INTO film_series(title) VALUES($1) ON CONFLICT(title) DO UPDATE SET title=excluded.title RETURNING id',
          [series],
        );
        await query(
          `INSERT INTO film_series_members(series_id,media_id,position)
           VALUES($1,$2,COALESCE((SELECT max(position)+1 FROM film_series_members WHERE series_id=$1),1))
           ON CONFLICT(media_id) DO UPDATE SET series_id=excluded.series_id,position=excluded.position`,
          [seriesId, body.id],
        );
      }
    } else if (body.action === 'series-reorder') {
      const data = z
        .object({
          seriesId: z.string().regex(/^\d+$/),
          order: z
            .array(z.string().regex(/^\d+$/))
            .min(1)
            .max(500),
        })
        .parse(body.data);
      await query(
        `UPDATE film_series_members SET position=v.position
         FROM (SELECT unnest($2::bigint[]) AS media_id,generate_series(1,array_length($2::bigint[],1)) AS position) v
         WHERE film_series_members.series_id=$1 AND film_series_members.media_id=v.media_id`,
        [data.seriesId, data.order],
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
    } else if (body.action === 'plex-review') {
      const [media] = await query<{ ids: Record<string, string> }>('SELECT ids FROM media WHERE id=$1', [
        body.mediaId,
      ]);
      const plexId = media?.ids?.plex;
      if (!plexId)
        return Response.json({ error: 'Kein Plex-Verweis für diesen Titel vorhanden.' }, { status: 400 });
      try {
        const review = await fetchPlexReview(plexId);
        if (!review?.message) return Response.json({ error: 'Keine Plex-Review gefunden.' }, { status: 404 });
        const rating = Number(review.rating);
        return Response.json({
          body: review.message,
          spoiler: !!review.hasSpoilers,
          rating: Number.isFinite(rating) && rating >= 0 && rating <= 10 ? Math.round(rating) : null,
        });
      } catch (e) {
        console.error('Plex-Review-Abruf fehlgeschlagen:', e);
        return Response.json(
          { error: 'Plex-Anfrage fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)) },
          { status: 502 },
        );
      }
    } else if (body.action === 'watch') {
      const data = z
        .object({
          watched_at: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
            .nullable(),
        })
        .parse(body.data);
      const updated = await query(
        `UPDATE watches SET watched_at=CASE WHEN $2::text IS NULL THEN NULL ELSE ($2::timestamp AT TIME ZONE 'Europe/Berlin') END,time_estimated=false WHERE id=$1 AND media_id=$3 RETURNING id`,
        [body.id, data.watched_at, body.mediaId],
      );
      if (!updated.length) throw Error('Anschauereignis nicht gefunden');
    } else if (body.action === 'watch-delete') {
      const deleted = await query('DELETE FROM watches WHERE id=$1 AND media_id=$2 RETURNING id', [
        body.id,
        body.mediaId,
      ]);
      if (!deleted.length) throw Error('Anschauereignis nicht gefunden');
    } else if (body.action === 'watch-create') {
      const data = z
        .object({
          watched_at: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
            .nullable(),
        })
        .parse(body.data);
      await query(
        `INSERT INTO watches(media_id,source,source_id,watched_at,time_estimated) VALUES($1,'geza',$2,CASE WHEN $3::text IS NULL THEN NULL ELSE ($3::timestamp AT TIME ZONE 'Europe/Berlin') END,false)`,
        [body.mediaId, crypto.randomUUID(), data.watched_at],
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
    } else if (body.action === 'generate-webhook-secret') {
      const secret = randomBytes(32).toString('base64url');
      await setSetting('PLEX_WEBHOOK_SECRET', secret);
      return Response.json(
        { ok: true, settings: { PLEX_WEBHOOK_SECRET: secret } },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } else if (body.action === 'enrich') {
      await query(
        `INSERT INTO jobs(kind,dedupe_key,payload) SELECT 'enrich','enrich:'||m.id,jsonb_build_object('mediaId',m.id) FROM media m LEFT JOIN (SELECT media_id,max(watched_at) latest FROM watches GROUP BY media_id) w ON w.media_id=m.id WHERE m.kind IN ('movie','show','episode') AND m.enriched_at IS NULL ORDER BY w.latest DESC NULLS LAST,CASE m.kind WHEN 'show' THEN 0 WHEN 'movie' THEN 1 ELSE 2 END,m.id ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',attempts=0,available_at=now(),error=NULL WHERE jobs.status='failed'`,
      );
    } else if (body.action === 'retry') {
      await query(
        "UPDATE jobs SET status='pending',attempts=0,available_at=now(),error=NULL WHERE status='failed'",
      );
    } else if (body.action === 'plex-review-batch') {
      await query(
        `INSERT INTO jobs(kind,dedupe_key,payload) SELECT 'plex-review-sync','plex-review-sync:'||id,jsonb_build_object('mediaId',id) FROM media WHERE ids ? 'plex' ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',attempts=0,available_at=now(),error=NULL`,
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

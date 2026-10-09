import { isAdmin, validOrigin } from '@/lib/auth';
import { isDemo } from '@/lib/demo-mode';
import { pool } from '@/lib/db';
import { plexIds, plexIdValues, plexRequest } from '@/lib/plex';
import { plexServerScope } from '@/lib/plex-decisions';
import { z } from 'zod';

const schema = z.object({
  mediaId: z.string().regex(/^[1-9]\d{0,17}$/),
  ratingKey: z.string().regex(/^\d{1,20}$/),
  expected: z.record(z.string(), z.union([z.string(), z.number()])),
  providerIds: z.record(z.string(), z.string()),
  providerIdValues: z.record(z.string(), z.array(z.string())).optional(),
  serverId: z.string().optional(),
  guid: z.string().max(1000).optional(),
  remove: z.boolean().optional(),
});
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  if (!validOrigin(req) || isDemo())
    return Response.json({ error: 'Aktion nicht verfügbar' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Ungültige Zuordnung.' }, { status: 400 });
  const data = parsed.data;
  const server = await plexServerScope();
  if (!data.remove && (!server || (data.serverId && data.serverId !== server)))
    return Response.json(
      { error: 'Die Plex-Verbindung hat sich geändert. Bitte erneut scannen.' },
      { status: 409 },
    );
  const client = await pool.connect();
  try {
    if (data.remove && data.guid && data.serverId) {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(729383)');
      await client.query(
        'DELETE FROM plex_match_decisions WHERE server_id=$1 AND rating_key=$2 AND guid=$3 AND media_id=$4',
        [data.serverId, data.ratingKey, data.guid, data.mediaId],
      );
      await client.query(
        "INSERT INTO event_logs(level,source,message,context) VALUES('info','admin','Dauerhafte Plex-Zuordnung aufgehoben',$1)",
        [JSON.stringify({ mediaId: data.mediaId, ratingKey: data.ratingKey })],
      );
      await client.query('COMMIT');
      return Response.json({
        message: 'Zuordnung aufgehoben. Beim nächsten Scan gelten wieder die Anbieter-IDs.',
      });
    }
    // Verify current Plex metadata, including for historical conflicts recorded before this feature.
    const response = await plexRequest(
      `/library/metadata/${encodeURIComponent(data.ratingKey)}?includeGuids=1`,
    );
    const item = response?.MediaContainer?.Metadata?.find((m: any) => String(m.ratingKey) === data.ratingKey);
    const incoming = item ? plexIds(item) : {};
    const values = item ? plexIdValues(item) : {};
    const changedValues =
      data.providerIdValues &&
      Object.keys({ ...values, ...data.providerIdValues }).some(
        (k) =>
          JSON.stringify([...(values[k] || [])].sort()) !==
          JSON.stringify([...(data.providerIdValues?.[k] || [])].sort()),
      );
    if (
      !item?.guid ||
      changedValues ||
      (data.guid && data.guid !== item.guid) ||
      Object.keys({ ...incoming, ...data.providerIds }).some((k) => incoming[k] !== data.providerIds[k])
    )
      return Response.json(
        {
          error:
            'Der Plex-Eintrag hat sich geändert. Bitte erneut scannen und den aktuellen Konflikt öffnen.',
        },
        { status: 409 },
      );
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    const [media] = (
      await client.query('SELECT id,kind,ids FROM media WHERE id=$1 AND ids=$2::jsonb FOR UPDATE', [
        data.mediaId,
        JSON.stringify(data.expected),
      ])
    ).rows;
    if (!media || media.kind !== item.type || !['movie', 'show', 'episode'].includes(item.type)) {
      await client.query('ROLLBACK');
      return Response.json(
        { error: 'Der Ziel-Datensatz hat sich geändert oder hat einen anderen Medientyp. Bitte neu laden.' },
        { status: 409 },
      );
    }
    if (data.remove) {
      await client.query(
        'DELETE FROM plex_match_decisions WHERE server_id=$1 AND rating_key=$2 AND guid=$3 AND media_id=$4',
        [server, data.ratingKey, item.guid, media.id],
      );
    } else {
      await client.query(
        `INSERT INTO plex_match_decisions(server_id,rating_key,guid,media_id,provider_ids)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(server_id,rating_key,guid)
        DO UPDATE SET media_id=excluded.media_id,provider_ids=excluded.provider_ids,created_at=now()`,
        [server, data.ratingKey, item.guid, media.id, JSON.stringify(incoming)],
      );
    }
    await client.query("INSERT INTO event_logs(level,source,message,context) VALUES('info','admin',$1,$2)", [
      data.remove
        ? 'Dauerhafte Plex-Zuordnung aufgehoben'
        : 'Plex-Eintrag dauerhaft einem Datensatz zugeordnet',
      JSON.stringify({
        mediaId: data.mediaId,
        ratingKey: data.ratingKey,
        serverId: server,
        providerIds: incoming,
      }),
    ]);
    await client.query('COMMIT');
    return Response.json({
      message: data.remove
        ? 'Zuordnung aufgehoben.'
        : 'Zuordnung gespeichert. Die IDs dieses Datensatzes bleiben erhalten. Jetzt den Scan erneut prüfen.',
    });
  } catch {
    await client.query('ROLLBACK');
    return Response.json(
      { error: 'Zuordnung nicht gespeichert. Plex-Verbindung prüfen und erneut versuchen.' },
      { status: 502 },
    );
  } finally {
    client.release();
  }
}

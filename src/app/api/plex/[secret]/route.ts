import { logContext, logEvent } from '@/lib/logging';
import { getSetting } from '@/lib/settings';
import { constantEqual, digest } from '@/lib/security';
import { pool } from '@/lib/db';
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const requestId = crypto.randomUUID();
  return logContext.run({ requestId, method: req.method, path: '/api/plex/[secret]' }, async () => {
    const respond = async (
      status: number,
      message: string,
      body?: Record<string, unknown>,
      details: Record<string, unknown> = {},
    ) => {
      await logEvent(status >= 400 ? 'error' : 'info', 'webhook', message, { status, ...details });
      return Response.json(body || { error: message, requestId }, {
        status,
        headers: { 'X-Request-ID': requestId },
      });
    };
    await logEvent('info', 'webhook', 'Externe Webhook-Anfrage empfangen', {
      contentType: req.headers.get('content-type'),
      contentLength: req.headers.get('content-length'),
    });
    try {
      const expected = await getSetting('PLEX_WEBHOOK_SECRET'),
        account = await getSetting('PLEX_ACCOUNT_ID'),
        server = await getSetting('PLEX_SERVER_ID');
      if (!expected || !constantEqual((await params).secret, expected))
        return respond(401, 'Webhook abgewiesen: Geheimnis fehlt oder stimmt nicht ï¿½berein');
      if (!account || !server)
        return respond(503, 'Webhook nicht eingerichtet: Plex Account-ID oder Server-UUID fehlt');
      const reader = req.body?.getReader();
      if (!reader) return respond(400, 'Webhook enthï¿½lt keinen lesbaren Request-Body');
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          return respond(413, 'Webhook ï¿½berschreitet die maximale Grï¿½ï¿½e von 2 MiB');
        }
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      let raw;
      if (req.headers.get('content-type')?.includes('multipart/form-data')) {
        const f = await new Response(buffer, {
          headers: { 'Content-Type': req.headers.get('content-type')! },
        }).formData();
        raw = JSON.parse(String(f.get('payload')));
      } else raw = JSON.parse(buffer.toString());
      if (!raw || typeof raw !== 'object') return respond(400, 'Webhook-Payload muss ein Objekt sein');
      if (String(raw.Account?.id) !== account || String(raw.Server?.uuid) !== server)
        return respond(
          403,
          'Webhook abgewiesen: Account-ID oder Server-UUID stimmt nicht ï¿½berein',
          undefined,
          {
            accountMatches: String(raw.Account?.id) === account,
            serverMatches: String(raw.Server?.uuid) === server,
            receivedAccountId: raw.Account?.id,
            receivedServerUuid: raw.Server?.uuid,
          },
        );
      if (!['media.scrobble', 'media.rate'].includes(raw.event))
        return respond(
          200,
          'Webhook-Ereignis wird nicht verarbeitet',
          { ignored: true },
          { event: raw.event },
        );
      if (!raw.Metadata || !['movie', 'show', 'season', 'episode'].includes(raw.Metadata.type))
        return respond(400, 'Webhook enthï¿½lt keine unterstï¿½tzten Medien-Metadaten', undefined, {
          event: raw.event,
          type: raw.Metadata?.type,
        });
      const m = raw.Metadata,
        metadata: Record<string, unknown> = {};
      for (const key of [
        'type',
        'title',
        'year',
        'guid',
        'Guid',
        'ratingKey',
        'grandparentRatingKey',
        'grandparentTitle',
        'parentIndex',
        'index',
        'summary',
        'originalTitle',
        'contentRating',
        'duration',
        'Director',
        'Role',
        'Genre',
        'Country',
        'userRating',
        'lastViewedAt',
      ])
        if (m[key] !== undefined) metadata[key] = m[key];
      const fingerprint = digest(JSON.stringify({ event: raw.event, metadata, session: raw.Player?.uuid }));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [fingerprint]);
        const recent = await client.query(
          "SELECT 1 FROM jobs WHERE kind='plex' AND payload->>'fingerprint'=$1 AND updated_at>now()-interval '2 minutes'",
          [fingerprint],
        );
        if (!recent.rowCount) {
          const eventId = crypto.randomUUID();
          await client.query("INSERT INTO jobs(kind,payload) VALUES('plex',$1)", [
            JSON.stringify({
              requestId,
              event: raw.event,
              metadata,
              receivedAt: new Date().toISOString(),
              eventId,
              fingerprint,
            }),
          ]);
        }
        await client.query('COMMIT');
        return respond(
          202,
          recent.rowCount
            ? 'Doppeltes Webhook-Ereignis erkannt; kein neuer Auftrag'
            : 'Webhook angenommen und zur Verarbeitung vorgemerkt',
          { accepted: true },
          {
            event: raw.event,
            title: metadata.title,
            type: metadata.type,
            ratingKey: metadata.ratingKey,
            guid: metadata.guid,
            userRating: metadata.userRating,
            lastViewedAt: metadata.lastViewedAt,
          },
        );
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (error) {
      return respond(
        error instanceof SyntaxError || error instanceof TypeError ? 400 : 503,
        'Webhook konnte nicht verarbeitet werden',
        undefined,
        { error: error instanceof SyntaxError ? new Error('Ungültiges JSON im Webhook-Payload') : error },
      );
    }
  });
}

export async function GET() {
  await logEvent('warn', 'webhook', 'Webhook per GET aufgerufen; Plex muss POST senden', {
    method: 'GET',
    path: '/api/plex/[secret]',
    status: 405,
  });
  return Response.json(
    { error: 'Dieser Endpunkt erwartet einen Plex-Webhook per POST.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}

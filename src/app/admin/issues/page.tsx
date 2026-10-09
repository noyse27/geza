import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { WatchEditor } from '@/components/editor';
import { IdCorrection } from '@/components/id-correction';
import { PlexDecision } from '@/components/plex-decision';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Offene Importfälle', robots: { index: false, follow: false } };
export default async function Issues({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const p = await searchParams,
    page = Math.min(100000, Math.max(0, Math.floor(Number(p.page) || 0)));
  const tab = p.tab === 'decisions' ? 'decisions' : p.tab === 'ids' ? 'ids' : 'dates';
  const decisions =
    tab === 'decisions'
      ? await query(
          `SELECT d.*,m.title,m.ids FROM plex_match_decisions d
    JOIN media m ON m.id=d.media_id ORDER BY d.created_at DESC,d.media_id LIMIT 51 OFFSET $1`,
          [page * 50],
        )
      : [];
  const [dateCount, collisionCount] = await Promise.all([
    query('SELECT count(*)::int AS n FROM watches WHERE watched_at IS NULL'),
    query(
      "SELECT count(*)::int AS n FROM (SELECT kind,ids->>'plex' FROM media WHERE ids ? 'plex' GROUP BY kind,ids->>'plex' HAVING count(*)>1) x",
    ),
  ]);
  const watches =
    tab === 'dates'
      ? await query(
          `SELECT w.id,w.media_id,w.watched_at,w.time_estimated,w.original_watched_at,m.title,m.kind,p.title AS parent_title FROM watches w JOIN media m ON m.id=w.media_id LEFT JOIN media p ON p.id=m.parent_id WHERE w.watched_at IS NULL ORDER BY w.id LIMIT 51 OFFSET $1`,
          [page * 50],
        )
      : [];
  const collisions =
    tab === 'ids'
      ? await query(
          `WITH groups AS (SELECT kind,ids->>'plex' AS plex FROM media WHERE ids ? 'plex' GROUP BY kind,ids->>'plex' HAVING count(*)>1 ORDER BY kind,ids->>'plex' LIMIT 51 OFFSET $1)
    SELECT g.kind,g.plex,jsonb_agg(jsonb_build_object('id',m.id::text,'title',m.title,'year',m.year,'ids',m.ids) ORDER BY m.id) AS titles FROM groups g JOIN media m ON m.kind=g.kind AND m.ids->>'plex'=g.plex GROUP BY g.kind,g.plex ORDER BY g.kind,g.plex`,
          [page * 50],
        )
      : [];
  return (
    <div className="page">
      <h1>Offene Importfälle</h1>
      <p>
        <Link href="/admin">← Admin</Link> · <Link href="/admin/jobs">Verarbeitung</Link>
      </p>
      <p>
        Aktueller Datenbestand. Nach einer Korrektur verschwindet der Fall aus dieser Liste. Alte
        Importberichte behalten ihren damaligen Stand.
      </p>
      <p>
        <Link href="/admin/issues">{dateCount[0].n} ungeklärte Anschauzeitpunkte</Link> ·{' '}
        <Link href="/admin/issues?tab=ids">{collisionCount[0].n} mehrfach zugeordnete Plex-ID-Gruppen</Link>
        {' · '}
        <Link href="/admin/issues?tab=decisions">Gespeicherte Plex-Zuordnungen</Link>
      </p>
      {tab === 'decisions' && (
        <>
          <h2>Gespeicherte Plex-Zuordnungen</h2>
          <p>
            Diese Auswahl gilt bei künftigen Abgleichen. Die Anbieter-IDs des gewählten Titels bleiben
            erhalten. Eine aufgehobene Zuordnung wird beim nächsten Scan neu geprüft.
          </p>
          {decisions.slice(0, 50).map((d) => (
            <section className="panel" key={`${d.server_id}:${d.rating_key}:${d.guid}`}>
              <h3>
                <Link href={`/title/${d.media_id}`}>{d.title}</Link>
              </h3>
              <p>
                Plex-Eintrag {d.rating_key} · gespeichert am{' '}
                {new Date(d.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}
              </p>
              <PlexDecision
                mediaId={String(d.media_id)}
                ids={d.ids}
                selected
                details={{
                  ratingKey: d.rating_key,
                  guid: d.guid,
                  serverId: d.server_id,
                  providerIds: d.provider_ids,
                }}
              />
            </section>
          ))}
          {!decisions.length && <p>Keine gespeicherten Zuordnungen.</p>}
        </>
      )}
      {tab === 'dates' && (
        <>
          <h2>Anschauzeitpunkte</h2>
          <p>
            Wenn du den Zeitpunkt nicht weißt, kann er ungeklärt bleiben. Zum Korrigieren das Stiftsymbol
            verwenden.
          </p>
          {watches.slice(0, 50).map((w) => (
            <section className="panel" key={w.id}>
              <h3>
                <Link href={`/title/${w.media_id}`}>
                  {w.parent_title ? `${w.parent_title} · ` : ''}
                  {w.title}
                </Link>
              </h3>
              {w.original_watched_at && (
                <p className="small muted">Ursprünglicher Importwert: {w.original_watched_at}</p>
              )}
              <WatchEditor
                mediaId={String(w.media_id)}
                watch={{ id: String(w.id), watched_at: null, time_estimated: w.time_estimated }}
              />
            </section>
          ))}
          {!watches.length && <p>Keine offenen Zeitpunkte.</p>}
        </>
      )}
      {tab === 'ids' && (
        <>
          <h2>Mehrfach zugeordnete Plex-IDs</h2>
          <p>
            Vergleiche die Titel und Anbieter-IDs. Entferne eine falsche Plex-ID oder korrigiere die übrigen
            IDs. Eine gemeinsame ID ist kein Grund, verschiedene Filme zusammenzuführen.
          </p>
          {collisions.slice(0, 50).map((c) => (
            <section className="panel" key={`${c.kind}:${c.plex}`}>
              <h3>Plex-ID {c.plex}</h3>
              {c.titles.map((m: any) => (
                <div className="processing-row" key={m.id}>
                  <h4>
                    <Link href={`/title/${m.id}`}>
                      {m.title} {m.year ? `(${m.year})` : ''}
                    </Link>
                  </h4>
                  <p>
                    {Object.entries(m.ids)
                      .map(([key, value]) => `${key.toUpperCase()}: ${value}`)
                      .join(' · ')}
                  </p>
                  <IdCorrection mediaId={m.id} ids={m.ids} />
                </div>
              ))}
            </section>
          ))}
          {!collisions.length && <p>Keine mehrfach zugeordneten Plex-IDs.</p>}
        </>
      )}
      {(watches.length > 50 || collisions.length > 50 || decisions.length > 50) && (
        <Link className="button" href={`/admin/issues?tab=${tab}&page=${page + 1}`}>
          Weitere Fälle
        </Link>
      )}
    </div>
  );
}

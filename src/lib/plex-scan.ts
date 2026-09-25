import { isDemo } from './demo-mode';
import { logEvent } from './logging';
import { pool } from './db';
import { getSetting } from './settings';
import { plexRequest, ensurePlexMedia, plexIds } from './plex';
import { loadTombstones, forgetTombstones } from './rumpel';
import { mergeMetadata, fromPlex } from './providers';

type Metadata = Record<string, any>;
type Entry = { item: Metadata; library: string; automatic: boolean; episodes?: Metadata[] };

export async function plexList(path: string): Promise<Metadata[]> {
  const result: Metadata[] = [];
  let expectedTotal: number | undefined;
  const ratingKeys = new Set<string>();
  for (let offset = 0; ;) {
    const data = await plexRequest(
      `${path}${path.includes('?') ? '&' : '?'}X-Plex-Container-Start=${offset}&X-Plex-Container-Size=500`,
    );
    const c = data?.MediaContainer;
    if (!c || (c.Metadata !== undefined && !Array.isArray(c.Metadata)))
      throw Error('Unvollständige Plex-Antwort');
    if (c.Metadata === undefined && c.size !== 0 && c.totalSize !== 0)
      throw Error('Plex-Antwort enthält weder Titel noch einen bestätigten leeren Bestand');
    const page = c.Metadata || [];
    const total = c.totalSize === undefined ? undefined : Number(c.totalSize);
    if (total !== undefined && (!Number.isInteger(total) || total < 0))
      throw Error('Ungültige Plex-Gesamtzahl');
    if (offset && total !== expectedTotal) throw Error('Plex-Bestand hat sich während des Abrufs geändert');
    expectedTotal = total;
    if (total === undefined && page.length >= 500)
      throw Error('Plex-Gesamtzahl fehlt; Vollständigkeit unklar');
    for (const item of page)
      if (item.ratingKey != null) {
        const key = String(item.ratingKey);
        if (ratingKeys.has(key)) throw Error('Doppelte Plex-Seite; Bestand bleibt unverändert');
        ratingKeys.add(key);
      }
    if (c.offset !== undefined && Number(c.offset) !== offset) throw Error('Plex-Seitenfolge unvollständig');
    result.push(...page);
    offset += page.length;
    if (total === undefined || offset === total) return result;
    if (!page.length || offset > total) throw Error('Plex-Bibliothek nicht vollständig gelesen');
  }
}
function seen(item: Metadata) {
  // Plex omits viewCount on never-watched entries; malformed values are not zero.
  const count = item.viewCount ?? 0;
  if (!Number.isFinite(Number(count)) || Number(count) < 0) throw Error('Ungültiger Plex-Gesehenstatus');
  return Number(count) > 0;
}
export async function processPlexScan(payload: { manual?: boolean; preview?: boolean } = {}) {
  if (isDemo()) return;
  if ((await getSetting('PLEX_SCAN_ENABLED')) === '0' && !payload.manual) return;
  if (!(await getSetting('PLEX_URL')) || !(await getSetting('PLEX_TOKEN'))) {
    if (payload.manual) throw Error('Plex ist nicht verbunden.');
    return;
  }
  const automatic = (await getSetting('PLEX_SCAN_WATCHED_ONLY')) !== '0';
  const filter = (await getSetting('PLEX_SCAN_SECTIONS')).split(',').filter(Boolean);
  const data = await plexRequest('/library/sections');
  if (!Array.isArray(data?.MediaContainer?.Directory))
    throw Error('Plex-Bibliotheken konnten nicht gelesen werden');
  const sections = data.MediaContainer.Directory.filter((s: Metadata) => ['movie', 'show'].includes(s.type));
  if (!sections.length) throw Error('Keine Film- oder Serienbibliotheken; Bestand bleibt unverändert.');
  const entries: Entry[] = [];
  for (const section of sections) {
    const selected = !filter.length || filter.includes(String(section.key));
    for (const item of await plexList(
      `/library/sections/${encodeURIComponent(section.key)}/all?includeGuids=1`,
    )) {
      if (!['movie', 'show'].includes(item.type)) throw Error('Unerwarteter Plex-Medientyp');
      let episodes: Metadata[] | undefined;
      if (item.type === 'show') {
        if (!item.ratingKey) throw Error('Plex-Serie ohne Bibliotheksschlüssel');
        episodes = await plexList(
          `/library/metadata/${encodeURIComponent(item.ratingKey)}/allLeaves?includeGuids=1`,
        );
        for (const e of episodes) {
          if (
            e.type !== 'episode' ||
            !Number.isInteger(e.parentIndex) ||
            e.parentIndex < 0 ||
            !Number.isInteger(e.index)
          )
            throw Error('Unvollständige Plex-Episodenzuordnung');
          seen(e);
        }
      } else seen(item);
      entries.push({ item, library: String(section.title), automatic: automatic && selected, episodes });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout=120000');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    await client.query("SET LOCAL geza.skip_rumpel='on'");
    const before = (await client.query('SELECT id,title,kind,bucketlist,rumpel,assignment_reason FROM media'))
      .rows;
    const tombstones = await loadTombstones(client);
    const matches = new Map<string, { libraries: Set<string>; watched: boolean; automatic: boolean }>();
    let skipped = 0;
    const remember = (id: string, library: string, watched: boolean, auto: boolean) => {
      const prior = matches.get(id);
      matches.set(id, {
        libraries: (prior?.libraries || new Set()).add(library),
        watched: watched || !!prior?.watched,
        automatic: auto || !!prior?.automatic,
      });
    };
    for (const { item, library, automatic: auto, episodes } of entries) {
      const watched = episodes ? episodes.some(seen) || Number(item.viewedLeafCount) > 0 : seen(item);
      const deleted = tombstones.matches(item.type, plexIds(item));
      if (deleted.length && !watched) {
        skipped++;
        continue;
      }
      await forgetTombstones(deleted, client);
      const id = await ensurePlexMedia(item, undefined, client);
      await mergeMetadata(id, fromPlex(item), 'plex', client);
      if (!episodes || episodes.length) remember(id, library, watched, auto);
      if (episodes) {
        const seasons = new Map<number, Metadata[]>();
        for (const episode of episodes)
          seasons.set(episode.parentIndex, [...(seasons.get(episode.parentIndex) || []), episode]);
        for (const [number, leaves] of seasons) {
          const sid = await ensurePlexMedia(
            { type: 'season', index: number, title: `Staffel ${number}` },
            id,
            client,
          );
          remember(sid, library, leaves.some(seen), auto);
          for (const episode of leaves) {
            const eid = await ensurePlexMedia(episode, id, client);
            remember(eid, library, seen(episode), false);
          }
        }
      }
    }
    // Absence is not an unwatched event: retain known seen evidence for missing items.
    await client.query(`UPDATE media SET plex_libraries='{}',plex_checked_at=now(),plex_automatic=false,
      origins=array_remove(origins,'legacy-bucket') WHERE kind IN ('movie','show','season','episode')`);
    for (const [id, match] of matches)
      await client.query(
        `UPDATE media SET plex_libraries=$2,plex_watched=$3,plex_automatic=$4,
      origins=ARRAY(SELECT DISTINCT unnest(origins||ARRAY['plex'])) WHERE id=$1`,
        [id, [...match.libraries].sort(), match.watched, match.automatic],
      );
    await client.query('SELECT rumpel_refresh(NULL)');
    const old = new Map(before.map((r) => [r.id, r]));
    const after = (
      await client.query('SELECT id,title,kind,bucketlist,rumpel,assignment_reason FROM media ORDER BY id')
    ).rows;
    const changes = after
      .filter(
        (r) =>
          !old.has(r.id) || old.get(r.id)!.bucketlist !== r.bucketlist || old.get(r.id)!.rumpel !== r.rumpel,
      )
      .map((r) => ({
        ...r,
        before: old.has(r.id)
          ? old.get(r.id)!.bucketlist
            ? 'Bucketliste'
            : old.get(r.id)!.rumpel
              ? 'Rumpelkammer'
              : 'Archiv'
          : 'Neu',
        after: r.bucketlist ? 'Bucketliste' : r.rumpel ? 'Rumpelkammer' : 'Archiv',
      }));
    const report = {
      sections: sections.length,
      titles: matches.size,
      skippedDeleted: skipped,
      changed: changes.length,
      changes: changes.slice(0, 200),
      preview: !!payload.preview,
    };
    if (payload.preview) await client.query('ROLLBACK');
    else {
      await client.query(
        `INSERT INTO jobs(kind,dedupe_key,payload) SELECT 'enrich','enrich:'||id,jsonb_build_object('mediaId',id) FROM media
        WHERE id=ANY($1::bigint[]) AND kind IN ('movie','show') AND enriched_at IS NULL ON CONFLICT(dedupe_key) DO NOTHING`,
        [[...matches.keys()]],
      );
      await client.query('COMMIT');
      await logEvent('info', 'plex-scan', 'Plex-Bestand und Einordnung abgeglichen', report);
    }
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

import { isDemo } from './demo-mode';
import { logEvent } from './logging';
import { pool } from './db';
import { getSetting } from './settings';
import { plexRequest, ensurePlexMedia, plexIds } from './plex';
import { loadTombstones, forgetTombstones } from './rumpel';
import { mergeMetadata, fromPlex } from './providers';
import { resolvePlexEpisodes } from './plex-episodes';
import { reportProgress, saveJobResult, type JobResult } from './job-history';
import { getPlexRestoreContext, queuePlexRestore, plexWatched as seen } from './plex-watch-restore';

type Metadata = Record<string, any>;
type Entry = {
  item: Metadata;
  library: string;
  automatic: boolean;
  episodes?: Metadata[];
  incomplete?: boolean;
};

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
    await reportProgress('Plex-Bestand lesen', result.length, total);
    offset += page.length;
    if (total === undefined || offset === total) return result;
    if (!page.length || offset > total) throw Error('Plex-Bibliothek nicht vollständig gelesen');
  }
}
export async function processPlexScan(payload: { manual?: boolean; preview?: boolean } = {}) {
  if (isDemo()) return;
  if ((await getSetting('PLEX_SCAN_ENABLED')) === '0' && !payload.manual) return;
  if (!(await getSetting('PLEX_URL')) || !(await getSetting('PLEX_TOKEN'))) {
    if (payload.manual) throw Error('Plex ist nicht verbunden.');
    return;
  }
  const automatic = (await getSetting('PLEX_SCAN_WATCHED_ONLY')) !== '0';
  const restoreContext = await getPlexRestoreContext();
  let watchedRestores = 0;
  const filter = (await getSetting('PLEX_SCAN_SECTIONS')).split(',').filter(Boolean);
  const data = await plexRequest('/library/sections');
  if (!Array.isArray(data?.MediaContainer?.Directory))
    throw Error('Plex-Bibliotheken konnten nicht gelesen werden');
  const sections = data.MediaContainer.Directory.filter((s: Metadata) => ['movie', 'show'].includes(s.type));
  if (!sections.length) throw Error('Keine Film- oder Serienbibliotheken; Bestand bleibt unverändert.');
  const entries: Entry[] = [];
  const incompleteSeries: { title: string; library: string; ratingKey: string; issues: Metadata[] }[] = [];
  for (const section of sections) {
    await reportProgress(`Bibliothek „${section.title}“ lesen`, undefined, undefined, true);
    const selected = !filter.length || filter.includes(String(section.key));
    for (const item of await plexList(
      `/library/sections/${encodeURIComponent(section.key)}/all?includeGuids=1`,
    )) {
      if (!['movie', 'show'].includes(item.type)) throw Error('Unerwarteter Plex-Medientyp');
      let episodes: Metadata[] | undefined;
      let incomplete = false;
      if (item.type === 'show') {
        if (!item.ratingKey) throw Error('Plex-Serie ohne Bibliotheksschlüssel');
        const leaves = await plexList(
          `/library/metadata/${encodeURIComponent(item.ratingKey)}/allLeaves?includeGuids=1`,
        );
        const resolved = await resolvePlexEpisodes(item, leaves);
        episodes = resolved.episodes;
        incomplete = resolved.issues.length > 0;
        if (incomplete) {
          const detail = {
            title: String(item.title),
            library: String(section.title),
            ratingKey: String(item.ratingKey),
            issues: resolved.issues.slice(0, 20),
          };
          incompleteSeries.push(detail);
          await logEvent(
            'warn',
            'plex-scan',
            'Serie wegen unklarer Episodenzuordnung nicht neu einsortiert',
            detail,
          );
        }
        for (const e of episodes) seen(e);
      } else seen(item);
      entries.push({
        item,
        library: String(section.title),
        automatic: automatic && selected,
        episodes,
        incomplete,
      });
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
    const protectedRoots = new Set<string>();
    const results: JobResult[] = [];
    let processed = 0;
    const remember = (id: string, library: string, watched: boolean, auto: boolean) => {
      const prior = matches.get(id);
      matches.set(id, {
        libraries: (prior?.libraries || new Set()).add(library),
        watched: watched || !!prior?.watched,
        automatic: auto || !!prior?.automatic,
      });
    };
    for (const { item, library, automatic: auto, episodes, incomplete } of entries) {
      await reportProgress(`Titel zuordnen: ${item.title}`, processed++, entries.length);
      const watched = episodes ? episodes.some(seen) || Number(item.viewedLeafCount) > 0 : seen(item);
      const deleted = tombstones.matches(item.type, plexIds(item));
      if (deleted.length && (!watched || incomplete)) {
        skipped++;
        results.push({
          title: item.title,
          outcome: 'skipped',
          reason:
            'Zuvor in der Rumpelkammer gelöscht. Ohne neue Sichtung wird der Titel nicht automatisch wieder angelegt.',
          details: {
            ratingKey: item.ratingKey,
            providerIds: plexIds(item),
            library,
            type: item.type,
            deleted: true,
          },
        });
        continue;
      }
      await forgetTombstones(deleted, client);
      const id = await ensurePlexMedia(item, undefined, client);
      await mergeMetadata(id, fromPlex(item), 'plex', client);
      if (incomplete) {
        protectedRoots.add(id);
        results.push({
          mediaId: id,
          title: item.title,
          outcome: 'skipped',
          reason: 'Episodenzuordnung unvollständig. Die bisherige Einordnung bleibt geschützt.',
          details: { ratingKey: item.ratingKey, providerIds: plexIds(item), library },
        });
        continue;
      }
      results.push({
        mediaId: id,
        title: item.title,
        outcome: 'unchanged',
        details: { library, ratingKey: item.ratingKey, providerIds: plexIds(item) },
      });
      if (!episodes || episodes.length) remember(id, library, watched, auto);
      if (!episodes && (await queuePlexRestore(client, restoreContext, id, item))) watchedRestores++;
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
            if (await queuePlexRestore(client, restoreContext, eid, episode)) watchedRestores++;
          }
        }
      }
    }
    // Absence is not an unwatched event: retain known seen evidence for missing items.
    const protectedIds = new Set<string>(
      (
        await client.query(
          `WITH RECURSIVE t AS (
      SELECT id FROM media WHERE id=ANY($1::bigint[]) UNION ALL SELECT m.id FROM media m JOIN t ON m.parent_id=t.id
      ) SELECT id FROM t`,
          [[...protectedRoots]],
        )
      ).rows.map((r) => r.id),
    );
    await client.query(
      `UPDATE media SET plex_libraries='{}',plex_checked_at=now(),plex_automatic=false,
      origins=array_remove(origins,'legacy-bucket') WHERE kind IN ('movie','show','season','episode') AND NOT(id=ANY($1::bigint[]))`,
      [[...protectedIds]],
    );
    for (const [id, match] of matches)
      if (!protectedIds.has(id))
        await client.query(
          `UPDATE media SET plex_libraries=$2,plex_watched=$3,plex_automatic=$4,
      origins=ARRAY(SELECT DISTINCT unnest(origins||ARRAY['plex'])) WHERE id=$1`,
          [id, [...match.libraries].sort(), match.watched, match.automatic],
        );
    await client.query('SELECT rumpel_refresh(NULL)');
    await reportProgress('Einordnung abschließen', entries.length, entries.length, true);
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
      incompleteSeries: incompleteSeries.length,
      watchedRestores,
    };
    if (payload.preview) await client.query('ROLLBACK');
    else {
      const afterMap = new Map(after.map((r) => [r.id, r]));
      const recorded = new Set<string>();
      for (const result of results) {
        const current = result.mediaId ? afterMap.get(result.mediaId) : undefined;
        if (result.mediaId) {
          if (recorded.has(result.mediaId)) continue;
          recorded.add(result.mediaId);
        }
        if (current) {
          const previous = old.get(current.id);
          result.destination = current.bucketlist
            ? 'Bucketliste'
            : current.rumpel
              ? 'Rumpelkammer'
              : 'Archiv';
          if (result.outcome !== 'skipped') {
            result.outcome = !previous
              ? 'new'
              : previous.bucketlist !== current.bucketlist || previous.rumpel !== current.rumpel
                ? 'updated'
                : 'unchanged';
            result.reason = current.assignment_reason || 'Einordnung unverändert.';
          }
        }
        await saveJobResult(result, client);
      }
      // Include titles whose destination changed because they disappeared from Plex.
      for (const change of changes)
        if (!recorded.has(change.id) && ['movie', 'show'].includes(change.kind))
          await saveJobResult(
            {
              mediaId: change.id,
              title: change.title,
              outcome: change.before === 'Neu' ? 'new' : 'updated',
              destination: change.after,
              reason: change.assignment_reason,
            },
            client,
          );
      await client.query(
        `INSERT INTO jobs(kind,dedupe_key,payload) SELECT 'enrich','enrich:'||id,jsonb_build_object('mediaId',id) FROM media
        WHERE id=ANY($1::bigint[]) AND kind IN ('movie','show') AND enriched_at IS NULL ON CONFLICT(dedupe_key) DO NOTHING`,
        [[...matches.keys()]],
      );
      await client.query('COMMIT');
      await logEvent(
        incompleteSeries.length ? 'warn' : 'info',
        'plex-scan',
        'Plex-Bestand und Einordnung abgeglichen',
        report,
      );
    }
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

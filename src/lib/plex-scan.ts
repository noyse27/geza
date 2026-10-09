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
  issue?: string;
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
  const sections = data.MediaContainer.Directory.filter(
    (s: Metadata) => ['movie', 'show'].includes(s.type) && (!filter.length || filter.includes(String(s.key))),
  );
  if (!sections.length)
    throw Error(
      'Keine ausgewählte Film- oder Serienbibliothek verfügbar. Bitte die Bibliotheksauswahl prüfen; der Bestand bleibt unverändert.',
    );
  const entries: Entry[] = [];
  const incompleteSeries: { title: string; library: string; ratingKey: string; issues: Metadata[] }[] = [];
  for (const section of sections) {
    await reportProgress(`Bibliothek „${section.title}“ lesen`, undefined, undefined, true);
    for (let item of await plexList(
      `/library/sections/${encodeURIComponent(section.key)}/all?includeGuids=1`,
    )) {
      if (!['movie', 'show'].includes(item.type)) {
        entries.push({
          item,
          library: String(section.title),
          automatic,
          issue: 'Unerwarteter Plex-Medientyp. Diesen Eintrag in Plex prüfen.',
        });
        continue;
      }
      if (!Object.keys(plexIds(item)).length && item.ratingKey) {
        const details = await plexRequest(
          `/library/metadata/${encodeURIComponent(item.ratingKey)}?includeGuids=1`,
        ).catch((error) => {
          if (/^Plex(?::)? HTTP (404|410)(?:\s|$)/.test(error.message)) return null;
          throw error;
        });
        const detail = details?.MediaContainer?.Metadata?.find(
          (m: Metadata) => String(m.ratingKey) === String(item.ratingKey) && m.type === item.type,
        );
        if (detail) item = { ...item, ...detail };
      }
      let episodes: Metadata[] | undefined;
      let incomplete = false;
      if (item.type === 'show') {
        if (!item.ratingKey) {
          entries.push({
            item,
            library: String(section.title),
            automatic,
            issue: 'Plex-Serie ohne Bibliotheksschlüssel. Diesen Eintrag in Plex prüfen.',
          });
          continue;
        }
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
      }
      let issue: string | undefined;
      try {
        if (episodes) episodes.forEach(seen);
        else seen(item);
      } catch {
        issue =
          'Ungültiger Plex-Gesehenstatus. Diesen Eintrag in Plex prüfen; die bisherige Einordnung bleibt geschützt.';
      }
      entries.push({
        item,
        library: String(section.title),
        automatic,
        episodes,
        incomplete,
        issue,
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
    let conflicts = 0;
    const protectedRoots = new Set<string>();
    const uncertainLibraries = new Set<string>();
    const results: JobResult[] = [];
    let processed = 0;
    let pendingMatches = new Map<string, { libraries: Set<string>; watched: boolean; automatic: boolean }>();
    const remember = (id: string, library: string, watched: boolean, auto: boolean) => {
      const prior = pendingMatches.get(id) || matches.get(id);
      pendingMatches.set(id, {
        libraries: new Set(prior?.libraries).add(library),
        watched: watched || !!prior?.watched,
        automatic: auto || !!prior?.automatic,
      });
    };
    for (const { item, library, automatic: auto, episodes, incomplete, issue } of entries) {
      await reportProgress(`Titel zuordnen: ${item.title}`, processed++, entries.length);
      await client.query('SAVEPOINT plex_entry');
      pendingMatches = new Map();
      const previousResults = results.length;
      const previousRestores = watchedRestores;
      let entryRootId: string | undefined;
      try {
        if (issue)
          throw Object.assign(Error(issue), {
            matchDetails: {
              title: item.title || 'Unbenannter Plex-Eintrag',
              providerIds: plexIds(item),
              matches: [],
              ratingKey: item.ratingKey,
              type: item.type,
              itemIssue: issue,
            },
          });
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
        entryRootId = id;
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
        for (const [key, value] of pendingMatches) matches.set(key, value);
      } catch (error) {
        const detail = (error as { matchDetails?: Record<string, any> }).matchDetails;
        await client.query('ROLLBACK TO SAVEPOINT plex_entry');
        if (!detail) throw error;
        results.length = previousResults;
        watchedRestores = previousRestores;
        conflicts++;
        if (detail.missingIds || detail.itemIssue) uncertainLibraries.add(library);
        // Protect all candidate families, including a series containing a conflicting episode.
        const candidateIds = (detail.matches || [])
          .map((m: any) => String(m.id))
          .filter((id: string) => /^\d+$/.test(id));
        if (entryRootId) candidateIds.push(entryRootId);
        const rootIds = (
          await client.query(
            `WITH RECURSIVE ancestors AS (
          SELECT id,parent_id FROM media WHERE id=ANY($1::bigint[])
          UNION SELECT m.id,m.parent_id FROM media m JOIN ancestors a ON a.parent_id=m.id
        ) SELECT id FROM ancestors`,
            [candidateIds],
          )
        ).rows;
        for (const root of rootIds) protectedRoots.add(root.id);
        // The root may have been found successfully before an episode failed.
        const rootCandidates = (
          await client.query(
            `SELECT id FROM media WHERE kind=$1 AND (
          ids->>'plex'=$2 OR ids->>'imdb'=$3 OR ids->>'tmdb'=$4 OR ids->>'tvdb'=$5)`,
            [item.type, ...['plex', 'imdb', 'tmdb', 'tvdb'].map((k) => plexIds(item)[k] || null)],
          )
        ).rows;
        for (const root of rootCandidates) protectedRoots.add(root.id);
        results.push({
          title: detail.title || item.title,
          outcome: 'failed',
          reason:
            detail.itemIssue ||
            (detail.missingIds
              ? 'Plex liefert auch in den Detaildaten keine verlässliche Medien-ID. Diesen Titel in Plex zuordnen und erneut scannen. Die übrigen Titel werden verarbeitet.'
              : 'ID-Konflikt: Dieser Titel wurde nicht übernommen. Die übrigen Titel werden weiter verarbeitet. Den korrekten Datensatz dauerhaft auswählen und erneut scannen.'),
          details: { ...detail, library },
        });
      } finally {
        await client.query('RELEASE SAVEPOINT plex_entry');
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
    const scannedLibraries = sections.map((s: Metadata) => String(s.title));
    // Only withdraw evidence from libraries actually read. Unidentified entries may be old titles,
    // so retain absence evidence for their library until its identities can be resolved.
    const previousLibraries = !filter.length
      ? (await client.query('SELECT DISTINCT unnest(plex_libraries) AS name FROM media')).rows.map(
          (r) => r.name,
        )
      : [];
    const clearLibraries = [...new Set<string>([...scannedLibraries, ...previousLibraries])].filter(
      (name) => !uncertainLibraries.has(name),
    );
    await client.query(
      `UPDATE media SET
      plex_libraries=ARRAY(SELECT unnest(plex_libraries) EXCEPT SELECT unnest($2::text[])),
      plex_checked_at=now(),
      plex_automatic=CASE WHEN EXISTS(SELECT 1 FROM unnest(plex_libraries) l WHERE NOT(l=ANY($2::text[]))) THEN plex_automatic ELSE false END,
      origins=array_remove(origins,'legacy-bucket')
      WHERE kind IN ('movie','show','season','episode') AND NOT(id=ANY($1::bigint[]))
      AND (plex_libraries && $2::text[] OR ($3 AND NOT(plex_libraries && $4::text[])))`,
      [[...protectedIds], clearLibraries, !filter.length, [...uncertainLibraries]],
    );
    for (const [id, match] of matches)
      if (!protectedIds.has(id))
        await client.query(
          `UPDATE media SET plex_libraries=ARRAY(SELECT DISTINCT unnest(plex_libraries||$2::text[])),
      plex_checked_at=now(),
      plex_watched=CASE WHEN cardinality(plex_libraries)>0 THEN COALESCE(plex_watched,false) OR $3 ELSE $3 END,
      plex_automatic=plex_automatic OR $4,
      origins=ARRAY(SELECT DISTINCT unnest(array_remove(origins,'legacy-bucket')||ARRAY['plex'])) WHERE id=$1`,
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
      conflicts,
      issues: results
        .filter((r) => r.outcome === 'failed')
        .slice(0, 200)
        .map((r) => ({ title: r.title, library: r.details?.library, reason: r.reason })),
      scannedLibraries,
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
        incompleteSeries.length || conflicts ? 'warn' : 'info',
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

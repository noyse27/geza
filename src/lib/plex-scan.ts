import { isDemo } from './demo-mode';
import { logEvent } from './logging';
import { pool } from './db';
import { getSetting, setSetting } from './settings';
import { plexRequest, ensurePlexMedia, plexIds, syncPlexUserRating } from './plex';
import { loadTombstones, forgetTombstones } from './rumpel';
import { prepareMetadataMerge, fromPlex } from './providers';
import { resolvePlexEpisodes } from './plex-episodes';
import { reportProgress, saveJobResults, type JobResult } from './job-history';
import { plexServerScope } from './plex-decisions';
import { getPlexRestoreContext, queuePlexRestore, plexWatched as seen } from './plex-watch-restore';

type Metadata = Record<string, any>;
type Entry = {
  item: Metadata;
  library: string;
  automatic: boolean;
  episodes?: Metadata[];
  seasons?: Metadata[];
  incomplete?: boolean;
  issue?: string;
};

export async function plexList(
  path: string,
  read: (path: string) => Promise<any> = plexRequest,
  allowDuplicateRatingKeys = false,
): Promise<Metadata[]> {
  const result: Metadata[] = [];
  let expectedTotal: number | undefined;
  const ratingKeys = new Set<string>();
  for (let offset = 0; ;) {
    const data = await read(
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
        if (!allowDuplicateRatingKeys && ratingKeys.has(key))
          throw Error('Doppelte Plex-Seite; Bestand bleibt unverändert');
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
async function readScanEntries(
  sections: Metadata[],
  automatic: boolean,
  read: (path: string) => Promise<any>,
) {
  const entries: Entry[] = [];
  const incompleteSeries: { title: string; library: string; ratingKey: string; issues: Metadata[] }[] = [];
  for (const section of sections) {
    await reportProgress(`Bibliothek „${section.title}“ lesen`, undefined, undefined, true);
    for (let item of await plexList(
      `/library/sections/${encodeURIComponent(section.key)}/all?includeGuids=1`,
      read,
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
        const details = await read(
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
      let seasons: Metadata[] | undefined;
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
          read,
        );
        const resolved = await resolvePlexEpisodes(item, leaves, async (key) => {
          const response = await read(`/library/metadata/${encodeURIComponent(key)}?includeGuids=1`);
          const records = response?.MediaContainer?.Metadata;
          if (!Array.isArray(records)) throw Error(`Plex-Metadaten für Bibliotheksschlüssel ${key} fehlen`);
          return records.find((record: Metadata) => String(record.ratingKey) === key);
        });
        episodes = resolved.episodes;
        const seasonChildren = await plexList(
          `/library/metadata/${encodeURIComponent(item.ratingKey)}/children?includeGuids=1`,
          read,
        ).catch((error) => {
          if (/HTTP 404/.test(String(error?.message))) return [];
          throw error;
        });
        const seasonKeys = [
          ...new Set(
            [
              ...seasonChildren
                .filter((season) => season.type === 'season')
                .map((season) => season.ratingKey),
              ...episodes.map((episode) => episode.parentRatingKey),
            ].filter((key): key is string | number => key !== undefined && key !== null),
          ),
        ];
        seasons = [];
        for (const key of seasonKeys) {
          const response = await read(`/library/metadata/${encodeURIComponent(String(key))}?includeGuids=1`);
          const season = response?.MediaContainer?.Metadata?.find(
            (record: Metadata) => record.type === 'season' && String(record.ratingKey) === String(key),
          );
          if (season) seasons.push(season);
        }
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
        seasons,
        incomplete,
        issue,
      });
    }
  }
  return { entries, incompleteSeries };
}

export async function processPlexScan(payload: { manual?: boolean; preview?: boolean } = {}) {
  if (isDemo()) return;
  if ((await getSetting('PLEX_SCAN_ENABLED')) === '0' && !payload.manual) return;
  const connection = { url: await getSetting('PLEX_URL'), token: await getSetting('PLEX_TOKEN') };
  if (!connection.url || !connection.token) {
    if (payload.manual) throw Error('Plex ist nicht verbunden.');
    return;
  }
  const automatic = (await getSetting('PLEX_SCAN_WATCHED_ONLY')) !== '0';
  const scope = await plexServerScope();
  const purpose = payload.preview
    ? 'library-scan-preview'
    : payload.manual
      ? 'library-scan-manual'
      : 'library-scan-daily';
  const read = (path: string) => plexRequest(path, { connection, purpose });
  const restoreContext = await getPlexRestoreContext();
  let watchedRestores = 0;
  const filter = (await getSetting('PLEX_SCAN_SECTIONS')).split(',').filter(Boolean);
  const data = await read('/library/sections');
  if (!Array.isArray(data?.MediaContainer?.Directory))
    throw Error('Plex-Bibliotheken konnten nicht gelesen werden');
  const sections = data.MediaContainer.Directory.filter(
    (s: Metadata) => ['movie', 'show'].includes(s.type) && (!filter.length || filter.includes(String(s.key))),
  );
  if (!sections.length)
    throw Error(
      'Keine ausgewählte Film- oder Serienbibliothek verfügbar. Bitte die Bibliotheksauswahl prüfen; der Bestand bleibt unverändert.',
    );
  const { entries, incompleteSeries } = await readScanEntries(sections, automatic, read);
  const accountId = await getSetting('PLEX_ACCOUNT_ID');
  const previousHistorySync = Number(await getSetting('PLEX_HISTORY_SYNCED_AT'));
  const historyStartedAt = Math.floor(Date.now() / 1000);
  const historyPath = new URLSearchParams({
    ...(accountId ? { accountID: accountId } : {}),
    sort: 'viewedAt:asc',
    ...(Number.isSafeInteger(previousHistorySync) && previousHistorySync > 0
      ? { viewedAt: `>=${Math.max(1, previousHistorySync - 300)}` }
      : {}),
  });
  let history: Metadata[] = [];
  let historyComplete = false;
  if (accountId)
    try {
      history = await plexList(`/status/sessions/history/all?${historyPath}`, read, true);
      historyComplete = true;
    } catch (error) {
      await logEvent('warn', 'plex-scan', 'Plex-Wiedergabehistorie konnte nicht abgeglichen werden', {
        error,
      });
    }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout=120000');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    await client.query("SET LOCAL geza.skip_rumpel='on'");
    const merge = await prepareMetadataMerge(client);
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
    const reconciledAt = new Date().toISOString();
    const touchedShows = new Set<string>();
    const plexMedia = new Map<string, string>();
    for (const {
      item,
      library,
      automatic: auto,
      episodes,
      seasons: plexSeasons,
      incomplete,
      issue,
    } of entries) {
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
        const id = await ensurePlexMedia(item, undefined, client, scope);
        if (item.ratingKey != null) plexMedia.set(String(item.ratingKey), id);
        if (item.type === 'show') touchedShows.add(id);
        entryRootId = id;
        await merge(id, fromPlex(item));
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
          for (const episode of episodes) {
            const leaves = seasons.get(episode.parentIndex) || [];
            leaves.push(episode);
            seasons.set(episode.parentIndex, leaves);
          }
          for (const [number, leaves] of seasons) {
            const plexSeason = plexSeasons?.find((season) => Number(season.index) === number);
            const sid = await ensurePlexMedia(
              plexSeason || { type: 'season', index: number, title: `Staffel ${number}` },
              id,
              client,
              scope,
            );
            if (plexSeason) await syncPlexUserRating(sid, plexSeason.userRating, reconciledAt, false, client);
            remember(sid, library, leaves.some(seen), auto);
            for (const episode of leaves) {
              const eid = await ensurePlexMedia(episode, id, client, scope);
              if (episode.ratingKey != null) plexMedia.set(String(episode.ratingKey), eid);
              remember(eid, library, seen(episode), false);
              if (
                seen(episode) &&
                episode.ratingKey != null &&
                typeof episode.lastViewedAt === 'number' &&
                Number.isFinite(episode.lastViewedAt)
              ) {
                await client.query(
                  `INSERT INTO watches(media_id,source,source_id,watched_at,time_estimated)
                   VALUES($1,'plex-scan',$2,to_timestamp($3),false)
                   ON CONFLICT(source,source_id) DO NOTHING`,
                  [eid, `plex-scan:${episode.ratingKey}:${episode.lastViewedAt}`, episode.lastViewedAt],
                );
              }
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
    const historyRows = history.flatMap((entry) => {
      const mediaId = entry.ratingKey == null ? undefined : plexMedia.get(String(entry.ratingKey));
      const viewedAt = Number(entry.viewedAt);
      if (!mediaId || !Number.isSafeInteger(viewedAt) || viewedAt <= 0) return [];
      const sourceId = entry.historyKey
        ? String(entry.historyKey)
        : `${entry.accountID || accountId}:${entry.ratingKey}:${viewedAt}`;
      return [
        { media_id: mediaId, source_id: sourceId, watched_at: new Date(viewedAt * 1000).toISOString() },
      ];
    });
    for (let start = 0; start < historyRows.length; start += 1000)
      await client.query(
        `INSERT INTO watches(media_id,source,source_id,watched_at,time_estimated)
         SELECT media_id,'plex-history',source_id,watched_at,false
         FROM jsonb_to_recordset($1::jsonb) AS h(media_id bigint,source_id text,watched_at timestamptz)
         ON CONFLICT(source,source_id) DO NOTHING`,
        [JSON.stringify(historyRows.slice(start, start + 1000))],
      );
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
    if (touchedShows.size) await client.query('SELECT refresh_season_completions($1)', [[...touchedShows]]);
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
      const completedResults: JobResult[] = [];
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
        completedResults.push(result);
      }
      // Include titles whose destination changed because they disappeared from Plex.
      for (const change of changes)
        if (!recorded.has(change.id) && ['movie', 'show'].includes(change.kind))
          completedResults.push({
            mediaId: change.id,
            title: change.title,
            outcome: change.before === 'Neu' ? 'new' : 'updated',
            destination: change.after,
            reason: change.assignment_reason,
          });
      await saveJobResults(completedResults, client);
      await client.query(
        `INSERT INTO jobs(kind,dedupe_key,payload) SELECT 'enrich','enrich:'||id,jsonb_build_object('mediaId',id) FROM media
        WHERE id=ANY($1::bigint[]) AND kind IN ('movie','show') AND enriched_at IS NULL ON CONFLICT(dedupe_key) DO NOTHING`,
        [[...matches.keys()]],
      );
      await client.query('COMMIT');
      if (historyComplete)
        await setSetting('PLEX_HISTORY_SYNCED_AT', String(historyStartedAt)).catch((error) =>
          logEvent(
            'warn',
            'plex-scan',
            'Checkpoint der Plex-Wiedergabehistorie konnte nicht gespeichert werden',
            {
              error,
            },
          ),
        );
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

import { query } from './db';
import { logEvent } from './logging';
import { getSetting, setSetting } from './settings';
import { saveJobResult } from './job-history';
import { recordFeedEntrySafely } from './feed';
import {
  plexIds,
  plexRequest,
  queueEnrich,
  resolvePlexMetadata,
  syncPlexReview,
  syncPlexUserRating,
} from './plex';

type Metadata = Record<string, any>;

export const PLEX_SYNC_INTERVAL_MINUTES = 15;
/** Overlap with the previous run so events written by Plex shortly before the cursor are not missed. */
const OVERLAP_SECONDS = 300;
/** First run without a cursor catches up on the last week. */
const INITIAL_LOOKBACK_SECONDS = 7 * 86400;
/** A Plex view that is already in Geza (e.g. from a webhook) within this window is not added again. */
const SAME_VIEW_WINDOW = '15 minutes';
const PAGE_SIZE = 100;

export async function plexSyncEnabled() {
  return (
    (await getSetting('PLEX_SYNC_ENABLED')) !== '0' &&
    !!(await getSetting('PLEX_URL')) &&
    !!(await getSetting('PLEX_TOKEN')) &&
    !!(await getSetting('PLEX_ACCOUNT_ID'))
  );
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

async function* pages(path: string, purpose: string) {
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const container = (
      await plexRequest(
        `${path}${path.includes('?') ? '&' : '?'}X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${PAGE_SIZE}`,
        { purpose },
      )
    )?.MediaContainer;
    const items: Metadata[] = container?.Metadata || [];
    yield items;
    const total = Number(container?.totalSize);
    if (items.length < PAGE_SIZE || (Number.isFinite(total) && offset + items.length >= total)) return;
  }
}

/**
 * Safety net for missing Plex webhooks: imports recent views from the Plex history and recent
 * ratings (with their reviews) from the libraries, using the same processing as the webhook.
 */
export async function processPlexSync() {
  if (!(await plexSyncEnabled())) return;
  const accountId = await getSetting('PLEX_ACCOUNT_ID');
  const startedAt = Math.floor(Date.now() / 1000);
  const cursor = Number(await getSetting('PLEX_SYNC_AT'));
  const since =
    (Number.isSafeInteger(cursor) && cursor > 0 ? cursor : startedAt - INITIAL_LOOKBACK_SECONDS) -
    OVERLAP_SECONDS;
  const views = await syncViews(accountId, since);
  const ratings = await syncRatings(since);
  await setSetting('PLEX_SYNC_AT', String(startedAt));
  await logEvent('info', 'plex-sync', 'Plex-Abgleich ohne Webhook abgeschlossen', {
    since: iso(since),
    ...views,
    ...ratings,
  });
}

async function syncViews(accountId: string, since: number) {
  const params = new URLSearchParams({ accountID: accountId, sort: 'viewedAt:asc', viewedAt: `>=${since}` });
  let added = 0;
  let failed = 0;
  for await (const page of pages(`/status/sessions/history/all?${params}`, 'plex-sync-history'))
    for (const entry of page) {
      const viewedAt = Number(entry.viewedAt);
      if (!entry.ratingKey || !['movie', 'episode'].includes(entry.type)) continue;
      if (!Number.isSafeInteger(viewedAt) || viewedAt < since) continue;
      try {
        const { id, m, parent } = await resolvePlexMetadata({
          ratingKey: entry.ratingKey,
          type: entry.type,
          title: entry.title,
          parentRatingKey: entry.parentRatingKey,
          grandparentRatingKey: entry.grandparentRatingKey,
        });
        const sourceId = entry.historyKey
          ? String(entry.historyKey)
          : `${entry.accountID || accountId}:${entry.ratingKey}:${viewedAt}`;
        const inserted = await query(
          `INSERT INTO watches(media_id,source,source_id,watched_at,time_estimated)
           SELECT $1,'plex-history',$2,$3,false
           WHERE NOT EXISTS(SELECT 1 FROM watches WHERE media_id=$1
             AND watched_at BETWEEN $3::timestamptz-interval '${SAME_VIEW_WINDOW}'
                                AND $3::timestamptz+interval '${SAME_VIEW_WINDOW}')
           ON CONFLICT(source,source_id) DO NOTHING RETURNING id`,
          [id, sourceId, iso(viewedAt)],
        );
        if (!inserted.length) continue;
        added++;
        if (m.type === 'episode' && parent) await query('SELECT refresh_season_completions($1)', [[parent]]);
        if (m.type === 'movie')
          await syncPlexReview(id, plexIds(m).plex).catch((error) =>
            logEvent('warn', 'plex-sync', 'Review konnte nicht synchronisiert werden', {
              mediaId: id,
              error,
            }),
          );
        await queueEnrich(id);
        await saveJobResult({
          mediaId: id,
          title: m.title || entry.title || 'Plex-Titel',
          outcome: 'new',
          reason: 'Sichtung aus der Plex-Wiedergabehistorie übernommen (ohne Webhook).',
        });
      } catch (error) {
        failed++;
        await saveJobResult({
          title: entry.title || `Plex-Titel ${entry.ratingKey}`,
          outcome: 'failed',
          reason: `Sichtung konnte nicht übernommen werden: ${(error as Error).message}`,
        });
      }
    }
  return { viewsAdded: added, viewsFailed: failed };
}

async function syncRatings(since: number) {
  const sections = (await plexRequest('/library/sections', { purpose: 'plex-sync-ratings' }))?.MediaContainer
    ?.Directory;
  if (!Array.isArray(sections)) throw Error('Plex-Bibliotheken konnten nicht gelesen werden');
  let updated = 0;
  let failed = 0;
  for (const section of sections) {
    const types = section.type === 'movie' ? [1] : section.type === 'show' ? [2, 4] : [];
    for (const type of types) {
      const path = `/library/sections/${encodeURIComponent(section.key)}/all?type=${type}&includeGuids=1&sort=lastRatedAt:desc`;
      let previous = Infinity;
      let done = false;
      for await (const page of pages(path, 'plex-sync-ratings')) {
        for (const item of page) {
          const ratedAt = Number(item.lastRatedAt);
          if (!Number.isSafeInteger(ratedAt) || ratedAt < since) {
            done = true;
            break;
          }
          if (ratedAt > previous) {
            // Plex ignored the sort order; reading the whole library every 15 minutes is too costly.
            await logEvent('warn', 'plex-sync', 'Plex liefert Bewertungen nicht nach Datum sortiert', {
              section: section.title,
            });
            done = true;
            break;
          }
          previous = ratedAt;
          if (item.userRating === undefined) continue;
          try {
            if (await applyRating(item, ratedAt)) updated++;
          } catch (error) {
            failed++;
            await saveJobResult({
              title: item.title || `Plex-Titel ${item.ratingKey}`,
              outcome: 'failed',
              reason: `Bewertung konnte nicht übernommen werden: ${(error as Error).message}`,
            });
          }
        }
        if (done) break;
      }
    }
  }
  return { ratingsUpdated: updated, ratingsFailed: failed };
}

async function applyRating(item: Metadata, ratedAt: number) {
  const { id, m } = await resolvePlexMetadata(item);
  const rating = Number(m.userRating ?? item.userRating);
  const [current] = await query<{ rating: number; rated_at: string }>(
    'SELECT rating,rated_at FROM ratings WHERE media_id=$1',
    [id],
  );
  // Already known (from a webhook or an earlier run), or rated in Geza after Plex.
  if (current && new Date(current.rated_at).getTime() >= ratedAt * 1000) return false;
  await syncPlexUserRating(id, rating, iso(ratedAt), true);
  await syncPlexReview(id, plexIds(m).plex).catch((error) =>
    logEvent('warn', 'plex-sync', 'Bewertung gespeichert, Review konnte nicht synchronisiert werden', {
      mediaId: id,
      error,
    }),
  );
  await recordFeedEntrySafely(id);
  await queueEnrich(id);
  await saveJobResult({
    mediaId: id,
    title: m.title || 'Plex-Titel',
    outcome: 'updated',
    reason: 'Bewertung aus Plex übernommen (ohne Webhook).',
  });
  return true;
}

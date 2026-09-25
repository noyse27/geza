import { isDemo } from './demo-mode';
import { readdir, readFile } from 'node:fs/promises';
import { pool } from './db';
import { watchedTime } from './security';
import { loadTombstones, forgetTombstones } from './rumpel';
import { getSetting } from './settings';
import { requestPlexScan } from './plex-jobs';
type Raw = Record<string, any>; // Trakt export has heterogeneous resource envelopes; only whitelisted fields are persisted.
export async function importTrakt(
  directory: string,
  options: { collectionWishes?: boolean; preview?: boolean } = {},
) {
  const files = (await readdir(directory)).filter((f) =>
    /^(watched-history-|watched-movies-|watched-shows-|ratings-|comments-|collection-|watchlist).*\.json$/.test(
      f,
    ),
  );
  const media = new Map<string, Raw>(),
    history: Raw[] = [],
    ratings: Raw[] = [],
    reviews: Raw[] = [],
    // Collection and Watchlist are not evidence of a viewing.
    active = new Set<string>();
  let currentFile = '';
  function add(kind: string, raw: Raw, parent?: string): string | undefined {
    if (!raw?.ids?.trakt) return;
    const key = `${kind}:${raw.ids.trakt}`;
    const ids = { ...raw.ids };
    delete ids.slug;
    if (typeof ids.plex === 'object') ids.plex = ids.plex?.guid;
    Object.keys(ids).forEach((k) => {
      if (ids[k] == null) delete ids[k];
    });
    const previous = media.get(key);
    const origin = currentFile.startsWith('collection-') ? 'trakt-collection' : 'trakt';
    media.set(key, {
      kind,
      trakt_id: raw.ids.trakt,
      title: raw.title || (kind === 'season' ? `Staffel ${raw.number}` : `Episode ${raw.number}`),
      year: raw.year || null,
      ids,
      parent: parent || null,
      season: kind === 'season' ? raw.number : (raw.season ?? null),
      episode: kind === 'episode' ? raw.number : null,
      origins: [
        ...new Set([
          ...(previous?.origins || []),
          origin,
          ...(origin === 'trakt-collection' && options.collectionWishes ? ['collection-wish'] : []),
        ]),
      ],
      seen_sources: previous?.seen_sources || [],
    });
    return key;
  }
  for (const file of files) {
    currentFile = file;
    const rows = JSON.parse((await readFile(`${directory}/${file}`, 'utf8')).replace(/^\uFEFF/, ''));
    if (!Array.isArray(rows)) throw new Error(`Unerwartetes Exportformat: ${file}`);
    for (const r of rows) {
      const show = r.show ? add('show', r.show) : undefined;
      const kind =
        r.type || (r.movie ? 'movie' : r.episode ? 'episode' : r.season ? 'season' : r.show ? 'show' : null);
      const key = kind === 'show' ? show : kind ? add(kind, r[kind], show) : undefined;
      if (!key) continue;
      if (file.startsWith('watchlist'))
        media.get(key)!.origins = [...new Set([...media.get(key)!.origins, 'trakt-watchlist'])];
      if (!file.startsWith('collection-') && !file.startsWith('watchlist')) active.add(key);
      if (file.startsWith('watched-movies-') || file.startsWith('watched-shows-')) {
        media.get(key)!.seen_sources = ['trakt'];
      }
      // Summary exports nest seasons/episodes and frequently omit provider IDs on children.
      if (show && Array.isArray(r.seasons)) {
        for (const s of r.seasons) {
          if (!Number.isInteger(s.number) || s.number < 0) throw Error('Ungültige Trakt-Staffelnummer');
          const skey = `season:${show}:${s.number}`;
          const prior = media.get(skey);
          media.set(skey, {
            kind: 'season',
            title: `Staffel ${s.number}`,
            ids: {},
            parent: show,
            season: s.number,
            episode: null,
            origins: [...new Set([...(prior?.origins || []), 'trakt'])],
            seen_sources: prior?.seen_sources || [],
          });
          for (const e of s.episodes || []) {
            if (!Number.isInteger(e.number) || e.number < 0) throw Error('Ungültige Trakt-Episodennummer');
            const ekey = `episode:${show}:${s.number}:${e.number}`;
            const ep = media.get(ekey);
            media.set(ekey, {
              kind: 'episode',
              title: `Episode ${e.number}`,
              ids: {},
              parent: show,
              season: s.number,
              episode: e.number,
              origins: ['trakt'],
              seen_sources:
                file.startsWith('watched-') && Number(e.plays ?? 1) > 0 ? ['trakt'] : ep?.seen_sources || [],
            });
          }
        }
      }
      if (file.startsWith('watched-history-'))
        history.push({
          key,
          source_id: String(r.id),
          watched_at: watchedTime(r.watched_at),
          original_watched_at: r.watched_at,
        });
      if (file.startsWith('ratings-')) ratings.push({ key, rating: r.rating, rated_at: r.rated_at });
      if (file.startsWith('comments-') && r.comment)
        reviews.push({
          key,
          source_id: String(r.comment.id),
          body: r.comment.comment,
          spoiler: !!r.comment.spoiler,
          parent_source_id: r.comment.parent_id ? String(r.comment.parent_id) : null,
          created_at: r.comment.created_at,
          updated_at: r.comment.updated_at,
        });
    }
  }
  if (isDemo() || options.preview)
    return {
      files: files.length,
      media: media.size,
      watches: history.length,
      unknownDates: history.filter((r) => !r.watched_at).length,
      ratings: ratings.length,
      reviews: reviews.length,
      providerCollisions: [],
      dryRun: true,
    };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout=0');
    await client.query('SELECT pg_advisory_xact_lock(729383)');
    // Die Rumpelkammer-Zuordnung wird einmal am Ende neu berechnet statt pro Zeile.
    await client.query("SET LOCAL geza.skip_rumpel='on'");
    const run = (await client.query('INSERT INTO import_runs DEFAULT VALUES RETURNING id')).rows[0].id;
    // In der Rumpelkammer gelöschte Titel nicht erneut anlegen, außer die Datei belegt jetzt Aktivität.
    const tombstones = await loadTombstones(client);
    const rootOf = (key: string) => {
      let k = key;
      for (let i = 0; i < 5 && media.get(k)?.parent; i++) k = media.get(k)!.parent;
      return k;
    };
    const activeRoots = new Set([...active].map(rootOf));
    const skippedRoots = new Set<string>(),
      forgotten: number[] = [];
    for (const [key, entry] of media) {
      if (entry.kind !== 'movie' && entry.kind !== 'show') continue;
      const hits = tombstones.matches(entry.kind, { ...entry.ids, trakt: entry.trakt_id });
      if (!hits.length) continue;
      if (activeRoots.has(key)) forgotten.push(...hits);
      else skippedRoots.add(key);
    }
    if (skippedRoots.size)
      for (const key of [...media.keys()]) if (skippedRoots.has(rootOf(key))) media.delete(key);
    await forgetTombstones(forgotten, client);
    const idMap = new Map<string, string>();
    const index = new Map<string, Set<Raw>>();
    const existingRows = (
      await client.query('SELECT id,kind,trakt_id,ids,parent_id,season,episode FROM media')
    ).rows;
    const existingById = new Map(existingRows.map((r) => [r.id, r]));
    const seriesParent = (r: Raw) =>
      existingById.get(r.parent_id)?.kind === 'season'
        ? existingById.get(r.parent_id)!.parent_id
        : r.parent_id;
    const keys = (r: Raw) => [
      ...Object.entries(r.ids || {})
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${r.kind}:${k}:${v}`),
      ...(r.trakt_id ? [`${r.kind}:trakt:${r.trakt_id}`] : []),
      ...(r.parent_id && ['season', 'episode'].includes(r.kind)
        ? [`${r.kind}:parent:${seriesParent(r)}:${r.season}:${r.kind === 'episode' ? r.episode : ''}`]
        : []),
    ];
    const remember = (r: Raw) => {
      for (const key of keys(r)) index.set(key, (index.get(key) || new Set()).add(r));
    };
    for (const row of existingRows) remember(row);
    const entries = [...media.entries()].sort((a, b) => Number(!!a[1].parent) - Number(!!b[1].parent));
    for (const [key, entry] of entries) {
      const parent = entry.parent ? idMap.get(entry.parent) : null;
      if (entry.parent && !parent) throw Error('Trakt-Elternzuordnung fehlt');
      let found = [
        ...new Set(keys({ ...entry, parent_id: parent }).flatMap((key) => [...(index.get(key) || [])])),
      ];
      if (entry.trakt_id) {
        const exact = found.filter((r) => String(r.trakt_id) === String(entry.trakt_id));
        // Conflicting Trakt identities must remain separate, even if an export shares a Plex GUID.
        found = exact.length ? exact : found.filter((r) => r.trakt_id == null);
      }
      if (found.length > 1)
        throw Error(`Mehrdeutige Medienzuordnung: ${entry.title}. Bitte Provider-IDs prüfen.`);
      let id = found[0]?.id;
      if (!id)
        id = (
          await client.query(
            `INSERT INTO media(kind,trakt_id,title,year,ids,parent_id,season,episode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [
              entry.kind,
              entry.trakt_id || null,
              entry.title,
              entry.year || null,
              JSON.stringify(entry.ids),
              parent,
              entry.season,
              entry.episode,
            ],
          )
        ).rows[0].id;
      await client.query(
        `UPDATE media SET trakt_id=COALESCE(trakt_id,$2),ids=ids||$3::jsonb,
        origins=ARRAY(SELECT DISTINCT unnest(origins||$4::text[])),seen_sources=ARRAY(SELECT DISTINCT unnest(seen_sources||$5::text[])),
        parent_id=CASE WHEN 'parent_id'=ANY(locked_fields) THEN parent_id ELSE COALESCE(parent_id,$6) END WHERE id=$1`,
        [id, entry.trakt_id || null, JSON.stringify(entry.ids), entry.origins, entry.seen_sources, parent],
      );
      idMap.set(key, id);
      const indexed = found[0] || { ...entry, id, parent_id: parent };
      indexed.ids = { ...indexed.ids, ...entry.ids };
      indexed.trakt_id ||= entry.trakt_id;
      remember(indexed);
    }
    for (let i = 0; i < history.length; i += 1000)
      await client.query(
        `INSERT INTO watches(media_id,source,source_id,watched_at,original_watched_at)
   SELECT media_id,'trakt',source_id,watched_at,original_watched_at FROM jsonb_to_recordset($1::jsonb) AS x(media_id bigint,source_id text,watched_at timestamptz,original_watched_at text)
   ON CONFLICT(source,source_id) DO NOTHING`,
        [JSON.stringify(history.slice(i, i + 1000).map((r) => ({ ...r, media_id: idMap.get(r.key) })))],
      );
    await client.query(
      `INSERT INTO ratings(media_id,rating,rated_at,source) SELECT media_id,rating,rated_at,'trakt' FROM jsonb_to_recordset($1::jsonb) AS x(media_id bigint,rating integer,rated_at timestamptz)
   ON CONFLICT(media_id) DO UPDATE SET rating=excluded.rating,rated_at=excluded.rated_at,source='trakt' WHERE ratings.rated_at<excluded.rated_at`,
      [JSON.stringify(ratings.map((r) => ({ ...r, media_id: idMap.get(r.key) })))],
    );
    await client.query(
      `INSERT INTO reviews(media_id,source,source_id,body,spoiler,parent_source_id,created_at,updated_at)
   SELECT media_id,'trakt',source_id,body,spoiler,parent_source_id,created_at,updated_at FROM jsonb_to_recordset($1::jsonb) AS x(media_id bigint,source_id text,body text,spoiler boolean,parent_source_id text,created_at timestamptz,updated_at timestamptz)
   ON CONFLICT(source,source_id) DO NOTHING`,
      [JSON.stringify(reviews.map((r) => ({ ...r, media_id: idMap.get(r.key) })))],
    );
    const collisions = (
      await client.query(
        "SELECT kind,ids->>'plex' AS plex,count(*)::int AS count FROM media WHERE ids ? 'plex' GROUP BY kind,ids->>'plex' HAVING count(*)>1",
      )
    ).rows;
    await client.query('SELECT rumpel_refresh(NULL)');
    const rumpel = (
      await client.query("SELECT count(*)::int AS n FROM media WHERE rumpel AND kind IN ('movie','show')")
    ).rows[0].n;
    const report = {
      files: files.length,
      media: media.size,
      watches: history.length,
      unknownDates: history.filter((r) => !r.watched_at).length,
      ratings: ratings.length,
      reviews: reviews.length,
      providerCollisions: collisions,
      rumpel,
      skippedDeleted: skippedRoots.size,
    };
    await client.query('UPDATE import_runs SET finished_at=clock_timestamp(),report=$1 WHERE id=$2', [
      JSON.stringify(report),
      run,
    ]);
    await client.query('COMMIT');
    let plexFollowup = 'not-configured';
    try {
      if ((await getSetting('PLEX_URL')) && (await getSetting('PLEX_TOKEN'))) {
        await requestPlexScan();
        plexFollowup = 'queued';
      }
    } catch {
      plexFollowup = 'failed-to-queue';
    }
    await client.query('ANALYZE media');
    await client.query('ANALYZE watches');
    return { ...report, plexFollowup };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

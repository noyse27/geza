import { pool, query } from './db';
import { getSetting } from './settings';
import { loggedFetch } from './logging';
import { mergeMetadata } from './providers';
import { isDemo } from './demo-mode';

type Raw = Record<string, any>;
const number = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export async function catalogShow(mediaId: string) {
  return (
    await query(
      `SELECT s.* FROM media m JOIN media s ON s.id=CASE WHEN m.kind='show' THEN m.id ELSE m.parent_id END
    WHERE m.id=$1 AND s.kind='show'`,
      [mediaId],
    )
  )[0];
}

export async function syncSeriesCatalog(mediaId: string) {
  if (isDemo()) throw Error('Externe Katalogabfragen sind in der Demo deaktiviert.');
  const show = await catalogShow(mediaId);
  if (!show) throw Error('Keine zugehörige Serie gefunden.');
  const token = await getSetting('TMDB_TOKEN');
  if (!token) throw Error('Zum Ergänzen der Staffeln und Episoden bitte TMDB im Adminbereich einrichten.');
  const read = async (path: string) => {
    const response = await loggedFetch('TMDB', `https://api.themoviedb.org/3/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    });
    return response.json();
  };
  let tmdbId = show.ids.tmdb;
  if (!tmdbId) {
    const provider = show.ids.imdb ? 'imdb' : show.ids.tvdb ? 'tvdb' : null;
    if (provider) {
      const found = await read(
        `find/${encodeURIComponent(show.ids[provider])}?external_source=${provider}_id`,
      );
      if (found.tv_results?.length === 1) tmdbId = found.tv_results[0].id;
    }
  }
  if (!/^\d+$/.test(String(tmdbId))) throw Error('Für diese Serie fehlt eine eindeutige TMDB-Zuordnung.');
  const details = await read(`tv/${tmdbId}?language=de-DE`);
  if (String(details.id) !== String(tmdbId) || !Array.isArray(details.seasons))
    throw Error('Unvollständiger Serienkatalog.');
  const seasons: Raw[] = [];
  for (const entry of details.seasons) {
    if (!number(entry.season_number)) throw Error('Ungültige Staffelnummer im Serienkatalog.');
    const season = await read(`tv/${tmdbId}/season/${entry.season_number}?language=de-DE`);
    if (
      season.season_number !== entry.season_number ||
      !Array.isArray(season.episodes) ||
      (number(entry.episode_count) && entry.episode_count !== season.episodes.length) ||
      season.episodes.some((e: Raw) => !number(e.episode_number) || e.season_number !== entry.season_number)
    )
      throw Error('Unvollständiger Episodenkatalog.');
    seasons.push(season);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize catalog refreshes with other structural operations on this series.
    if (!(await client.query('SELECT id FROM media WHERE id=$1 FOR UPDATE', [show.id])).rowCount)
      throw Error('Die Serie wurde inzwischen gelöscht.');
    await client.query("SET LOCAL geza.skip_rumpel='on'");
    const save = async (kind: 'season' | 'episode', raw: Raw, season: number) => {
      if (!number(raw.id) || raw.id === 0) throw Error('Provider-ID im Serienkatalog fehlt.');
      const matches = (
        await client.query(
          `SELECT id,ids,locked_fields,parent_id,season,episode FROM media WHERE kind=$1 AND
        ((ids->>'tmdb')=$2 OR ((parent_id=$3 OR parent_id IN (SELECT id FROM media WHERE kind='season' AND parent_id=$3))
          AND season=$4 AND ($1='season' OR episode=$5))) ORDER BY id`,
          [kind, String(raw.id), show.id, season, kind === 'episode' ? raw.episode_number : null],
        )
      ).rows;
      if (matches.length > 1)
        throw Error(`Mehrdeutige Zuordnung für Staffel ${season}; bitte Datensätze prüfen.`);
      let id = matches[0]?.id;
      if (
        id &&
        matches[0].locked_fields.some((field: string) => ['parent_id', 'season', 'episode'].includes(field))
      )
        return;
      if (id) {
        if (matches[0].ids.tmdb && String(matches[0].ids.tmdb) !== String(raw.id))
          throw Error('Staffel-/Episodennummer und vorhandene TMDB-ID widersprechen sich.');
        const valid = (
          await client.query(
            `SELECT 1 FROM media WHERE id=$1 AND (parent_id=$2 OR parent_id IN
          (SELECT id FROM media WHERE kind='season' AND parent_id=$2)) AND season=$3 AND ($4='season' OR episode=$5)`,
            [id, show.id, season, kind, raw.episode_number ?? null],
          )
        ).rowCount;
        if (!valid) throw Error('Provider-ID gehört zu einer anderen Serienzuordnung.');
      } else {
        id = (
          await client.query(
            `INSERT INTO media(kind,title,parent_id,season,episode) VALUES($1,$2,$3,$4,$5) RETURNING id`,
            [
              kind,
              raw.name || (kind === 'season' ? `Staffel ${season}` : `Episode ${raw.episode_number}`),
              show.id,
              season,
              kind === 'episode' ? raw.episode_number : null,
            ],
          )
        ).rows[0].id;
      }
      await client.query(
        "UPDATE media SET ids=ids||jsonb_build_object('tmdb',$2::text),air_date=$3 WHERE id=$1",
        [id, String(raw.id), /^\d{4}-\d{2}-\d{2}$/.test(raw.air_date || '') ? raw.air_date : null],
      );
      await mergeMetadata(
        id,
        {
          title: raw.name,
          summary: raw.overview,
          year: Number((raw.air_date || '').slice(0, 4)) || undefined,
          runtime: raw.runtime,
          poster:
            raw.poster_path || raw.still_path
              ? `https://image.tmdb.org/t/p/w342${raw.poster_path || raw.still_path}`
              : undefined,
        },
        'tmdb',
        client,
      );
    };
    for (const season of seasons) {
      await save('season', season, season.season_number);
      for (const episode of season.episodes) await save('episode', episode, season.season_number);
    }
    await client.query(
      "UPDATE media SET ids=ids||jsonb_build_object('tmdb',$2::text),catalog_checked_at=now() WHERE id=$1",
      [show.id, String(tmdbId)],
    );
    await client.query('SELECT rumpel_refresh($1::bigint[])', [[show.id]]);
    await client.query('COMMIT');
    return { seasons: seasons.length, episodes: seasons.reduce((n, s) => n + s.episodes.length, 0) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function queueSeriesCatalog(showId: string) {
  if (isDemo()) return false;
  if (!(await getSetting('TMDB_TOKEN'))) return false;
  await query(
    `INSERT INTO jobs(kind,dedupe_key,payload) VALUES('series-catalog',$1,jsonb_build_object('mediaId',$2::text))
    ON CONFLICT(dedupe_key) DO UPDATE SET status='pending',attempts=0,available_at=now(),updated_at=now()
    WHERE jobs.status IN ('done','failed') AND jobs.updated_at<now()-interval '1 day'`,
    ['series-catalog:' + showId, showId],
  );
  return true;
}

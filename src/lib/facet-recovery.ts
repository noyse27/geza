import { pool, query } from './db';
import { getSetting } from './settings';
import { plexRequest, plexIds, findPlex } from './plex';
import { plexList } from './plex-scan';
import { fromPlex, fetchRecoveryFacets } from './providers';
import { reprojectFacets } from './facets';
import { redact } from './logging';

type Media = Record<string, any>;
type Source = {
  countries?: string[];
  genres?: string[];
  source: string;
  sources?: Partial<Record<'countries' | 'genres', string>>;
};
export type FacetRecoveryLoader = (media: Media) => Promise<Source | null>;

export function plexRecoveryValues(items: Media[]) {
  const values = items.map(fromPlex);
  const result: Partial<Record<'countries' | 'genres', string[]>> = {};
  for (const field of ['countries', 'genres'] as const) {
    const nonempty = values.map((value) => value[field] as string[]).filter((list) => list.length);
    const signatures = new Set(nonempty.map((list) => JSON.stringify([...new Set(list)].sort())));
    if (signatures.size === 1) result[field] = nonempty[0];
  }
  return result;
}

export async function resumeFacetRecovery() {
  const client = await pool.connect();
  try {
    if ((await client.query('SELECT pg_try_advisory_lock(729384) AS acquired')).rows[0].acquired) {
      await client.query(
        "UPDATE jobs SET status='pending',available_at=now() WHERE dedupe_key='facet-recovery-v1' AND status='running'",
      );
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(729384)');
    client.release();
  }
}

async function recoveryLoader(): Promise<FacetRecoveryLoader> {
  const index = new Map<string, Media[]>();
  const connected = !!(await getSetting('PLEX_URL')) && !!(await getSetting('PLEX_TOKEN'));
  // Read the library in pages once, rather than issuing thousands of title searches.
  if (connected) {
    const sections = (await plexRequest('/library/sections'))?.MediaContainer?.Directory;
    if (!Array.isArray(sections)) throw Error('Plex-Bibliotheken konnten nicht gelesen werden.');
    for (const section of sections.filter((s: Media) => ['movie', 'show'].includes(s.type))) {
      for (const item of await plexList(
        `/library/sections/${encodeURIComponent(section.key)}/all?includeGuids=1`,
      )) {
        for (const [provider, id] of Object.entries(plexIds(item))) {
          const key = `${item.type}:${provider}:${id}`;
          index.set(key, [...(index.get(key) || []), item]);
        }
      }
    }
  }
  return async (media) => {
    let candidates = [
      ...new Set(
        Object.entries(media.ids).flatMap(
          ([provider, id]) => index.get(`${media.kind}:${provider}:${id}`) || [],
        ),
      ),
    ].filter((item) =>
      Object.entries(plexIds(item)).every(
        ([provider, id]) => provider === 'plex' || !media.ids[provider] || String(media.ids[provider]) === id,
      ),
    );
    const exact = candidates.filter(
      (item) => media.ids.plex && plexIds(item).plex === String(media.ids.plex),
    );
    if (exact.length) candidates = exact;
    if (!candidates.length && connected && !['movie', 'show'].includes(media.kind)) {
      const item = await findPlex(media.ids, media.kind);
      if (
        item &&
        Object.entries(plexIds(item)).every(
          ([provider, id]) =>
            provider === 'plex' || !media.ids[provider] || String(media.ids[provider]) === id,
        )
      )
        candidates = [item];
    }
    const values = plexRecoveryValues(candidates);
    if (values && (values.countries?.length || values.genres?.length)) {
      let fallback: Awaited<ReturnType<typeof fetchRecoveryFacets>> = null;
      if (
        (media.original_countries === null && !values.countries?.length) ||
        (media.original_genres === null && !values.genres?.length)
      ) {
        try {
          fallback = await fetchRecoveryFacets(media);
        } catch {
          /* Keep independently verified Plex fields. */
        }
      }
      return {
        countries: values.countries?.length ? values.countries : fallback?.countries,
        genres: values.genres?.length ? values.genres : fallback?.genres,
        source: 'plex',
        sources: {
          countries: values.countries?.length ? 'plex' : fallback?.source,
          genres: values.genres?.length ? 'plex' : fallback?.source,
        },
      };
    }
    return fetchRecoveryFacets(media);
  };
}

export async function processFacetRecovery(jobId: string, load?: FacetRecoveryLoader) {
  const guard = await pool.connect();
  try {
    // Session lock prevents duplicate workers from running the same resumable migration.
    if (!(await guard.query('SELECT pg_try_advisory_lock(729384) AS acquired')).rows[0].acquired)
      throw Error('Die Wiederherstellung läuft bereits.');
    const [job] = await query('SELECT * FROM jobs WHERE id=$1 AND dedupe_key=$2', [
      jobId,
      'facet-recovery-v1',
    ]);
    if (!job || job.status === 'done') return;
    let payload = { ...job.payload };
    const upperBound = String(payload.upperBound);
    if (payload.phase !== 'aliases') {
      const loader = load || (await recoveryLoader());
      for (;;) {
        const rows = await query(
          `SELECT * FROM media WHERE id>$1 AND id<=$2 AND
          (original_countries IS NULL OR original_genres IS NULL) ORDER BY id LIMIT 100`,
          [payload.cursor || '0', upperBound],
        );
        if (!rows.length) break;
        for (const media of rows) {
          let source: Source | null = null,
            note = '';
          try {
            source = await loader(media);
          } catch (error) {
            note = String(redact((error as Error).message)).slice(0, 250);
          }
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(729383)');
            const current = (await client.query('SELECT * FROM media WHERE id=$1 FOR UPDATE', [media.id]))
              .rows[0];
            if (current) {
              const sameIdentity =
                current.kind === media.kind && JSON.stringify(current.ids) === JSON.stringify(media.ids);
              const missing: string[] = [];
              for (const field of ['countries', 'genres'] as const) {
                if (current[`original_${field}`] !== null) continue;
                const raw = source?.[field]
                  ?.filter((value) => typeof value === 'string' && value.trim())
                  .map((value) => value.trim());
                if (sameIdentity && raw?.length && !current.locked_fields.includes(field)) {
                  await client.query(
                    `UPDATE media SET original_${field}=$2,field_sources=field_sources||jsonb_build_object($3::text,$4::text) WHERE id=$1`,
                    [media.id, raw, field, source!.sources?.[field] || source!.source],
                  );
                } else missing.push(field === 'countries' ? 'Länder' : 'Genres');
              }
              await client.query('UPDATE media SET facet_recovery_note=$2 WHERE id=$1', [
                media.id,
                missing.length
                  ? `${missing.join(' / ')}: ${note || 'Keine eindeutigen Quelldaten oder manuell gesperrtes Feld. Bitte Originalwerte im Titel prüfen.'}`
                  : null,
              ]);
            }
            payload = { ...payload, cursor: String(media.id), checked: Number(payload.checked || 0) + 1 };
            await client.query('UPDATE jobs SET payload=$2,updated_at=now() WHERE id=$1', [
              jobId,
              JSON.stringify(payload),
            ]);
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        }
      }
      payload = { ...payload, phase: 'aliases' };
      await query('UPDATE jobs SET payload=$2,updated_at=now() WHERE id=$1', [
        jobId,
        JSON.stringify(payload),
      ]);
    }
    // Apply the current rules only after all source checks. Commit results + completion together.
    await guard.query('BEGIN');
    await guard.query('SET LOCAL statement_timeout=120000');
    await guard.query('SELECT pg_advisory_xact_lock(729383)');
    const countries = await reprojectFacets(guard, 'country');
    const genres = await reprojectFacets(guard, 'genre');
    const unresolved = Number(
      (
        await guard.query(
          `SELECT count(*) FROM media WHERE id<=$1 AND (original_countries IS NULL OR original_genres IS NULL)`,
          [upperBound],
        )
      ).rows[0].count,
    );
    await guard.query("UPDATE jobs SET status='done',error=NULL,updated_at=now(),payload=$2 WHERE id=$1", [
      jobId,
      JSON.stringify({ ...payload, phase: 'done', unresolved, countries, genres }),
    ]);
    await guard.query('COMMIT');
  } catch (error) {
    await guard.query('ROLLBACK');
    throw error;
  } finally {
    await guard.query('SELECT pg_advisory_unlock(729384)');
    guard.release();
  }
}

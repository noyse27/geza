import { isDemo } from './demo-mode';
import { logEvent } from './logging';
import { query } from './db';
import { getSetting } from './settings';
import { plexRequest, plexIds } from './plex';
type PlexMetadata = Record<string, any>;
const KEYS = ['plex', 'imdb', 'tmdb', 'tvdb'];
export const PRESENCE_JOB = 'plex-presence-daily';
// Täglich 04:00 Uhr (Europe/Berlin), nach dem Bibliotheks-Scan um 03:00 Uhr.
export const PRESENCE_SEED_SQL = `INSERT INTO jobs(kind,dedupe_key,payload,available_at) VALUES('plex-presence','${PRESENCE_JOB}','{}',
  ((date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') + interval '1 day' + interval '4 hours') AT TIME ZONE 'Europe/Berlin'))`;
const RESCHEDULE_SQL = `${PRESENCE_SEED_SQL}
  ON CONFLICT(dedupe_key) DO UPDATE SET available_at=excluded.available_at,status='pending',attempts=0,error=NULL`;

// Gleicht die Rumpelkammer mit den Plex-Bibliotheken ab und merkt sich pro Titel, in welchen sie liegen.
// Bricht bei jedem Fehler ab, ohne etwas zu ändern: ein unvollständiger Lauf darf nichts als "nicht in Plex" markieren.
export async function processPlexPresence(payload: { manual?: boolean } = {}) {
  if (isDemo()) return;
  try {
    if (!(await getSetting('PLEX_URL')) || !(await getSetting('PLEX_TOKEN'))) {
      if (payload.manual) throw Error('Plex ist nicht verbunden. Bitte zuerst URL und Token speichern.');
      return;
    }
    const data = await plexRequest('/library/sections');
    const sections = (data?.MediaContainer?.Directory || []).filter((s: PlexMetadata) =>
      ['movie', 'show'].includes(s.type),
    );
    if (!sections.length) throw Error('Plex meldet keine Film- oder Serienbibliotheken.');
    const index = new Map<string, Set<string>>();
    let items = 0;
    for (const section of sections) {
      const listing = await plexRequest(`/library/sections/${encodeURIComponent(section.key)}/all?includeGuids=1`);
      if (!listing?.MediaContainer) throw Error(`Bibliothek „${section.title}“ konnte nicht gelesen werden.`);
      for (const item of (listing.MediaContainer.Metadata || []) as PlexMetadata[]) {
        if (!['movie', 'show'].includes(item.type)) continue;
        items++;
        const ids = plexIds(item);
        for (const key of KEYS) {
          if (!ids[key]) continue;
          const k = `${item.type}:${key}:${ids[key]}`;
          index.set(k, (index.get(k) || new Set()).add(String(section.title)));
        }
      }
    }
    if (!items) throw Error('Die Plex-Bibliotheken enthalten keine Titel; Abgleich abgebrochen.');
    const rows = await query<{ id: string; kind: string; ids: Record<string, unknown> }>(
      "SELECT id,kind,ids FROM media WHERE rumpel AND kind IN ('movie','show')",
    );
    const result = rows.map((row) => {
      const libraries = new Set<string>();
      for (const key of KEYS) {
        const value = row.ids?.[key];
        if (value == null || value === '') continue;
        for (const name of index.get(`${row.kind}:${key}:${value}`) || []) libraries.add(name);
      }
      return { id: row.id, libraries: [...libraries].sort((a, b) => a.localeCompare(b, 'de')) };
    });
    for (let i = 0; i < result.length; i += 1000)
      await query(
        `UPDATE media m SET plex_libraries=ARRAY(SELECT jsonb_array_elements_text(x.libraries)),plex_checked_at=now()
         FROM jsonb_to_recordset($1::jsonb) AS x(id bigint,libraries jsonb) WHERE m.id=x.id`,
        [JSON.stringify(result.slice(i, i + 1000))],
      );
    await logEvent('info', 'plex-presence', 'Plex-Abgleich der Rumpelkammer abgeschlossen', {
      libraries: sections.length,
      plexTitles: items,
      checked: result.length,
      inPlex: result.filter((r) => r.libraries.length).length,
    });
  } catch (error) {
    await logEvent('error', 'plex-presence', 'Plex-Abgleich der Rumpelkammer fehlgeschlagen', { error });
    throw error;
  } finally {
    await query(RESCHEDULE_SQL);
  }
}

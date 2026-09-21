import { readdir, writeFile } from 'node:fs/promises';
import { dataTables, encodeArchive, sealCredentials, type Archive } from '../src/lib/transfer-format';
import { hashPassword } from '../src/lib/security';
const date = '2026-09-20T18:00:00.000Z';
const tables = Object.fromEntries(dataTables.map((t) => [t, []])) as unknown as Archive['tables'];
const titles = [
  'Das Licht am Hafen',
  'Das Licht am Hafen – Heimkehr',
  'Ein Sommer auf dem Mars',
  'Die letzte Straßenbahn',
  'Wolken über Morgen',
  'Zimmer 204',
  'Sternenpost',
  'Die leise Stadt',
];
for (let n = 1; n <= 12; n++) {
  tables.media.push({
    id: String(n),
    kind: n <= 8 ? 'movie' : n === 9 ? 'show' : n === 10 ? 'season' : 'episode',
    trakt_id: null,
    title:
      titles[n - 1] ||
      (n === 9
        ? 'Nachtarchiv'
        : n === 10
          ? 'Staffel 1'
          : n === 11
            ? 'Das verschwundene Band'
            : 'Eine Stimme im Regen'),
    original_title: '',
    year: 2025,
    parent_id: n >= 10 ? '9' : null,
    season: n >= 10 ? 1 : null,
    episode: n >= 11 ? n - 10 : null,
    ids: {},
    summary:
      'Frei erfundener Demotitel: Eine unerwartete Begegnung verändert den Alltag und führt zu einer besonderen Reise.',
    countries: ['Deutschland'],
    genres: [n % 2 ? 'Drama' : 'Science Fiction'],
    directors: ['Mira Beispiel'],
    actors: ['Alex Muster', 'Kim Beispiel'],
    certification: '12',
    runtime: n >= 9 ? 45 : 100 + n,
    poster: null,
    locked_fields: [],
    search_text: '',
    search_vector: null,
    enriched_at: date,
    updated_at: date,
    field_sources: {},
  });
  if (n === 9 || n === 10) continue;
  tables.watches.push({
    id: String(n),
    media_id: String(n),
    source: 'geza',
    source_id: `demo-watch-${n}`,
    watched_at: n === 8 ? null : `2026-09-${String(n + 1).padStart(2, '0')}T18:00:00.000Z`,
    original_watched_at: null,
    time_estimated: n === 8,
    created_at: date,
  });
  if (n < 7)
    tables.ratings.push({ media_id: String(n), rating: 5 + (n % 5), rated_at: date, source: 'geza' });
  if (n < 5)
    tables.reviews.push({
      id: String(n),
      media_id: String(n),
      source: 'geza',
      source_id: `demo-review-${n}`,
      body:
        n === 4
          ? 'Entwurf: Hier kannst du deine eigene Kritik ergänzen.'
          : 'Eine ruhige Geschichte mit starken Bildern. Besonders die kleinen Begegnungen bleiben in Erinnerung. Diese Kritik ist frei erfunden.',
      spoiler: false,
      is_public: n !== 4,
      parent_source_id: null,
      created_at: date,
      updated_at: date,
    });
}
tables.film_series.push({ id: '1', title: 'Das Licht am Hafen', created_at: date });
tables.film_series_members.push(
  { series_id: '1', media_id: '1', position: 1 },
  { series_id: '1', media_id: '2', position: 2 },
);
tables.review_boxes.push({
  provider: 'custom-demokino',
  name: 'Demokino',
  scale: 5,
  automatic_enabled: false,
});
for (let n = 1; n <= 3; n++)
  tables.jobs.push({
    id: String(n),
    kind: 'plex',
    dedupe_key: `demo-scrobble-${n}`,
    payload: {
      event: 'media.scrobble',
      eventId: `00000000-0000-4000-8000-00000000000${n}`,
      receivedAt: date,
      metadata: {
        type: n === 3 ? 'episode' : 'movie',
        title: n === 3 ? 'Das verschwundene Band' : titles[n - 1],
        year: 2025,
      },
    },
    status: 'failed',
    attempts: 0,
    available_at: date,
    updated_at: date,
    error: 'Demo: Titel bitte manuell zuordnen.',
  });
await writeFile(
  'demo.geza',
  encodeArchive({
    format: 'geza-transfer',
    version: 1,
    exportedAt: date,
    migrations: (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort(),
    tables,
    credentials: sealCredentials(
      {
        accounts: [{ id: 1, username: 'admin', password_hash: hashPassword('admin') }],
        settings: {
          TMDB_TOKEN: 'demo-fantasie-tmdb',
          PLEX_URL: 'https://plex.example.invalid',
          PLEX_TOKEN: 'demo-fantasie-plex',
        },
      },
      '0'.repeat(64),
    ),
  }),
);
console.log('demo.geza erzeugt: ausschließlich erfundene Daten. Öffentlicher Demoschlüssel: 64 Nullen.');

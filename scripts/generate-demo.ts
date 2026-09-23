import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dataTables, encodeArchive, sealCredentials, type Archive } from '../src/lib/transfer-format';
import { hashPassword } from '../src/lib/security';
const date = '2026-09-20T18:00:00.000Z';
const tables = Object.fromEntries(dataTables.map((t) => [t, []])) as unknown as Archive['tables'];
// Public catalog fields only. Personal history, reviews, IDs and credentials from the
// source installation are deliberately absent from this small, checked-in fixture.
const catalog = JSON.parse(await readFile('assets/demo/catalog.json', 'utf8')) as Array<{
  title: string;
  original_title: string;
  year: number;
  countries: string[];
  genres: string[];
  directors: string[];
  actors: string[];
  certification: string | null;
  runtime: number | null;
  cover: string;
}>;
const covers = await Promise.all(catalog.map((item) => readFile(`assets/demo/${item.cover}`)));
for (let n = 1; n <= 12; n++) {
  const item = catalog[Math.min(n, 9) - 1];
  const cover = covers[Math.min(n, 9) - 1];
  tables.media.push({
    id: String(n),
    kind: n <= 8 ? 'movie' : n === 9 ? 'show' : n === 10 ? 'season' : 'episode',
    trakt_id: null,
    title: n <= 9 ? item.title : n === 10 ? 'Staffel 1' : `Episode ${n - 10}`,
    original_title: n <= 9 ? item.original_title : '',
    year: item.year,
    parent_id: n >= 10 ? '9' : null,
    season: n >= 10 ? 1 : null,
    episode: n >= 11 ? n - 10 : null,
    ids: {},
    summary:
      'Demobeispiel mit echten Katalogdaten und Cover. Bewertungen, Reviews und Anschauereignisse sind ausschließlich erfundene Testdaten.',
    countries: item.countries,
    genres: item.genres,
    directors: item.directors,
    actors: item.actors,
    certification: item.certification,
    runtime: n <= 9 ? item.runtime : null,
    poster: `/api/posters/${n}`,
    locked_fields: [],
    search_text: '',
    search_vector: null,
    enriched_at: date,
    updated_at: date,
    field_sources: {},
    bucketlist: false,
    manual_entry: false,
    rumpel: false,
    bucketlist_pinned: false,
  });
  // bytea uses PostgreSQL's JSON-compatible hex representation, as in normal backups.
  // Every entry gets a stored poster, including season/episodes using the series artwork.
  tables.posters.push({
    media_id: String(n),
    content_type: 'image/jpeg',
    data: `\\x${cover.toString('hex')}`,
    etag: createHash('sha256').update(cover).digest('hex'),
    updated_at: date,
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
tables.film_series.push({ id: '1', title: 'One Mile', created_at: date });
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
        title: n === 3 ? 'Episode 1' : catalog[n - 1].title,
        year: n === 3 ? catalog[8].year : catalog[n - 1].year,
        ...(n === 3 ? { grandparentTitle: catalog[8].title, parentIndex: 1, index: 1 } : {}),
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
console.log(
  'demo.geza erzeugt: echte Katalogdaten mit lokalen Covern, erfundene Nutzerdaten. Öffentlicher Demoschlüssel: 64 Nullen.',
);

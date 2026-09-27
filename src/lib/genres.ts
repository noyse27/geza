// Es gibt keine ISO-Liste für Genres. Kanonisch ist jeweils der deutsche Begriff;
// bekannte englische/alternative Schreibweisen werden darauf normalisiert.
const CANONICAL: [string, ...string[]][] = [
  ['Abenteuer', 'Adventure'],
  ['Action', 'Actionfilm'],
  ['Animation', 'Anime', 'Zeichentrickfilm'],
  ['Biografie', 'Biography', 'Biopic'],
  ['Dokumentation', 'Documentary', 'Dokumentarfilm', 'Doku'],
  ['Drama', 'Dramafilm'],
  ['Familie', 'Family', 'Familienfilm'],
  ['Fantasy', 'Fantasyfilm'],
  ['Fernsehfilm', 'TV Movie', 'TV-Film', 'Television Film'],
  ['Geschichte', 'History', 'Historie', 'Historienfilm'],
  ['Horror', 'Horrorfilm'],
  ['Komödie', 'Comedy'],
  ['Krieg', 'War', 'Kriegsfilm'],
  ['Krimi', 'Crime', 'Kriminalfilm'],
  ['Kurzfilm', 'Short', 'Short Film'],
  ['Liebesfilm', 'Romance', 'Romantik'],
  ['Musical', 'Musicalfilm'],
  ['Musik', 'Music', 'Musikfilm'],
  ['Mystery', 'Mysteryfilm'],
  ['Science-Fiction', 'Science Fiction', 'Sci-Fi', 'SciFi'],
  ['Sport', 'Sportfilm'],
  ['Thriller', 'Thrillerfilm'],
  ['Western', 'Westernfilm'],
];
const ALIAS_TO_CANONICAL: Record<string, string> = {};
for (const [canonical, ...aliases] of CANONICAL)
  for (const alias of [canonical, ...aliases]) ALIAS_TO_CANONICAL[alias.toLocaleLowerCase('de')] = canonical;
export function normalizeGenreToken(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  return ALIAS_TO_CANONICAL[value.toLocaleLowerCase('de')] || value;
}

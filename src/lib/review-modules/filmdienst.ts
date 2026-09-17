import type { ReviewModule, ReviewMedia } from './types';
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
export function parseFilmdienst(html: string, titles: string[], year: number, imdb?: string) {
  const linkedIds = [...html.matchAll(/href=["']https:\/\/(?:www\.)?imdb\.com\/title\/(tt\d+)\/?["']/gi)].map(
    (match) => match[1],
  );
  const identityMatch = Boolean(imdb && linkedIds.includes(imdb));
  if (imdb && linkedIds.length && !identityMatch) return null;
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : data['@graph'] || [data];
      for (const item of items) {
        if (item['@type'] !== 'Movie') continue;
        const name = String(item.name || '').replace(/\s*\(\d{4}\)\s*$/, '');
        if (
          !identityMatch &&
          (Number(item.copyrightYear) !== year || !titles.some((t) => normalize(t) === normalize(name)))
        )
          continue;
        const rating = item.review?.reviewRating;
        const value = Number(rating?.ratingValue);
        if (rating && Number(rating.bestRating) === 5 && Number.isFinite(value) && value >= 0 && value <= 5)
          return { rating: value };
        // Some reviews carry no reviewRating in the JSON-LD even though the page renders stars.
        const stars = html.match(/<div class="star-rating[^"]*" title="([\d,]+) Sterne"/);
        const starValue = stars ? Number(stars[1].replace(',', '.')) : NaN;
        return { rating: Number.isFinite(starValue) && starValue >= 0 && starValue <= 5 ? starValue : null };
      }
    } catch {
      /* Malformed third-party metadata is not a match. */
    }
  }
  return null;
}

// Filmdienst encodes umlauts in search-result attributes as numeric entities.
function decodeTitle(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
    auml: '\u00e4',
    ouml: '\u00f6',
    uuml: '\u00fc',
    Auml: '\u00c4',
    Ouml: '\u00d6',
    Uuml: '\u00dc',
    szlig: '\u00df',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return named[code] ?? entity;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

export function filmdienstCandidates(html: string, titles: string[], year: number, imdb?: string) {
  const candidates = new Map<string, number | null>();
  for (const article of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const metadata = article[1].match(/<ul\b[^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? '';
    const production = metadata.match(/<li\b[^>]*>([\s\S]*?)<\/li>/i)?.[1] ?? '';
    const resultYear = production.replace(/<[^>]*>/g, ' ').match(/\b(?:18|19|20|21)\d{2}\b/)?.[0];
    for (const link of article[1].matchAll(/<a\b([^>]*)>/gi)) {
      const path = link[1].match(/\bhref=["'](\/film\/details\/\d+\/[^"'#?]+)["']/i)?.[1];
      const title = link[1].match(/\btitle=(["'])(.*?)\1/i)?.[2];
      if (!path || !title) continue;
      const name = decodeTitle(title).replace(/\s*\(\d{4}\)\s*$/, '');
      if (titles.some((t) => normalize(t) === normalize(name)))
        candidates.set(path, resultYear ? Number(resultYear) : null);
    }
  }
  const entries = [...candidates];
  const exact = entries.filter(([, candidateYear]) => candidateYear === year);
  // Unknown years are checked on the detail page. A differing year requires IMDb proof.
  const eligible = exact.length
    ? exact
    : entries.filter(([, candidateYear]) => candidateYear === null || imdb);
  // Never silently choose three arbitrary results from an ambiguous set.
  return eligible.length <= 3 ? eligible.map(([path]) => path) : [];
}

let lastRequest = 0;
async function fetchPage(url: string, redirects = 0): Promise<string> {
  const u = new URL(url);
  if (u.origin !== 'https://www.filmdienst.de') throw Error('Unzulässige Quelle');
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 10000 - (Date.now() - lastRequest))));
  lastRequest = Date.now();
  const response = await fetch(u, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'Geza/0.1 (film review link discovery)' },
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    if (redirects >= 3 || !response.headers.get('location')) throw Error('Zu viele Weiterleitungen');
    return fetchPage(new URL(response.headers.get('location')!, u).href, redirects + 1);
  }
  if (!response.ok) throw Error('Quelle momentan nicht verfügbar');
  const reader = response.body!.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2000000) throw Error('Antwort zu groß');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function discover(m: ReviewMedia) {
  const robots = await fetchPage('https://www.filmdienst.de/robots.txt');
  // Conservative: suspend discovery if the publisher introduces any disallowed paths.
  if (/^[\t ]*Disallow:[\t ]*[^\s]/im.test(robots)) throw Error('Abrufregeln geändert');
  const titles = [m.title, m.original_title].filter(Boolean);
  const html = await fetchPage(
    `https://www.filmdienst.de/suche/alle?searchText=${encodeURIComponent(m.title)}`,
  );
  const paths = filmdienstCandidates(html, titles, Number(m.year), m.ids.imdb as string | undefined);
  const matches: { url: string; rating: number | null }[] = [];
  for (const path of paths) {
    const url = `https://www.filmdienst.de${path}`;
    const result = parseFilmdienst(
      await fetchPage(url),
      titles,
      Number(m.year),
      m.ids.imdb as string | undefined,
    );
    if (result) matches.push({ url, ...result });
  }
  return matches.length === 1 ? matches[0] : null;
}
export const filmdienst: ReviewModule = {
  id: 'filmdienst',
  name: 'Filmdienst.de',
  scale: 5,
  supports: (m) => m.kind === 'movie' && !!m.year,
  validateUrl(url) {
    if (
      !['www.filmdienst.de', 'filmdienst.de'].includes(url.hostname) ||
      !/^\/film\/details\/\d+\//.test(url.pathname)
    )
      throw Error('Bitte den direkten Filmdienst-Link angeben');
  },
  discover,
};

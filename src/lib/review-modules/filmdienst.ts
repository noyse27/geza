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
  let html = await fetchPage(
    `https://www.filmdienst.de/suche/alle?searchText=${encodeURIComponent(`${m.title} ${m.year}`)}`,
  );
  const candidates = (page: string) => [
    ...new Set(
      [...page.matchAll(/<a\s+[^>]*href="(\/film\/details\/\d+\/[^"#?]+)"[^>]*title="([^"]+)"/g)]
        .filter((match) =>
          titles.some((title) => normalize(title) === normalize(match[2].replace(/\s*\(\d{4}\)\s*$/, ''))),
        )
        .map((match) => match[1]),
    ),
  ];
  let paths = candidates(html);
  if (!paths.length) {
    html = await fetchPage(`https://www.filmdienst.de/suche/alle?searchText=${encodeURIComponent(m.title)}`);
    paths = candidates(html);
  }
  if (paths.length > 3)
    paths = m.ids.imdb
      ? paths
          .sort(
            (a, b) =>
              Math.abs(Number(a.match(/-(\d{4})$/)?.[1] || 0) - Number(m.year)) -
              Math.abs(Number(b.match(/-(\d{4})$/)?.[1] || 0) - Number(m.year)),
          )
          .slice(0, 3)
      : [];
  const matches: { url: string; rating: number | null }[] = [];
  for (const path of paths) {
    const url = `https://www.filmdienst.de${path}`;
    const result = parseFilmdienst(await fetchPage(url), titles, Number(m.year), m.ids.imdb as string | undefined);
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

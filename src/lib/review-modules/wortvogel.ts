import type { ReviewModule, ReviewMedia } from './types';
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

export function parseWortvogel(html: string, titles: string[], year: number | null) {
  const matches: { url: string; year: number | null }[] = [];
  for (const block of html.split(/(?=<article\b)/i).filter((b) => /^<article\b/i.test(b))) {
    const titleMatch = block.match(
      /<h2[^>]*class="[^"]*post-list-title[^"]*"[^>]*>\s*<a href="([^"]+)"[^>]*>\s*Kino Kritik:\s*([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch) continue;
    const name = titleMatch[2]
      .replace(/&amp;/g, '&')
      .trim()
      .replace(/\s*\([^)]*\)\s*$/, '');
    if (!titles.some((t) => normalize(t) === normalize(name))) continue;
    const yearMatch = block.replace(/<[^>]+>/g, ' ').match(/(\d{4})\s*\.\s*Regie/);
    matches.push({ url: titleMatch[1], year: yearMatch ? Number(yearMatch[1]) : null });
  }
  const pool = year ? matches.filter((m) => m.year === null || m.year === year) : matches;
  return pool.length === 1 ? { url: pool[0].url, rating: null } : null;
}

let lastRequest = 0;
async function fetchPage(url: string, redirects = 0): Promise<string> {
  const u = new URL(url);
  if (u.origin !== 'https://wortvogel.de') throw Error('Unzulässige Quelle');
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
  const robots = await fetchPage('https://wortvogel.de/robots.txt');
  // Conservative: suspend discovery if the publisher introduces any disallowed paths.
  if (/^[\t ]*Disallow:[\t ]*[^\s]/im.test(robots)) throw Error('Abrufregeln geändert');
  const titles = [m.title, m.original_title].filter(Boolean);
  const html = await fetchPage(`https://wortvogel.de/?s=${encodeURIComponent(`${m.title} "kino kritik"`)}`);
  return parseWortvogel(html, titles, m.year);
}
export const wortvogel: ReviewModule = {
  id: 'wortvogel',
  name: 'wortvogel.de',
  scale: 5,
  supports: (m) => m.kind === 'movie' && !!m.year,
  validateUrl(url) {
    if (!['wortvogel.de', 'www.wortvogel.de'].includes(url.hostname))
      throw Error('Bitte den direkten wortvogel.de-Link angeben');
  },
  discover,
};

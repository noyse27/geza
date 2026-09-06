import { query } from './db';

export function friendUrl(provider: string, value: string) {
  if (!value.trim()) return null;
  const u = new URL(value.trim());
  const hosts =
    provider === 'wortvogel' ? ['wortvogel.de', 'www.wortvogel.de'] : ['www.filmdienst.de', 'filmdienst.de'];
  if (
    u.protocol !== 'https:' ||
    (['wortvogel', 'filmdienst'].includes(provider) && !hosts.includes(u.hostname)) ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error('Ungültiger Review-Link');
  if (provider === 'filmdienst' && !/^\/film\/details\/\d+\//.test(u.pathname))
    throw Error('Bitte den direkten Filmdienst-Link angeben');
  return u.href;
}

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
        return {
          rating:
            rating && Number(rating.bestRating) === 5 && Number.isFinite(value) && value >= 0 && value <= 5
              ? value
              : null,
        };
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

export async function discoverFriendReview() {
  const rows = await query(`UPDATE friend_reviews SET next_check_at=now()+interval '1 day'
    WHERE (media_id,provider)=(SELECT media_id,provider FROM friend_reviews WHERE provider='filmdienst' AND NOT manual AND status<>'found' AND next_check_at<=now() ORDER BY next_check_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING media_id`);
  if (!rows.length) return false;
  const id = rows[0].media_id;
  try {
    const [m] = await query('SELECT title,original_title,year,ids FROM media WHERE id=$1', [id]);
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
      html = await fetchPage(
        `https://www.filmdienst.de/suche/alle?searchText=${encodeURIComponent(m.title)}`,
      );
      paths = candidates(html);
    }
    if (paths.length > 3)
      paths = m.ids.imdb
        ? paths
            .sort(
              (a, b) =>
                Math.abs(Number(a.match(/-(\d{4})$/)?.[1] || 0) - m.year) -
                Math.abs(Number(b.match(/-(\d{4})$/)?.[1] || 0) - m.year),
            )
            .slice(0, 3)
        : [];
    const matches: { url: string; rating: number | null }[] = [];
    for (const path of paths) {
      const url = `https://www.filmdienst.de${path}`;
      const result = parseFilmdienst(await fetchPage(url), titles, Number(m.year), m.ids.imdb);
      if (result) matches.push({ url, ...result });
    }
    const found = matches.length === 1 ? matches[0] : null;
    await query(
      `UPDATE friend_reviews SET url=$2,rating=$3,status=$4,checked_at=now(),next_check_at=now()+interval '30 days' WHERE media_id=$1 AND provider='filmdienst' AND NOT manual`,
      [id, found?.url || null, found?.rating ?? null, found ? 'found' : 'missing'],
    );
  } catch (error) {
    console.warn('Filmdienst discovery failed:', error instanceof Error ? error.message : 'Unknown error');
    await query(
      `UPDATE friend_reviews SET status='error',checked_at=now(),next_check_at=now()+interval '1 day' WHERE media_id=$1 AND provider='filmdienst' AND NOT manual`,
      [id],
    );
  }
  return true;
}

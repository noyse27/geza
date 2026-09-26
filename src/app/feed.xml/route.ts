import { isDemo } from '@/lib/demo-mode';
import { query } from '@/lib/db';
import { xmlEscape } from '@/lib/security';
export const dynamic = 'force-dynamic';
type Entry = {
  id: string;
  media_id: string;
  kind: string;
  title: string;
  year: number | null;
  season: number | null;
  poster: string | null;
  parent_title: string | null;
  rating: number | null;
  previous_rating: number | null;
  review_body: string | null;
  spoiler: boolean;
  rating_changed: boolean;
  review_changed: boolean;
  is_update: boolean;
  publish_at: Date;
};
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(10 - n) + ` (${n}/10)`;
const html = (s: string) => xmlEscape(s).replaceAll('\n', '<br/>');
function feedItem(base: string, e: Entry) {
  const name = e.kind === 'season' && e.parent_title ? `${e.parent_title} – Staffel ${e.season}` : e.title;
  const title = name + (e.year ? ` (${e.year})` : '');
  const url = `${base}/title/${e.media_id}`;
  const label = e.rating !== null ? ' – ' + stars(e.rating) : '';
  const heading = `${e.is_update ? 'Aktualisiert: ' : ''}${title}${label}`;
  const poster = e.poster ? (/^https?:\/\//.test(e.poster) ? e.poster : base + e.poster) : null;
  const parts: string[] = [];
  if (poster) parts.push(`<p><img src="${xmlEscape(poster)}" alt="" width="200"/></p>`);
  if (e.rating !== null && e.rating_changed)
    parts.push(
      `<p><strong>${xmlEscape(stars(e.rating))}</strong>${e.previous_rating !== null ? ` (vorher ${e.previous_rating}/10)` : ''}</p>`,
    );
  if (e.review_body && e.review_changed) {
    parts.push(
      `<p><em>${e.is_update ? 'Review aktualisiert' : 'Review'}${e.spoiler ? ' · Achtung, Spoiler' : ''}</em></p>`,
      `<p>${html(e.review_body)}</p>`,
    );
  }
  parts.push(`<p><a href="${xmlEscape(url)}">Auf Geza ansehen</a></p>`);
  return `<item><title>${xmlEscape(heading)}</title><link>${xmlEscape(url)}</link><guid isPermaLink="false">${xmlEscape(`tag:${new URL(base).host},feed:${e.id}`)}</guid><pubDate>${e.publish_at.toUTCString()}</pubDate><description>${xmlEscape(parts.join(''))}</description></item>`;
}
export async function GET() {
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  if (!base || isDemo())
    return new Response('Feed erst nach Domain-Konfiguration verfügbar.', { status: 404 });
  const entries = await query<Entry>(
    `SELECT f.id,f.media_id,m.kind,m.title,m.year,m.season,m.poster,p.title AS parent_title,f.rating,f.previous_rating,
     f.review_body,f.spoiler,f.rating_changed,f.review_changed,f.is_update,f.publish_at
     FROM feed_entries f JOIN media m ON m.id=f.media_id LEFT JOIN media p ON p.id=m.parent_id
     WHERE f.publish_at<=now() AND NOT m.rumpel AND NOT m.bucketlist ORDER BY f.publish_at DESC,f.id DESC LIMIT 50`,
  );
  const updated = entries[0]?.publish_at ?? new Date(0);
  const body =
    `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="/feed.xsl"?>` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>` +
    `<title>Geza – Bewertungen und Reviews</title><link>${xmlEscape(base)}/</link>` +
    `<description>Neue Bewertungen und Reviews von Geza.</description><language>de</language>` +
    `<lastBuildDate>${updated.toUTCString()}</lastBuildDate>` +
    `<atom:link href="${xmlEscape(base)}/feed.xml" rel="self" type="application/rss+xml"/>` +
    entries.map((e) => feedItem(base, e)).join('') +
    `</channel></rss>`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}

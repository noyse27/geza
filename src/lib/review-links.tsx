import Link from 'next/link';
import { query } from './db';
const TITLE_LINK_RE = /https?:\/\/\S+?\/title\/(\d+)\b/g;
export async function renderReviewBody(body: string) {
  const matches = [...body.matchAll(TITLE_LINK_RE)];
  if (!matches.length) return body;
  const ids = [...new Set(matches.map((m) => m[1]))];
  const rows = await query<{ id: string; title: string }>('SELECT id,title FROM media WHERE id=ANY($1::bigint[])', [
    ids,
  ]);
  const titles = new Map(rows.map((r) => [r.id, r.title]));
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of matches) {
    const title = titles.get(m[1]);
    if (!title) continue;
    const start = m.index!,
      end = start + m[0].length;
    if (start > last) parts.push(body.slice(last, start));
    parts.push(
      <Link key={start} href={`/title/${m[1]}`}>
        {title}
      </Link>,
    );
    last = end;
  }
  if (!parts.length) return body;
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

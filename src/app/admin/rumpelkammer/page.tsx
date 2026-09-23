import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { filterSchema, listRumpel, rumpelCounts } from '@/lib/rumpel';
import { RumpelList } from '@/components/rumpelkammer';
export const metadata = { title: 'Rumpelkammer', robots: { index: false, follow: false } };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const parsed = filterSchema.safeParse({
    q: one(raw.q) ?? '',
    type: one(raw.type) ?? 'all',
    source: one(raw.source) ?? 'all',
  });
  const filter = parsed.success ? parsed.data : filterSchema.parse({});
  const requested = Math.max(0, Math.min(100000, Number(one(raw.page)) || 0));
  const [counts, first] = await Promise.all([rumpelCounts(), listRumpel(filter, requested)]);
  const page = Math.min(requested, first.pages - 1);
  const list = page === requested ? first : await listRumpel(filter, page);
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow accent">OHNE SPUR</span>
        <h1>
          Rumpelkammer<span className="accent">.</span>
        </h1>
        <p>
          Alles, was da ist, aber noch keine Entscheidung hat: weder gesehen, bewertet oder besprochen noch auf
          der Bucketliste – etwa Titel aus Plex-Bibliotheken oder der Trakt-Collection. Sortiere sie aus:
          bewerten (ins Archiv), in die Bucketliste verschieben oder löschen. Hier tauchen sie auf – und nur
          hier.
        </p>
        <p className="muted small">
          {counts.movies.toLocaleString('de-DE')} Filme · {counts.shows.toLocaleString('de-DE')} Serien ·{' '}
          <Link href="/admin">zurück zum Admin-Bereich</Link>
        </p>
      </div>
      <RumpelList
        items={JSON.parse(JSON.stringify(list.items))}
        total={list.total}
        pages={list.pages}
        page={page}
        q={filter.q}
        type={filter.type}
        source={filter.source}
      />
    </div>
  );
}

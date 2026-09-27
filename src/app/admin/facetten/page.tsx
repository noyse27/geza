import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { rawFacetGroups, type FacetCategory } from '@/lib/facets';
import { countryLabel } from '@/lib/countries';
import { FacetMergeList } from '@/components/facet-admin';
export const metadata = { title: 'Länder und Genres', robots: { index: false, follow: false } };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const category: FacetCategory = one(raw.category) === 'genre' ? 'genre' : 'country';
  const groups = await rawFacetGroups(category);
  const items = groups.map((g) => ({
    value: g.value,
    label: category === 'country' ? countryLabel(g.value) : g.value,
    count: g.count,
  }));
  const tabs: { key: FacetCategory; label: string }[] = [
    { key: 'country', label: 'Länder' },
    { key: 'genre', label: 'Genres' },
  ];
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow accent">DATENPFLEGE</span>
        <h1>
          Länder und Genres<span className="accent">.</span>
        </h1>
        <p>
          Mehrere Werte auswählen, die dasselbe meinen, dann eine als „Ziel“ markieren und zusammenführen.
          Betroffene Titel werden sofort umgeschrieben; die Entscheidung merkt sich Geza für künftige Importe.{' '}
          <Link href="/admin">zurück zum Admin-Bereich</Link>
        </p>
      </div>
      <nav className="button-row" aria-label="Kategorie">
        {tabs.map((t) => (
          <Link
            key={t.key}
            className={`button${category === t.key ? ' primary' : ''}`}
            href={`/admin/facetten?category=${t.key}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <p className="muted small">{items.length} unterschiedliche Werte.</p>
      <FacetMergeList category={category} items={items} />
    </div>
  );
}

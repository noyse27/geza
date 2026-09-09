import Link from 'next/link';
import Form from 'next/form';
import { collectionCategories, collectionHref, isCollectionCategory } from '@/lib/collection-links';
import { collectionGroups, collectionItems } from '@/lib/collections';
import { MediaRow } from '@/components/media';
import { CollectionItems } from '@/components/collection-context';
import { isAdmin } from '@/lib/auth';

export const metadata = { title: 'Sammlungen', robots: { index: false, follow: false } };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const category = params.get('category') || '';
  const value = params.get('value');
  if (!isCollectionCategory(category))
    return (
      <div className="page">
        <div className="page-heading">
          <span className="eyebrow accent">DEINE FILME ENTDECKEN</span>
          <h1>
            Sammlungen<span className="accent">.</span>
          </h1>
          <p className="muted">Filmreihen, Genres und mehr — finde Filme, die zusammengehören.</p>
        </div>
        <div className="collection-grid">
          {Object.entries(collectionCategories).map(([key, label]) => (
            <Link
              className="collection-tile panel"
              key={key}
              href={collectionHref(key as keyof typeof collectionCategories)}
            >
              <h2>{label}</h2>
              <span className="accent">Entdecken ↗</span>
            </Link>
          ))}
        </div>
      </div>
    );
  const [groups, result] = await Promise.all([
    collectionGroups(category),
    value !== null ? collectionItems(category, value, params) : Promise.resolve(null),
  ]);
  const selected = value !== null ? groups.find((group) => group.value === value) : undefined;
  const title =
    value === null
      ? collectionCategories[category]
      : category === 'rating'
        ? `${value}/10`
        : selected?.label || value;
  const manageSeries = category === 'series' && selected && (await isAdmin());
  const groupSearch = (params.get('q') || '').trim().toLocaleLowerCase('de');
  const visibleGroups = groups.filter((group) => group.label.toLocaleLowerCase('de').includes(groupSearch));
  function pageHref(page: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    return '/collections?' + next;
  }
  return (
    <div className="page">
      <nav className="collection-breadcrumb" aria-label="Sammlungspfad">
        <Link href="/collections">Sammlungen</Link>
        <span>›</span>
        {value === null ? (
          <span>{collectionCategories[category]}</span>
        ) : (
          <>
            <Link href={collectionHref(category)}>{collectionCategories[category]}</Link>
            <span>›</span>
            <span>{title}</span>
          </>
        )}
      </nav>
      <div className="page-heading">
        <span className="eyebrow accent">{value === null ? 'STÖBERN' : collectionCategories[category]}</span>
        <h1>
          {title}
          <span className="accent">.</span>
        </h1>
        <p className="muted">
          {value === null
            ? `${groups.length} ${groups.length === 1 ? 'Sammlung' : 'Sammlungen'}`
            : `${selected?.count || 0} Filme in dieser Sammlung`}
        </p>
      </div>
      <Form action="/collections" className="toolbar collection-toolbar">
        <input type="hidden" name="category" value={category} />
        {value !== null && <input type="hidden" name="value" value={value} />}
        <input
          key={`${category}:${value}:${params.get('q')}`}
          type="search"
          name="q"
          aria-label={value === null ? 'Sammlungen durchsuchen' : 'In dieser Sammlung suchen'}
          placeholder={value === null ? 'Sammlungen durchsuchen …' : 'In dieser Sammlung suchen …'}
          defaultValue={params.get('q') || ''}
        />
        {result && (
          <select
            key={`${category}:${params.get('sort')}`}
            name="sort"
            aria-label="Sortierung"
            defaultValue={params.get('sort') || (category === 'series' ? 'series' : 'title')}
          >
            {category === 'series' && <option value="series">Reihenfolge der Filmreihe</option>}
            <option value="title">Titel A–Z</option>
            <option value="year">Neueste Erscheinungsjahre</option>
            <option value="rating">Beste GEZA-Bewertung</option>
          </select>
        )}
        <button className="button" type="submit">
          Anzeigen
        </button>
        {params.get('q') && (
          <Link className="button" href={collectionHref(category, value ?? undefined)}>
            Suche zurücksetzen
          </Link>
        )}
      </Form>
      {result ? (
        <>
          <CollectionItems
            items={result.items.map(({ id, title }) => ({ id, title }))}
            href={'/collections?' + params}
          />
          {manageSeries && (
            <p>
              <Link className="button" href={`/series/${selected!.value}`}>
                Filmreihe bearbeiten / Reihenfolge ändern
              </Link>
            </p>
          )}
          <div className="media-list">
            {result.items.map((item, index) => (
              <MediaRow
                key={item.id}
                item={item}
                index={result.page * 50 + index}
                href={`/collections/title/${item.id}`}
              />
            ))}
          </div>
          {!result.items.length && <div className="empty">Keine Filme in dieser Auswahl.</div>}
          <nav className="button-row collection-pagination" aria-label="Ergebnisseiten">
            {result.page > 0 && (
              <Link className="button" href={pageHref(result.page - 1)}>
                ← Vorherige 50
              </Link>
            )}
            <span className="muted">Seite {result.page + 1}</span>
            {result.hasMore && (
              <Link className="button" href={pageHref(result.page + 1)}>
                Weitere 50 →
              </Link>
            )}
          </nav>
        </>
      ) : (
        <div className="collection-grid">
          {visibleGroups.map((group) => (
            <Link
              className="collection-tile panel"
              key={group.value}
              href={collectionHref(category, group.value)}
            >
              <h2>{category === 'rating' ? `${group.label}/10` : group.label}</h2>
              <span className="muted">
                {group.count} {group.count === 1 ? 'Film' : 'Filme'}
              </span>
            </Link>
          ))}
          {!visibleGroups.length && <div className="empty">Keine Sammlungen gefunden.</div>}
        </div>
      )}
    </div>
  );
}

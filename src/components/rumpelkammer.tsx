'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bookmark, Pencil, Star, Trash2 } from 'lucide-react';
import { Poster, kindLabel } from './media';
import type { Media } from '@/lib/types';

type Item = Media & { children: number; plex_libraries: string[]; plex_checked_at: string | null };
type Source = 'all' | 'plex' | 'none' | 'unchecked';
const plexLabel = (item: Item) =>
  !item.plex_checked_at
    ? 'Plex nicht geprüft'
    : item.plex_libraries.length
      ? `Plex (${item.plex_libraries.join(', ')})`
      : 'Nicht in Plex';
type Action = { kind: 'bucketlist' } | { kind: 'rate'; rating: number } | { kind: 'delete' };

export function RumpelList({
  items,
  total,
  pages,
  page,
  q,
  type,
  source,
  library,
  libraries,
  checkedAt,
  checking,
  checkFailed,
  plexConfigured,
}: {
  items: Item[];
  total: number;
  pages: number;
  page: number;
  q: string;
  type: 'all' | 'movie' | 'show';
  source: Source;
  library: string;
  libraries: string[];
  checkedAt: string | null;
  checking: boolean;
  checkFailed: boolean;
  plexConfigured: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [rating, setRating] = useState(7);
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const count = allMatching ? total : selected.size;
  const href = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type !== 'all') params.set('type', type);
    if (source !== 'all') params.set('source', source);
    if (library) params.set('library', library);
    if (p) params.set('page', String(p));
    const s = params.toString();
    return `/admin/rumpelkammer${s ? `?${s}` : ''}`;
  };
  const toggle = (id: string) => {
    setAllMatching(false);
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  };
  const pageSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const labels: Record<Action['kind'], string> = {
    bucketlist: 'In die Bucketliste verschieben',
    rate: 'Bewerten',
    delete: 'Endgültig löschen',
  };
  function start(action: Action, ids?: string[]) {
    if (ids) {
      setAllMatching(false);
      setSelected(new Set(ids));
    }
    setError('');
    setPending(action);
  }
  async function run() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        action: pending.kind,
        ...(pending.kind === 'rate' ? { rating: pending.rating } : {}),
        ...(allMatching
          ? { filter: { q, type, source, library }, expectedCount: total }
          : { ids: [...selected] }),
      };
      const response = await fetch('/api/admin/rumpelkammer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Aktion fehlgeschlagen.');
      const done = pending.kind;
      setNotice(
        `${data.count} ${data.count === 1 ? 'Eintrag' : 'Einträge'} ${
          done === 'delete'
            ? 'gelöscht und für spätere Importe vorgemerkt'
            : done === 'bucketlist'
              ? 'in die Bucketliste verschoben'
              : 'bewertet und ins Archiv übernommen'
        }.${data.skipped ? ` ${data.skipped} nicht mehr in der Rumpelkammer und übersprungen.` : ''}`,
      );
      setPending(null);
      setSelected(new Set());
      setAllMatching(false);
      window.dispatchEvent(new Event('geza:catalog-changed'));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function startCheck() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/rumpelkammer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'plex-check' }),
      });
      if (!response.ok) throw Error((await response.json()).error || 'Start fehlgeschlagen.');
      setNotice('Plex-Abgleich gestartet. Das dauert je nach Bibliotheksgröße einige Minuten; danach die Seite neu laden.');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const preview = allMatching ? [] : items.filter((i) => selected.has(i.id)).slice(0, 8);
  return (
    <>
      <div className="panel rumpel-check-panel">
        <p>
          <strong>Plex-Abgleich:</strong>{' '}
          {checking
            ? 'läuft oder wartet auf den Worker …'
            : checkedAt
              ? `zuletzt ${new Date(checkedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`
              : 'noch nie durchgeführt'}
          {checkFailed && <span className="error"> · der letzte Lauf ist fehlgeschlagen (siehe Ereignisprotokoll)</span>}
        </p>
        <p className="muted small">
          Prüft, ob die Titel der Rumpelkammer aktuell in einer Plex-Bibliothek liegen, und merkt sich die
          Bibliothek. Läuft außerdem nachts um 04:00 Uhr.
        </p>
        {plexConfigured ? (
          <button type="button" className="button" disabled={busy || checking} onClick={startCheck}>
            Plex-Abgleich jetzt starten
          </button>
        ) : (
          <p className="muted small">Plex ist im Admin-Bereich noch nicht verbunden.</p>
        )}
        {error && !pending && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <form className="toolbar rumpel-filter" method="get" action="/admin/rumpelkammer">
        <input type="search" name="q" defaultValue={q} placeholder="Titel, Regie, Besetzung, IMDb-ID …" />
        <select name="type" defaultValue={type} aria-label="Art">
          <option value="all">Filme und Serien</option>
          <option value="movie">Nur Filme</option>
          <option value="show">Nur Serien</option>
        </select>
        <select name="source" defaultValue={source} aria-label="Plex-Stand">
          <option value="all">Alle Plex-Stände</option>
          <option value="plex">In einer Plex-Bibliothek</option>
          <option value="none">Nicht in Plex</option>
          <option value="unchecked">Noch nicht geprüft</option>
        </select>
        {libraries.length > 0 && (
          <select name="library" defaultValue={library} aria-label="Bibliothek">
            <option value="">Alle Bibliotheken</option>
            {libraries.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <button className="button">Filtern</button>
        {(q || type !== 'all' || source !== 'all' || library) && (
          <Link className="button" href="/admin/rumpelkammer">
            Zurücksetzen
          </Link>
        )}
      </form>
      {notice && (
        <p className="panel" role="status">
          {notice}
        </p>
      )}
      {!items.length ? (
        <p className="muted">
          {q || type !== 'all' || source !== 'all' || library ? 'Keine Treffer für diesen Filter.' : 'Die Rumpelkammer ist leer.'}
        </p>
      ) : (
        <>
          <div className="rumpel-select">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={pageSelected || allMatching}
                onChange={(e) => {
                  setAllMatching(false);
                  setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set());
                }}
              />
              Alle {items.length} auf dieser Seite auswählen
            </label>
            {total > items.length && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  setAllMatching(true);
                  setSelected(new Set(items.map((i) => i.id)));
                }}
              >
                Alle {total.toLocaleString('de-DE')} Treffer auswählen
              </button>
            )}
            <span className="muted small">{total.toLocaleString('de-DE')} Einträge</span>
          </div>
          <div className="rumpel-list">
            {items.map((item) => (
              <div key={item.id} className={`rumpel-row${selected.has(item.id) ? ' selected' : ''}`}>
                <label className="checkbox rumpel-check">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id) || allMatching}
                    onChange={() => toggle(item.id)}
                    aria-label={`${item.title} auswählen`}
                  />
                </label>
                <Poster item={item} />
                <div className="row-info">
                  <span className="eyebrow">
                    {kindLabel(item.kind)}
                    {item.kind === 'show' && item.children > 0 && ` · ${item.children} Staffeln/Episoden`}
                    {` · ${plexLabel(item)}`}
                  </span>
                  <h3>
                    {item.title} {item.year && <span>({item.year})</span>}
                  </h3>
                  <span className="muted row-subtitle">
                    {item.genres.slice(0, 3).join(' · ') ||
                      (item.original_title && item.original_title !== item.title ? item.original_title : '')}
                    {item.runtime ? ` · ${item.runtime} Min.` : ''}
                  </span>
                </div>
                <div className="button-row rumpel-actions">
                  <Link className="button" href={`/title/${item.id}`} prefetch={false}>
                    <Pencil size={15} /> Bearbeiten
                  </Link>
                  <button
                    type="button"
                    className="button"
                    onClick={() => start({ kind: 'bucketlist' }, [item.id])}
                  >
                    <Bookmark size={15} /> Bucketliste
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    onClick={() => start({ kind: 'delete' }, [item.id])}
                  >
                    <Trash2 size={15} /> Löschen
                  </button>
                </div>
              </div>
            ))}
          </div>
          {pages > 1 && (
            <nav className="button-row rumpel-pages" aria-label="Seiten">
              {page > 0 && (
                <Link className="button" href={href(page - 1)}>
                  ← Zurück
                </Link>
              )}
              <span className="muted small">
                Seite {page + 1} von {pages}
              </span>
              {page < pages - 1 && (
                <Link className="button" href={href(page + 1)}>
                  Weiter →
                </Link>
              )}
            </nav>
          )}
        </>
      )}
      {count > 0 && !pending && (
        <div className="rumpel-bar" role="region" aria-label="Aktionen für die Auswahl">
          <strong>
            {count.toLocaleString('de-DE')} ausgewählt
            {allMatching && ' (alle Treffer)'}
          </strong>
          <div className="button-row">
            <button type="button" className="button" onClick={() => start({ kind: 'bucketlist' })}>
              <Bookmark size={15} /> In die Bucketliste
            </button>
            <label className="rumpel-rate">
              <select value={rating} onChange={(e) => setRating(Number(e.target.value))} aria-label="Bewertung">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}/10
                  </option>
                ))}
              </select>
              <button type="button" className="button" onClick={() => start({ kind: 'rate', rating })}>
                <Star size={15} /> Bewerten
              </button>
            </label>
            <button type="button" className="button danger" onClick={() => start({ kind: 'delete' })}>
              <Trash2 size={15} /> Löschen
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setSelected(new Set());
                setAllMatching(false);
              }}
            >
              Auswahl aufheben
            </button>
          </div>
        </div>
      )}
      {pending && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label={labels[pending.kind]}>
            <h2>{labels[pending.kind]}</h2>
            <p>
              {pending.kind === 'delete' && (
                <>
                  <strong>{count.toLocaleString('de-DE')}</strong>{' '}
                  {count === 1 ? 'Eintrag wird' : 'Einträge werden'} endgültig gelöscht – bei Serien samt
                  Staffeln und Episoden. Die Titel werden vorgemerkt, damit spätere Importe sie nicht erneut
                  anlegen. Das Vormerken endet erst, wenn ein Import wieder Sichtungen, Bewertungen oder
                  Kommentare dazu enthält.
                </>
              )}
              {pending.kind === 'bucketlist' && (
                <>
                  <strong>{count.toLocaleString('de-DE')}</strong>{' '}
                  {count === 1 ? 'Eintrag wird' : 'Einträge werden'} in die Bucketliste verschoben und dort
                  vor dem automatischen Plex-Abgleich geschützt. Sie verschwinden aus der Rumpelkammer.
                </>
              )}
              {pending.kind === 'rate' && (
                <>
                  <strong>{count.toLocaleString('de-DE')}</strong>{' '}
                  {count === 1 ? 'Eintrag erhält' : 'Einträge erhalten'} die Bewertung{' '}
                  <strong>{pending.rating}/10</strong>. Mit einer Bewertung sind sie keine Waisen mehr und
                  wandern ins Archiv.
                </>
              )}
            </p>
            {preview.length > 0 && (
              <ul className="rumpel-preview">
                {preview.map((i) => (
                  <li key={i.id}>
                    {i.title}
                    {i.year ? ` (${i.year})` : ''}
                  </li>
                ))}
                {selected.size > preview.length && <li>… und {selected.size - preview.length} weitere</li>}
              </ul>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button type="button" className="button" disabled={busy} onClick={() => setPending(null)}>
                Abbrechen
              </button>
              <button
                type="button"
                className={`button ${pending.kind === 'delete' ? 'danger' : 'primary'}`}
                disabled={busy}
                onClick={run}
              >
                {busy ? 'Einen Moment …' : labels[pending.kind]}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
type Item = { value: string; label: string; count: number };
export function FacetMergeList({ category, items }: { category: 'country' | 'genre'; items: Item[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [canonical, setCanonical] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const visible = useMemo(() => {
    const term = q.trim().toLocaleLowerCase('de');
    return term
      ? items.filter(
          (i) =>
            i.label.toLocaleLowerCase('de').includes(term) || i.value.toLocaleLowerCase('de').includes(term),
        )
      : items;
  }, [items, q]);
  function toggle(value: string) {
    setNotice('');
    setSelected((s) => {
      const n = new Set(s);
      if (n.delete(value)) {
        if (canonical === value) setCanonical([...n][0] ?? null);
      } else {
        n.add(value);
        if (!canonical) setCanonical(value);
      }
      return n;
    });
  }
  function reset() {
    setSelected(new Set());
    setCanonical(null);
  }
  async function merge() {
    if (!canonical || selected.size < 2) return;
    setBusy(true);
    setError('');
    try {
      const aliases = [...selected].filter((v) => v !== canonical);
      const target = items.find((i) => i.value === canonical);
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge-facet', data: { category, aliases, canonical } }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || 'Zusammenführen fehlgeschlagen.');
      setNotice(
        `${data.affected} ${data.affected === 1 ? 'Titel' : 'Titel'} zusammengeführt in „${target?.label || canonical}“.`,
      );
      reset();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <input
        type="search"
        placeholder="Werte durchsuchen …"
        aria-label="Werte durchsuchen"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {notice && (
        <p className="panel" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="facet-merge-list">
        {visible.map((item) => (
          <label key={item.value} className={`facet-merge-row${selected.has(item.value) ? ' selected' : ''}`}>
            <input
              type="checkbox"
              checked={selected.has(item.value)}
              onChange={() => toggle(item.value)}
              aria-label={`${item.label} auswählen`}
            />
            <span className="facet-merge-label">
              {item.label}
              {item.label !== item.value && <span className="muted small"> ({item.value})</span>}
            </span>
            <span className="muted small">{item.count.toLocaleString('de-DE')}</span>
            {selected.has(item.value) && (
              <label className="facet-merge-canonical">
                <input
                  type="radio"
                  name="canonical"
                  checked={canonical === item.value}
                  onChange={() => setCanonical(item.value)}
                />
                Ziel
              </label>
            )}
          </label>
        ))}
        {!visible.length && <p className="empty compact">Keine Treffer.</p>}
      </div>
      {selected.size > 0 && (
        <div className="rumpel-bar" role="region" aria-label="Zusammenführen">
          <strong>{selected.size} ausgewählt</strong>
          <div className="button-row">
            <button
              type="button"
              className="button primary"
              disabled={busy || selected.size < 2 || !canonical}
              onClick={merge}
            >
              {busy ? 'Einen Moment …' : 'Zusammenführen'}
            </button>
            <button type="button" className="button" onClick={reset} disabled={busy}>
              Auswahl aufheben
            </button>
          </div>
        </div>
      )}
    </>
  );
}

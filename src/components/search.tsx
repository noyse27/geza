'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search as SearchIcon, ArrowUpRight, LoaderCircle, X } from 'lucide-react';
import type { Media } from '@/lib/types';
import { kindLabel, Poster } from './media';
export function Search({ initial = '', compact = false }: { initial?: string; compact?: boolean }) {
  const [value, setValue] = useState(initial),
    [items, setItems] = useState<Media[]>([]),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [active, setActive] = useState(-1);
  const router = useRouter();
  const generation = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => {
    const current = ++generation.current,
      controller = new AbortController();
    setActive(-1);
    setItems([]);
    setError(false);
    if (!value.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?live=1&q=${encodeURIComponent(value.trim())}`, {
          signal: controller.signal,
        });
        if (!r.ok) throw Error();
        const result = await r.json();
        if (current === generation.current) {
          setItems(result.items);
          setLoading(false);
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError' && current === generation.current) {
          setError(true);
          setLoading(false);
        }
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);
  function submit() {
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(value.trim())}`);
  }
  return (
    <div className={`search-wrap ${compact ? 'search-compact' : ''}`} ref={root}>
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (active >= 0 && items[active]) {
            setOpen(false);
            router.push(`/title/${items[active].id}`);
          } else submit();
        }}
      >
        <SearchIcon size={23} />
        <input
          aria-label="Filme, Serien und Reviews suchen"
          role="combobox"
          aria-controls="search-options"
          aria-expanded={open && !!value.trim()}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `option-${active}` : undefined}
          placeholder="Ein Film. Eine Serie. Eine Entdeckung."
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((x) => Math.min(x + 1, items.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((x) => Math.max(-1, x - 1));
            }
          }}
        />
        {value && (
          <button
            className="icon-button"
            type="button"
            onClick={() => setValue('')}
            aria-label="Suche leeren"
          >
            <X size={17} />
          </button>
        )}
        <button className="search-submit" aria-label="Suche starten" type="submit">
          <span>Suchen</span>
          <ArrowUpRight size={19} />
        </button>
      </form>
      {open && value.trim() && (
        <div className="search-dropdown" id="search-options" role="listbox" aria-label="Suchvorschläge">
          {loading ? (
            <div className="search-message">
              <LoaderCircle className="spin" size={16} /> Suche …
            </div>
          ) : error ? (
            <div className="search-message">
              Die Suche ist gerade nicht erreichbar. Bitte erneut versuchen.
            </div>
          ) : items.length ? (
            items.map((m, i) => (
              <Link
                role="option"
                aria-selected={active === i}
                id={`option-${i}`}
                key={m.id}
                href={`/title/${m.id}`}
                prefetch={false}
                className={`suggestion ${i === active ? 'selected' : ''}`}
                onClick={() => setOpen(false)}
              >
                <Poster item={m} />
                <div>
                  <strong>{m.title}</strong>
                  <small>
                    {kindLabel(m.kind)} · {m.year || m.parent_title || 'Jahr offen'}
                  </small>
                </div>
                <ArrowUpRight size={15} />
              </Link>
            ))
          ) : (
            <div className="search-message">Keine passenden Titel gefunden.</div>
          )}
          <button type="button" className="all-results" onClick={submit}>
            Alle Ergebnisse für „{value}“ <span>↵</span>
          </button>
        </div>
      )}
    </div>
  );
}

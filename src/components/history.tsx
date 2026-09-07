'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MediaRow } from './media';
import type { Media } from '@/lib/types';
import { ScrobbleDialog } from './scrobble-dialog';
type Result = { items: Media[]; cursor: string | null };
export function HistoryBrowser({
  initial,
  months,
  admin = false,
  openScrobbles = 0,
}: {
  initial: Result;
  months: { month: string; count: number }[];
  admin?: boolean;
  openScrobbles?: number;
}) {
  const params = useSearchParams(),
    router = useRouter(),
    [result, setResult] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const scrollPosition = useRef(0);
  const loadedAt = useRef(Date.now());
  const key = params.toString();
  useEffect(() => {
    const stored = sessionStorage.getItem('history:' + key);
    const invalidatedAt = Number(sessionStorage.getItem('history:invalidated') || 0);
    if (stored) {
      try {
        const saved = JSON.parse(stored);
        if (saved.savedAt && saved.savedAt >= invalidatedAt) {
          setResult(saved.result);
          requestAnimationFrame(() => window.scrollTo(0, saved.scroll));
          return;
        }
      } catch {
        /* fall through to fresh data below */
      }
    }
    setResult(initial);
  }, [initial, key]);
  useEffect(() => {
    const track = () => {
      scrollPosition.current = window.scrollY;
    };
    const save = () => {
      try {
        if (Number(sessionStorage.getItem('history:invalidated') || 0) > loadedAt.current) return;
        sessionStorage.setItem(
          'history:' + key,
          JSON.stringify({ result, scroll: scrollPosition.current, savedAt: Date.now() }),
        );
      } catch {
        /* Storage quota must not interrupt navigation. */
      }
    };
    window.addEventListener('scroll', track, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.removeEventListener('scroll', track);
      window.removeEventListener('pagehide', save);
    };
  }, [key, result]);
  async function more() {
    if (!result.cursor || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const p = new URLSearchParams(key);
      p.set('cursor', result.cursor);
      const r = await fetch('/api/history?' + p);
      if (!r.ok) throw Error('History konnte nicht geladen werden.');
      const next = await r.json();
      setResult((x) => ({ items: [...x.items, ...next.items], cursor: next.cursor }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !error) void more();
      },
      { rootMargin: '250px' },
    );
    if (sentinel.current) observer.observe(sentinel.current);
    return () => observer.disconnect();
  });
  function change(name: string, value: string) {
    const p = new URLSearchParams(key);
    p.delete('cursor');
    value ? p.set(name, value) : p.delete(name);
    router.push('/history?' + p);
  }
  const selected = params.get('month') || '';
  return (
    <>
      <div className="toolbar">
        <div className="segmented">
          {[
            ['all', 'Alle'],
            ['movie', 'Filme'],
            ['show', 'Serien'],
          ].map(([v, l]) => (
            <button
              className={(params.get('type') || 'all') === v ? 'active' : ''}
              key={v}
              onClick={() => change('type', v)}
            >
              {l}
            </button>
          ))}
        </div>
        {admin && <ScrobbleDialog initialCount={openScrobbles} />}
        <select
          aria-label="Zum Monat springen"
          value={selected}
          onChange={(e) => change('month', e.target.value)}
        >
          <option value="">Neueste zuerst</option>
          {months.map((m) => (
            <option key={m.month} value={m.month}>
              {new Date(m.month + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })} (
              {m.count})
            </option>
          ))}
        </select>
      </div>
      <div className="history-layout">
        <div>
          <div className="media-list">
            {result.items.map((m) => (
              <MediaRow key={m.watch_id} item={m} watched />
            ))}
          </div>
          {!result.items.length && <div className="empty">Keine Anschauereignisse in dieser Auswahl.</div>}
          <div ref={sentinel} className="load-more">
            {result.cursor && (
              <button className="button" disabled={busy} onClick={more}>
                {busy ? 'Weitere Filmabende laden …' : 'Weitere 50 laden'}
              </button>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </div>
        <aside className="timeline">
          <span className="eyebrow">DEINE ZEITREISE</span>
          <button className={!selected ? 'selected' : ''} onClick={() => change('month', '')}>
            Heute
          </button>
          {months.map((m, i) => (
            <div key={m.month}>
              {(i === 0 || months[i - 1].month.slice(0, 4) !== m.month.slice(0, 4)) && (
                <h3>{m.month.slice(0, 4)}</h3>
              )}
              <button
                className={selected === m.month ? 'selected' : ''}
                onClick={() => change('month', m.month)}
              >
                <span>{new Date(m.month + '-15').toLocaleDateString('de-DE', { month: 'long' })}</span>
                <small>{m.count}</small>
              </button>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}

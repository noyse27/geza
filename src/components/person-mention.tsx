'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Film } from 'lucide-react';
import type { MentionResult } from '@/lib/mentions';

const cache = new Map<string, MentionResult[]>();
function MentionCover({ item }: { item: MentionResult }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="mention-cover">
      {item.poster && !failed ? (
        <img
          src={item.poster}
          alt={`Cover: ${item.label}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="mention-cover-missing">
          <Film aria-hidden="true" size={28} />
          <span>Kein Cover</span>
        </span>
      )}
    </span>
  );
}
export function PersonMention({ kind, name, label }: { kind: 'm' | 'r' | 'a'; name: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MentionResult[] | null>(null);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
  }
  useEffect(() => () => cancel(), []);
  useEffect(() => {
    if (!open) return;
    const key = `${kind}:${name}`;
    if (cache.has(key)) {
      setItems(cache.get(key)!);
      return;
    }
    const controller = new AbortController();
    setError(false);
    fetch(`/api/mentions?${new URLSearchParams({ kind, [kind === 'm' ? 'id' : 'person']: name })}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((rows: MentionResult[]) => {
        if (!controller.signal.aborted) {
          if (cache.size > 100) cache.clear();
          cache.set(key, rows);
          setItems(rows);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [open, kind, name]);
  return (
    <span
      className="person-mention"
      onMouseEnter={() => {
        cancel();
        timer.current = setTimeout(() => setOpen(true), 200);
      }}
      onMouseLeave={() => {
        cancel();
        timer.current = setTimeout(() => setOpen(false), 180);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancel();
          setOpen(false);
        }
      }}
    >
      {kind === 'm' ? (
        <Link
          className="review-title-link"
          href={`/title/${name}`}
          prefetch={false}
          onFocus={() => {
            cancel();
            setOpen(true);
          }}
        >
          {label}
        </Link>
      ) : (
        <button
          type="button"
          className="review-title-link"
          aria-expanded={open}
          onClick={() => {
            cancel();
            setOpen((v) => !v);
          }}
        >
          {label}
        </button>
      )}
      {open && (
        <span className={`mention-preview${kind === 'm' ? ' mention-preview-covers' : ''}`}>
          {kind !== 'm' && <strong>{name}</strong>}
          {error ? (
            <span role="status">Filme konnten nicht geladen werden.</span>
          ) : items === null ? (
            <span role="status">Lädt …</span>
          ) : items.length ? (
            <span>
              {items.map((item) => (
                <Link key={item.id} href={`/title/${item.id}`} prefetch={false}>
                  <span>
                    {item.label}
                    {item.year ? ` (${item.year})` : ''}
                  </span>
                  {kind === 'm' && <MentionCover item={item} />}
                </Link>
              ))}
            </span>
          ) : (
            <span>Keine Filme vorhanden.</span>
          )}
        </span>
      )}
    </span>
  );
}

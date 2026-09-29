'use client';
import { useEffect, useId, useRef, useState } from 'react';
import {
  activeMention,
  decodeMentions,
  encodeMentions,
  updateMentions,
  type MentionResult,
} from '@/lib/mentions';

function caretPosition(input: HTMLTextAreaElement) {
  const mirror = document.createElement('div');
  const style = getComputedStyle(input);
  for (const key of [
    'font',
    'lineHeight',
    'letterSpacing',
    'padding',
    'border',
    'boxSizing',
    'wordSpacing',
    'tabSize',
  ] as const)
    mirror.style[key] = style[key];
  Object.assign(mirror.style, {
    position: 'fixed',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    width: `${input.clientWidth + 2 * parseFloat(style.borderLeftWidth)}px`,
  });
  mirror.textContent = input.value.slice(0, input.selectionStart);
  const marker = document.createElement('span');
  marker.textContent = input.value.slice(input.selectionStart) || '.';
  mirror.append(marker);
  document.body.append(mirror);
  const result = {
    left: marker.offsetLeft - input.scrollLeft,
    top: marker.offsetTop - input.scrollTop + (parseFloat(style.lineHeight) || 24),
  };
  mirror.remove();
  return result;
}

export function MentionEditor({ initialBody }: { initialBody: string }) {
  const [draft, setDraft] = useState(() => decodeMentions(initialBody));
  const [active, setActive] = useState<ReturnType<typeof activeMention>>(null);
  const [items, setItems] = useState<MentionResult[]>([]);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const input = useRef<HTMLTextAreaElement>(null);
  const cache = useRef(new Map<string, MentionResult[]>());
  const listId = useId();
  useEffect(() => {
    input.current?.setCustomValidity(
      encodeMentions(draft.text, draft.mentions).length > 30000
        ? 'Das Review ist mit Verweisen zu lang (maximal 30.000 Zeichen).'
        : '',
    );
  }, [draft]);
  useEffect(() => {
    setItems([]);
    setSelected(0);
    if (!active) return;
    const key = `${active.kind}:${active.query}`;
    const cached = cache.current.get(key);
    if (cached) {
      setItems(cached);
      setStatus(cached.length ? '' : 'Keine Treffer');
      return;
    }
    setStatus('Suche …');
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/mentions?${new URLSearchParams({ kind: active.kind, q: active.query })}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw Error();
        const results: MentionResult[] = await response.json();
        if (controller.signal.aborted) return;
        if (cache.current.size > 100) cache.current.clear();
        cache.current.set(key, results);
        setItems(results);
        setStatus(results.length ? '' : 'Keine Treffer');
      } catch {
        if (!controller.signal.aborted) setStatus('Suche nicht verfügbar');
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active?.kind, active?.query]);
  function locate(el: HTMLTextAreaElement) {
    const next = el.selectionStart === el.selectionEnd ? activeMention(el.value, el.selectionStart) : null;
    setActive(next);
    if (next) {
      const pos = caretPosition(el);
      setPosition({
        left: Math.max(0, Math.min(pos.left, el.clientWidth - 300)),
        top: Math.max(0, Math.min(pos.top, el.clientHeight)),
      });
    }
  }
  function choose(item: MentionResult) {
    if (!active || !input.current) return;
    const text = draft.text.slice(0, active.start) + item.label + ' ' + draft.text.slice(active.end);
    const mentions = updateMentions(draft.text, text, draft.mentions);
    mentions.push({
      start: active.start,
      end: active.start + item.label.length,
      kind: active.kind,
      id: item.id,
      label: item.label,
    });
    mentions.sort((a, b) => a.start - b.start);
    setDraft({ text, mentions });
    setActive(null);
    const caret = active.start + item.label.length + 1;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
      setActive(null);
    });
  }
  return (
    <div className="mention-editor">
      <input type="hidden" name="body" value={encodeMentions(draft.text, draft.mentions)} />
      <textarea
        ref={input}
        rows={7}
        required
        maxLength={30000}
        value={draft.text}
        aria-label="Dein Review"
        aria-autocomplete="list"
        aria-controls={active ? listId : undefined}
        aria-activedescendant={active && items[selected] ? `${listId}-${selected}` : undefined}
        placeholder="Was bleibt von diesem Film?"
        onChange={(e) => {
          setDraft({
            text: e.target.value,
            mentions: updateMentions(draft.text, e.target.value, draft.mentions),
          });
          locate(e.target);
        }}
        onClick={(e) => locate(e.currentTarget)}
        onScroll={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) locate(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (!active || e.nativeEvent.isComposing) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            setActive(null);
          }
          if (items.length && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
            e.preventDefault();
            setSelected((n) => (n + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          }
          if (e.key === 'Enter' && items[selected]) {
            e.preventDefault();
            choose(items[selected]);
          }
        }}
      />
      {active && (
        <div className="mention-results" style={position}>
          <div
            id={listId}
            role="listbox"
            aria-label={active.kind === 'm' ? 'Filme' : active.kind === 'r' ? 'Regie' : 'Darsteller'}
          >
            {items.map((item, index) => (
              <button
                type="button"
                role="option"
                id={`${listId}-${index}`}
                aria-selected={index === selected}
                key={item.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(item)}
              >
                {item.label}
                {item.year ? ` (${item.year})` : ''}
              </button>
            ))}
          </div>
          {status && <span role="status">{status}</span>}
        </div>
      )}
    </div>
  );
}

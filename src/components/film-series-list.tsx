'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GripVertical, Save } from 'lucide-react';
import { MediaRow } from './media';
import type { Media } from '@/lib/types';
export function FilmSeriesList({
  seriesId,
  items,
  admin,
}: {
  seriesId: string;
  items: Media[];
  admin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dragIndex = useRef<number | null>(null);
  function reorder(from: number, to: number) {
    setOrder((current) => {
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'series-reorder',
          data: { seriesId, order: order.map((m) => m.id) },
        }),
      });
      if (!response.ok) throw Error((await response.json()).error || 'Speichern fehlgeschlagen');
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {admin && (
        <div className="button-row">
          {editing ? (
            <>
              <button className="button primary" disabled={busy} onClick={save}>
                <Save size={15} /> {busy ? 'Speichert …' : 'Speichern'}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  setOrder(items);
                  setEditing(false);
                  setError('');
                }}
              >
                Abbrechen
              </button>
            </>
          ) : (
            <button className="button" onClick={() => setEditing(true)}>
              Reihenfolge ändern
            </button>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {editing ? (
        <ul className="media-list series-reorder-list">
          {order.map((item, index) => (
            <li
              key={item.id}
              draggable
              className="series-reorder-item"
              onDragStart={() => {
                dragIndex.current = index;
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex.current !== null && dragIndex.current !== index) reorder(dragIndex.current, index);
                dragIndex.current = null;
              }}
            >
              <GripVertical size={16} className="drag-handle" />
              <span className="row-index">{String(index + 1).padStart(2, '0')}</span>
              <span>
                {item.title} {item.year && `(${item.year})`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="media-list">
          {order.map((item, index) => (
            <MediaRow key={item.id} item={item} index={index} />
          ))}
          {!order.length && <div className="empty">Diese Filmreihe enthält noch keine Filme.</div>}
        </div>
      )}
    </>
  );
}

'use client';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCollectionHref } from './collection-context';
import { Trash2 } from 'lucide-react';
import type { Media } from '@/lib/types';

export function DeleteMediaButton({ item }: { item: Media }) {
  const router = useRouter();
  const pathname = usePathname();
  const collectionHref = useCollectionHref();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <button
        className="button danger"
        onClick={() => {
          setTitle('');
          setError('');
          setOpen(true);
        }}
      >
        <Trash2 size={15} /> Datensatz löschen
      </button>
      {open && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Datensatz löschen">
            <h2>Datensatz löschen</h2>
            <p>
              <strong>{item.title}</strong> (ID {item.id}) wird endgültig gelöscht – einschließlich seiner
              Anschauereignisse, Bewertung, Reviews, externen Review-Links und gespeicherten Bilder.
            </p>
            <p>
              Zugeordnete Staffeln oder Episoden müssen vorher umgeordnet oder einzeln gelöscht werden. Ein
              erneuter Import oder Plex-Abgleich kann den Datensatz wieder anlegen.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  const response = await fetch('/api/admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete-media', data: { id: item.id, title } }),
                  });
                  if (!response.ok) throw Error((await response.json()).error || 'Löschen fehlgeschlagen.');
                  try {
                    sessionStorage.setItem('history:invalidated', String(Date.now()));
                  } catch {
                    /* Storage-Zugriff darf das Löschen nicht blockieren. */
                  }
                  window.dispatchEvent(new Event('geza:catalog-changed'));
                  router.replace(
                    pathname.startsWith('/collections/title/')
                      ? collectionHref
                      : item.parent_id
                        ? `/title/${item.parent_id}`
                        : '/search',
                  );
                  router.refresh();
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              <label>
                Zur Bestätigung den Titel „{item.title}“ eingeben
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoComplete="off"
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="button-row">
                <button type="button" className="button" disabled={busy} onClick={() => setOpen(false)}>
                  Abbrechen
                </button>
                <button className="button danger" disabled={busy || title !== item.title}>
                  {busy ? 'Löscht …' : 'Endgültig löschen'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

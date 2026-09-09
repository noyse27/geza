'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';
import { useCollectionItems } from './collection-context';
export function CollectionModal({ children, id }: { children: React.ReactNode; id?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const items = useCollectionItems();
  const index = items.findIndex((item) => item.id === id);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (dialog.current) dialog.current.scrollTop = 0;
  }, [id]);
  return (
    <dialog
      ref={dialog}
      className="collection-modal"
      aria-label="Filmdetails"
      onCancel={(event) => {
        event.preventDefault();
        if (!dialog.current?.querySelector('.modal-backdrop')) router.back();
      }}
    >
      <div className="collection-modal-toolbar">
        {id && <Link href={`/title/${id}`}>Detailseite öffnen ↗</Link>}
        {index >= 0 && (
          <div className="button-row">
            <button
              className="button"
              disabled={index === 0}
              onClick={() => router.replace(`/collections/title/${items[index - 1].id}`, { scroll: false })}
            >
              ← Vorheriger
            </button>
            <button
              className="button"
              disabled={index === items.length - 1}
              onClick={() => router.replace(`/collections/title/${items[index + 1].id}`, { scroll: false })}
            >
              Nächster →
            </button>
          </div>
        )}
        <button
          autoFocus
          type="button"
          className="button"
          onClick={() => router.back()}
          aria-label="Filmdetails schließen"
        >
          <X size={18} /> Schließen
        </button>
      </div>
      {children}
    </dialog>
  );
}

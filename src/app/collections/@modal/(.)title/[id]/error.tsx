'use client';
import { CollectionModal } from '@/components/collection-modal';
export default function Error({ reset }: { reset: () => void }) {
  return (
    <CollectionModal>
      <div className="empty" role="alert">
        <p>Die Filmdetails konnten nicht geladen werden.</p>
        <button className="button" onClick={reset}>
          Erneut versuchen
        </button>
      </div>
    </CollectionModal>
  );
}

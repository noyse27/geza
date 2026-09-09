import { CollectionModal } from '@/components/collection-modal';
export default function Loading() {
  return (
    <CollectionModal>
      <div className="empty" role="status">
        Filmdetails werden geladen …
      </div>
    </CollectionModal>
  );
}

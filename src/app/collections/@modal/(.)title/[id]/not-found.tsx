import { CollectionModal } from '@/components/collection-modal';
export default function NotFound() {
  return (
    <CollectionModal>
      <div className="empty">Dieser Film ist nicht mehr vorhanden.</div>
    </CollectionModal>
  );
}

import { MediaDetail } from '@/components/media-detail';
import { CollectionModal } from '@/components/collection-modal';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CollectionModal id={id}>
      <MediaDetail id={id} modal />
    </CollectionModal>
  );
}

import { CollectionContext } from '@/components/collection-context';
export default function Layout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return (
    <CollectionContext>
      {children}
      {modal}
    </CollectionContext>
  );
}

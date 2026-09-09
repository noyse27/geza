'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
type ListItem = { id: string; title: string };
type List = { items: ListItem[]; href: string };
const Context = createContext<{ list: List; setList: (list: List) => void }>({
  list: { items: [], href: '/collections' },
  setList: () => {},
});
export function CollectionContext({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<List>({ items: [], href: '/collections' });
  const [dirty, setDirty] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const changed = () => setDirty(true);
    window.addEventListener('geza:catalog-changed', changed);
    return () => window.removeEventListener('geza:catalog-changed', changed);
  }, []);
  useEffect(() => {
    if (dirty && pathname === '/collections') {
      setDirty(false);
      router.refresh();
    }
  }, [dirty, pathname, router]);
  return <Context.Provider value={{ list, setList }}>{children}</Context.Provider>;
}
export function CollectionItems({ items, href }: List) {
  const { setList } = useContext(Context);
  useEffect(() => {
    setList({ items, href });
  }, [items, href, setList]);
  return null;
}
export function useCollectionItems() {
  return useContext(Context).list.items;
}
export function useCollectionHref() {
  return useContext(Context).list.href;
}

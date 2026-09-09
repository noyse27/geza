export const collectionCategories = {
  series: 'Filmreihen',
  genre: 'Genres',
  certification: 'FSK',
  country: 'Länder',
  year: 'Erscheinungsjahre',
  rating: 'GEZA-Bewertungen',
} as const;
export type CollectionCategory = keyof typeof collectionCategories;
export function isCollectionCategory(value: string): value is CollectionCategory {
  return Object.hasOwn(collectionCategories, value);
}
export function collectionHref(category: CollectionCategory, value?: string | number) {
  return (
    '/collections?' +
    new URLSearchParams({ category, ...(value !== undefined ? { value: String(value) } : {}) })
  );
}

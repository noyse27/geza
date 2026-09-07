export type ReviewMedia = {
  title: string;
  original_title: string;
  year: number | null;
  kind: string;
  ids: Record<string, string | number>;
};
export type ReviewModule = {
  id: string;
  name: string;
  scale: number;
  supports: (media: ReviewMedia) => boolean;
  validateUrl: (url: URL) => void;
  discover?: (media: ReviewMedia) => Promise<{ url: string; rating: number | null } | null>;
};

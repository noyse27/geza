import { plexRequest } from './plex';

type Metadata = Record<string, any>;
export function plexNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

// allLeaves can omit numbering that is available on the episode or its season.
// Never derive numbers from titles or turn an absent value into season zero.
export async function resolvePlexEpisodes(
  show: Metadata,
  items: Metadata[],
  readMetadata = async (id: string): Promise<Metadata | undefined> => {
    const response = await plexRequest(`/library/metadata/${encodeURIComponent(id)}?includeGuids=1`);
    const records = response?.MediaContainer?.Metadata;
    if (!Array.isArray(records)) throw Error(`Plex-Metadaten für Bibliotheksschlüssel ${id} fehlen`);
    return records.find((r: Metadata) => String(r.ratingKey) === id);
  },
) {
  const cache = new Map<string, Metadata | undefined>();
  const metadata = async (key: unknown) => {
    if (typeof key !== 'string' && typeof key !== 'number') return;
    const id = String(key);
    if (!id) return;
    if (!cache.has(id)) {
      cache.set(id, await readMetadata(id));
    }
    return cache.get(id);
  };
  const episodes: Metadata[] = [];
  const issues: Metadata[] = [];
  for (const raw of items) {
    let item = raw && typeof raw === 'object' ? { ...raw } : {};
    if (
      item.type !== 'episode' ||
      plexNumber(item.parentIndex) === undefined ||
      plexNumber(item.index) === undefined
    ) {
      const detail = await metadata(item.ratingKey);
      if (detail?.type === 'episode') item = { ...item, ...detail };
    }
    let season = plexNumber(item.parentIndex);
    const episode = plexNumber(item.index);
    if (season === undefined && item.type === 'episode') {
      const parent = await metadata(item.parentRatingKey);
      if (parent?.type === 'season' && String(parent.parentRatingKey) === String(show.ratingKey))
        season = plexNumber(parent.index);
    }
    const wrongShow =
      item.grandparentRatingKey != null && String(item.grandparentRatingKey) !== String(show.ratingKey);
    if (item.type !== 'episode' || season === undefined || episode === undefined || wrongShow) {
      issues.push({
        title: item.title ?? null,
        ratingKey: item.ratingKey ?? null,
        type: item.type ?? null,
        parentRatingKey: item.parentRatingKey ?? null,
        parentIndex: item.parentIndex ?? null,
        index: item.index ?? null,
        reason: wrongShow
          ? 'Episode gehört laut Plex zu einer anderen Serie'
          : 'Staffel- oder Episodenzuordnung fehlt',
      });
      continue;
    }
    episodes.push({ ...item, parentIndex: season, index: episode });
  }
  return { episodes, issues };
}

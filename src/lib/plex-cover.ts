// Only Plex library thumbnails, never arbitrary URLs or token-bearing query strings.
export function validPlexCoverPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/library\/metadata\/\d+\/thumb(?:\/\d+)?$/.test(value);
}

export function plexCoverFallback(raw: Record<string, any>): string | undefined {
  const candidates =
    raw.type === 'episode' ? [raw.grandparentThumb, raw.parentThumb, raw.thumb] : [raw.thumb];
  const path = candidates.find(validPlexCoverPath);
  return path ? `/api/admin/now-playing/cover?path=${encodeURIComponent(path)}` : undefined;
}

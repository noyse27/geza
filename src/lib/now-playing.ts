export type NowPlayingItem = {
  id: string;
  title: string;
  subtitle: string;
  state: 'playing' | 'paused' | 'buffering';
  duration: number;
  position: number;
  mediaId?: string;
  poster?: string;
};

// Keep only display data: session responses also contain tokens, addresses and user data.
export function playbackItem(raw: Record<string, any>): NowPlayingItem | null {
  if (!['movie', 'episode'].includes(raw.type)) return null;
  const state = raw.Player?.state;
  if (!['playing', 'paused', 'buffering'].includes(state)) return null;
  const duration = Number(raw.duration);
  const position = Number(raw.viewOffset);
  return {
    id: String(raw.sessionKey ?? raw.Session?.id ?? raw.ratingKey),
    title: String(
      raw.type === 'episode' ? raw.grandparentTitle || raw.title : raw.title || 'Unbekannter Titel',
    ),
    subtitle:
      raw.type === 'episode'
        ? `Staffel ${raw.parentIndex ?? '?'} · Episode ${raw.index ?? '?'} · ${raw.title || ''}`
        : String(raw.year || 'Film'),
    state,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    position: Number.isFinite(position) ? Math.max(0, Math.min(position, duration > 0 ? duration : 0)) : 0,
  };
}

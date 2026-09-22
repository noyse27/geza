import type { NowPlayingItem } from './now-playing';

export type DemoPlaybackMedia = {
  id: string;
  kind: 'movie' | 'episode';
  title: string;
  year: number | null;
  runtime: number | null;
  poster: string | null;
  parent_title: string | null;
  season: number | null;
  episode: number | null;
};

// Pure display simulation: never creates Plex sessions, watches, ratings or jobs.
// A shared clock keeps progress continuous across the UI's 15-second refreshes.
export function demoPlaybackItems(media: DemoPlaybackMedia[], now = Date.now()): NowPlayingItem[] {
  return media.map((item) => {
    const duration =
      (item.runtime && item.runtime > 0 ? item.runtime : item.kind === 'movie' ? 100 : 45) * 60000;
    const paused = item.kind === 'episode';
    return {
      id: `demo-${item.id}`,
      mediaId: item.id,
      title: item.kind === 'episode' ? item.parent_title || item.title : item.title,
      subtitle:
        item.kind === 'episode'
          ? `Staffel ${item.season ?? '?'} · Episode ${item.episode ?? '?'} · ${item.title}`
          : String(item.year || 'Film'),
      state: paused ? 'paused' : 'playing',
      duration,
      position: paused ? Math.floor(duration * 0.42) : ((now % duration) + duration) % duration,
      // Never use remote images from edited catalog data in simulated playback.
      poster: item.poster && /^\/api\/posters\/\d+$/.test(item.poster) ? item.poster : undefined,
      simulated: true,
    };
  });
}

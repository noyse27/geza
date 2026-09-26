import { getMedia } from './catalog';
import { query } from './db';
import type { Media } from './types';

export async function seasonNavigation(media: Media, admin: boolean) {
  let show = media.kind === 'show' ? media : media.parent_id ? await getMedia(media.parent_id, admin) : null;
  const parentSeasonId = show?.kind === 'season' ? show.id : null;
  if (show?.kind === 'season') show = show.parent_id ? await getMedia(show.parent_id, admin) : null;
  if (show?.kind !== 'show') return null;
  const seasons = await query<{ id: string; season: number }>(
    `SELECT id,season FROM media WHERE kind='season' AND parent_id=$1
     AND season IS NOT NULL AND ($2 OR NOT rumpel) ORDER BY season,id`,
    [show.id, admin],
  );
  return {
    show,
    seasons,
    season: seasons.find((season) =>
      parentSeasonId ? season.id === parentSeasonId : season.season === media.season,
    ),
  };
}

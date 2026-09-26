'use client';

import { useRouter } from 'next/navigation';

export function SeasonSelector({
  showId,
  currentId,
  seasons,
}: {
  showId: string;
  currentId: string;
  seasons: { id: string; season: number }[];
}) {
  const router = useRouter();
  return (
    <label className="season-selector">
      Serie / Staffel
      <select value={currentId} onChange={(event) => router.push(`/title/${event.target.value}`)}>
        <option value={showId}>Gesamte Serie</option>
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            Staffel {season.season}
          </option>
        ))}
      </select>
    </label>
  );
}

'use client';
import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ViewCounter({
  mediaId,
  initial,
  count = true,
}: {
  mediaId: string;
  initial: number;
  count?: boolean;
}) {
  const [views, setViews] = useState(initial);
  useEffect(() => {
    if (!count) return;
    const controller = new AbortController();
    void fetch('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId }),
      signal: controller.signal,
      keepalive: true,
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (typeof data?.views === 'number') setViews(data.views);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [count, mediaId]);
  return (
    <span className="view-counter" title="Öffentliche Seitenaufrufe">
      <Eye size={15} aria-hidden="true" /> {views.toLocaleString('de-DE')} Aufruf{views === 1 ? '' : 'e'}
    </span>
  );
}

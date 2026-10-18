'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { MediaCard } from '@/components/media';
import type { Media } from '@/lib/types';

export function HomeShelf({
  fresh,
  commented,
  freshLabel,
}: {
  fresh: Media[];
  commented: Media[];
  freshLabel: string;
}) {
  const [active, setActive] = useState<'fresh' | 'commented'>('fresh');
  const items = active === 'fresh' ? fresh : commented;
  return (
    <>
      <div className="section-heading shelf-heading">
        <div>
          <span className="eyebrow">DAS KATALOGREGAL</span>
          <div className="shelf-tabs" role="tablist" aria-label="Katalogauswahl">
            <button
              type="button"
              role="tab"
              id="shelf-tab-fresh"
              aria-controls="shelf-panel"
              aria-selected={active === 'fresh'}
              onClick={() => setActive('fresh')}
            >
              {freshLabel}
            </button>
            <button
              type="button"
              role="tab"
              id="shelf-tab-commented"
              aria-controls="shelf-panel"
              aria-selected={active === 'commented'}
              onClick={() => setActive('commented')}
            >
              Zuletzt kommentiert
            </button>
          </div>
        </div>
        <Link className="text-link" href="/search">
          Alle Titel <ArrowUpRight size={16} />
        </Link>
      </div>
      <div
        id="shelf-panel"
        role="tabpanel"
        aria-labelledby={active === 'fresh' ? 'shelf-tab-fresh' : 'shelf-tab-commented'}
      >
        {items.length ? (
          <div className="poster-grid">
            {items.map((media) => (
              <MediaCard key={media.id} item={media} />
            ))}
          </div>
        ) : (
          <div className="empty">
            {active === 'commented'
              ? 'Noch keine veröffentlichten Kommentare.'
              : 'Der Katalog wird gerade eingerichtet. Bald findest du hier die ersten Titel.'}
          </div>
        )}
      </div>
    </>
  );
}

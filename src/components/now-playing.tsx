'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Film, Play, Pause } from 'lucide-react';
import type { NowPlayingItem } from '@/lib/now-playing';

export function NowPlaying() {
  const [items, setItems] = useState<NowPlayingItem[]>([]);
  const [received, setReceived] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        if (document.visibilityState === 'hidden') return;
        const response = await fetch('/api/admin/now-playing', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw Error('Plex unavailable');
        const data = await response.json();
        if (!controller.signal.aborted) {
          setItems(data.items);
          setReceived(Date.now());
          setNow(Date.now());
        }
      } catch {
        if (!controller.signal.aborted) setItems([]);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 15000);
      }
    }
    void refresh();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, []);
  if (!items.length) return null;
  return (
    <section
      className="now-playing"
      aria-label={items.some((item) => item.simulated) ? 'Simulierte Wiedergabe' : 'Jetzt auf Plex'}
    >
      {items.map((item) => {
        const position = Math.min(
          item.duration,
          item.position + (item.state === 'playing' ? Math.max(0, now - received) : 0),
        );
        const remaining = Math.max(0, item.duration - position);
        const minutes = Math.ceil(remaining / 60000);
        const time = `${minutes >= 60 ? `${Math.floor(minutes / 60)} Std. ` : ''}${minutes % 60} Min.`;
        return (
          <article className="now-playing-card" key={item.id}>
            <div className="now-playing-poster">
              {item.poster ? <img src={item.poster} alt="" /> : <Film size={32} />}
            </div>
            <div className="now-playing-info">
              <span className="eyebrow accent">
                {item.state === 'paused' ? <Pause size={14} /> : <Play size={14} />}{' '}
                {item.state === 'paused'
                  ? 'Pausiert'
                  : item.state === 'buffering'
                    ? 'Wird geladen'
                    : 'Now Playing'}{' '}
                · {item.simulated ? 'Demo · Simuliert' : 'Plex'}
              </span>
              <h2>{item.mediaId ? <Link href={`/title/${item.mediaId}`}>{item.title}</Link> : item.title}</h2>
              <p className="muted">{item.subtitle}</p>
              {item.duration > 0 && (
                <>
                  <div className="now-playing-time">
                    <span>Noch {time}</span>
                    {item.state === 'playing' && (
                      <span>
                        Endet ca.{' '}
                        {new Date(now + remaining).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Europe/Berlin',
                        })}{' '}
                        Uhr
                      </span>
                    )}
                  </div>
                  <progress
                    value={position}
                    max={item.duration}
                    aria-label={`Wiedergabefortschritt: ${item.title}`}
                  />
                </>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

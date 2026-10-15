'use client';

import { Check, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type ShareStatus = 'idle' | 'copied' | 'error';

async function copyLink(url: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }

  const input = document.createElement('textarea');
  input.value = url;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw Error('Link konnte nicht kopiert werden.');
}

export function ShareButton({ title, year }: { title: string; year: number | null }) {
  const [status, setStatus] = useState<ShareStatus>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  function showStatus(next: Exclude<ShareStatus, 'idle'>) {
    setStatus(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus('idle'), 2500);
  }

  async function share() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    const shareData = {
      title: `${title}${year ? ` (${year})` : ''} · Geza`,
      url: url.toString(),
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }

    try {
      await copyLink(shareData.url);
      showStatus('copied');
    } catch {
      showStatus('error');
    }
  }

  const label =
    status === 'copied' ? 'Link kopiert' : status === 'error' ? 'Kopieren fehlgeschlagen' : 'Teilen';

  return (
    <button type="button" className="button" onClick={share} aria-live="polite">
      {status === 'copied' ? <Check size={15} /> : <Share2 size={15} />}
      {label}
    </button>
  );
}

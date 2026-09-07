'use client';
import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

export function ScrollTop() {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const distance = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0);
        setVisible(window.scrollY > 250);
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return (
    <button
      className="scroll-top"
      hidden={!visible}
      aria-label="Zum Seitenanfang"
      title="Zum Seitenanfang"
      onClick={() =>
        window.scrollTo({
          top: 0,
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        })
      }
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="21" pathLength="100" strokeDasharray={`${progress * 100} 100`} />
      </svg>
      <ArrowUp size={20} aria-hidden="true" />
    </button>
  );
}

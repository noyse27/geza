import { ImageResponse } from 'next/og';
import { getMedia } from '@/lib/catalog';
import { getShareData } from '@/lib/share-data';
import { shareExcerpt } from '@/lib/share-metadata';
export const runtime = 'nodejs';
export const alt = 'Geza: Film, Bewertung und Review';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getMedia(id);
  const { rating, review } = m ? await getShareData(id) : { rating: undefined, review: undefined };
  const excerpt = shareExcerpt(m?.summary || '', review);
  const name =
    m?.kind === 'season' && m.parent_title ? `${m.parent_title} – Staffel ${m.season}` : m?.title || 'Geza';
  const title = name.length > 85 ? name.slice(0, 82) + '…' : name;
  const facts = [m?.year, m?.runtime ? `${m.runtime} Min.` : null, m?.certification]
    .filter(Boolean)
    .join(' · ');
  const posterUrl = m?.poster
    ? m.poster.startsWith('http')
      ? m.poster
      : process.env.PUBLIC_URL
        ? `${process.env.PUBLIC_URL}${m.poster}`
        : null
    : null;
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        background: '#151714',
        color: '#efefe6',
        fontFamily: 'sans-serif',
        padding: '44px 48px',
        gap: 36,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: 220, flexShrink: 0, gap: 24 }}>
        <div style={{ display: 'flex', color: '#d1e89b', fontSize: 32, fontWeight: 700 }}>geza.</div>
        {posterUrl ? (
          <img src={posterUrl} width={220} height={330} style={{ objectFit: 'contain' }} alt="" />
        ) : (
          <div
            style={{
              display: 'flex',
              width: 220,
              height: 330,
              background: '#23271f',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#a0a794',
              fontSize: 24,
            }}
          >
            Film &amp; Review
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 18, color: '#a0a794' }}>Filme. Eigene Perspektiven.</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', width: 848, paddingTop: 4 }}>
        <div
          style={{
            display: 'flex',
            fontSize: title.length > 55 ? 34 : 44,
            fontWeight: 700,
            lineHeight: 1.12,
            overflowWrap: 'anywhere',
          }}
        >
          {title}
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: '#a0a794', marginTop: 14 }}>{facts}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 22, color: '#d1e89b' }}>
          <span style={{ fontSize: rating != null ? 64 : 30, fontWeight: 700 }}>
            {rating != null ? `${rating}/10` : 'Noch nicht bewertet'}
          </span>
          {rating != null && <span style={{ fontSize: 22 }}>Meine Bewertung</span>}
        </div>
        {excerpt.text && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 20,
              borderTop: '1px solid #33382d',
              paddingTop: 20,
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', fontSize: 18, color: '#a0a794' }}>{excerpt.label}</div>
            <div style={{ display: 'flex', fontSize: 28, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
              {excerpt.text}
            </div>
          </div>
        )}
      </div>
    </div>,
    { ...size },
  );
}

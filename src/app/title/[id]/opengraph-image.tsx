import { ImageResponse } from 'next/og';
import { getMedia } from '@/lib/catalog';
import { query } from '@/lib/db';
export const runtime = 'nodejs';
export const alt = 'Geza';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getMedia(id);
  const rating = m ? (await query('SELECT rating FROM ratings WHERE media_id=$1', [id]))[0]?.rating : null;
  const posterUrl = m?.poster
    ? m.poster.startsWith('http')
      ? m.poster
      : process.env.PUBLIC_URL
        ? `${process.env.PUBLIC_URL}${m.poster}`
        : null
    : null;
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: '#0b0b10',
          color: '#fff',
          fontFamily: 'sans-serif',
        }}
      >
        {posterUrl && (
          <img src={posterUrl} width={420} height={630} style={{ objectFit: 'cover' }} alt="" />
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '64px',
            flex: 1,
          }}
        >
          <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, lineHeight: 1.2 }}>
            {m ? `${m.title}${m.year ? ` (${m.year})` : ''}` : 'Geza'}
          </div>
          {rating != null && (
            <div style={{ display: 'flex', fontSize: 40, marginTop: 24, color: '#f5c518' }}>
              {'★'.repeat(rating) + '☆'.repeat(10 - rating)}
              <span style={{ color: '#999', marginLeft: 16 }}>{rating}/10</span>
            </div>
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}

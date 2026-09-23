import { ImageResponse } from 'next/og';
import { getMedia } from '@/lib/catalog';
export const runtime = 'nodejs';
export const alt = 'Geza';
export const size = { width: 600, height: 900 };
export const contentType = 'image/png';
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getMedia(id);
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
        }}
      >
        {posterUrl ? (
          <img src={posterUrl} width={600} height={900} style={{ objectFit: 'cover' }} alt="" />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: '100%',
              color: '#fff',
              fontFamily: 'sans-serif',
              fontSize: 48,
              fontWeight: 700,
            }}
          >
            Geza
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}

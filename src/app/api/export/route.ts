import { isAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'Anmeldung erforderlich' }, { status: 401 });
  const [media, watches, ratings, reviews, friendReviews, providerRatings] = await Promise.all([
    query(
      'SELECT id,kind,title,original_title,year,parent_id,season,episode,ids,summary,countries,genres,directors,actors,certification,runtime,poster,locked_fields FROM media',
    ),
    query(
      'SELECT media_id,source,source_id,watched_at,original_watched_at,time_estimated FROM watches ORDER BY watched_at DESC NULLS LAST',
    ),
    query('SELECT * FROM ratings'),
    query('SELECT * FROM reviews'),
    query('SELECT * FROM friend_reviews'),
    query('SELECT * FROM provider_ratings'),
  ]);
  return Response.json(
    {
      format: 'geza-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      media,
      watches,
      ratings,
      reviews,
      friendReviews,
      providerRatings,
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="geza-export.json"',
      },
    },
  );
}

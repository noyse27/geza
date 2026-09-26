import { friendForRequest, localLookup } from '@/lib/federation';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const friend = await friendForRequest(req);
  if (!friend) return new Response(null, { status: 401 });
  const params = new URL(req.url).searchParams;
  const id = (name: string) => (params.get(name) || '').slice(0, 40);
  return Response.json(await localLookup(id('kind'), id('tmdb'), id('imdb')), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

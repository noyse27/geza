import { query } from '@/lib/db';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new Response(null, { status: 404 });
  const row = (await query('SELECT content_type,data,etag FROM posters WHERE media_id=$1', [id]))[0];
  if (!row) return new Response(null, { status: 404 });
  const headers = {
    'Content-Type': row.content_type,
    'Cache-Control': 'public, max-age=86400',
    ETag: `"${row.etag}"`,
  };
  if (req.headers.get('if-none-match') === headers.ETag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(row.data), { headers });
}

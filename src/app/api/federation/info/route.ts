import { federationEnabled, instanceNickname, instanceUrl } from '@/lib/federation';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!federationEnabled()) return new Response(null, { status: 404 });
  return Response.json({ geza: true, url: instanceUrl(), nickname: await instanceNickname() });
}

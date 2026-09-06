import { searchCatalog } from '@/lib/catalog';
import { isAdmin } from '@/lib/auth';
export async function GET(req:Request) { const result=await searchCatalog(new URL(req.url).searchParams,await isAdmin()); return Response.json(result,{headers:{'Cache-Control':'private, no-store','Server-Timing':`search;dur=${result.elapsed}`}}); }

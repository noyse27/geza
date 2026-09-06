import { query } from '@/lib/db';
import { xmlEscape } from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET() { const base=process.env.PUBLIC_URL; if(!base) return new Response('Sitemap erst nach Domain-Konfiguration verfügbar.',{status:404}); const count=Number((await query('SELECT count(*) FROM media'))[0].count); const pages=Math.ceil(count/10000); const body=Array.from({length:pages},(_,i)=>`<sitemap><loc>${xmlEscape(base)}/sitemaps/${i}</loc></sitemap>`).join(''); return new Response(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`,{headers:{'Content-Type':'application/xml','Cache-Control':'public, max-age=300'}}); }

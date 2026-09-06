import type { MetadataRoute } from 'next';
export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  const base = process.env.PUBLIC_URL;
  return base
    ? {
        rules: {
          userAgent: '*',
          allow: ['/', '/title/'],
          disallow: ['/home', '/history', '/data', '/stats', '/admin', '/login', '/api/', '/search'],
        },
        sitemap: `${base}/sitemap.xml`,
      }
    : { rules: { userAgent: '*', disallow: '/' } };
}

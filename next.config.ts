import type { NextConfig } from 'next';
import { HTML_LIMITED_BOT_UA_RE } from 'next/dist/shared/lib/router/utils/html-bots';
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Extend the framework defaults: overriding this with only Meta would regress other previews.
  htmlLimitedBots: new RegExp(
    `${HTML_LIMITED_BOT_UA_RE.source}|Facebot|meta-externalagent|meta-externalfetcher|FBAN/|FBAV/`,
    'i',
  ),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default config;

import type { NextConfig } from 'next';

// Launch gate — mirrors src/lib/site-url.ts resolution so the HTTP
// response headers and the page `<meta robots>` cannot disagree:
//
//   • Explicit SITE_LAUNCHED=false → hold pre-launch (kill switch).
//   • Explicit SITE_LAUNCHED=true (BOM, surrounding quotes and
//     whitespace tolerated — these are a known Vercel env export
//     artefact) → launched.
//   • Otherwise → launched when VERCEL_ENV==='production', else
//     pre-launch (previews + local dev stay noindex automatically).
//
// Previously the strict equality `process.env['SITE_LAUNCHED'] !== 'true'`
// mis-classified a quoted/BOM-prefixed `"true"` as pre-launch, so
// the X-Robots-Tag header kept emitting `noindex, nofollow` even
// though the page metadata resolved to `index, follow`. The HTTP
// header takes precedence over the meta, which quietly held GSC
// coverage at zero.
function isSiteLaunched(): boolean {
  const raw = (process.env['SITE_LAUNCHED'] ?? '')
    .replace(/[﻿​\s"]+/g, '')
    .toLowerCase();
  if (raw === 'false') return false;
  if (raw === 'true') return true;
  return process.env['VERCEL_ENV'] === 'production';
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  // ESLint config is deferred to a later slice — tsc is our source of
  // truth for build-time correctness. Match the yugioh app's posture.
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      // Public catalogue images for Lorcana sources land under Supabase
      // storage or the tcggraph CDN. Add hosts as they arrive; keep the
      // list tight.
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'lorcana-api.com' },
      { protocol: 'https', hostname: 'images.lorcana.tcgcollector.com' },
      { protocol: 'https', hostname: 'assets.tcgplayer.com' },
    ],
  },
  async headers() {
    const preLaunch = !isSiteLaunched();
    const baseline = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ...(preLaunch
        ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
        : []),
      {
        key: 'Permissions-Policy',
        value: [
          'accelerometer=()',
          'autoplay=()',
          'browsing-topics=()',
          'camera=()',
          'display-capture=()',
          'encrypted-media=()',
          'fullscreen=(self)',
          'geolocation=()',
          'gyroscope=()',
          'magnetometer=()',
          'microphone=()',
          'midi=()',
          'payment=()',
          'picture-in-picture=(self)',
          'publickey-credentials-get=()',
          'screen-wake-lock=()',
          'sync-xhr=()',
          'usb=()',
          'xr-spatial-tracking=()',
        ].join(', '),
      },
    ];
    return [
      {
        source: '/:path*',
        headers: baseline,
      },
    ];
  },
};

export default nextConfig;

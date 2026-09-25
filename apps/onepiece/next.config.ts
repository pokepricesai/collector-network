import type { NextConfig } from 'next';

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
      // Public catalogue images for TCG sources land under Supabase
      // storage or the tcggraph CDN. Add hosts as they arrive; keep the
      // list tight.
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'en.onepiece-cardgame.com' },
      { protocol: 'https', hostname: 'asia-en.onepiece-cardgame.com' },
      { protocol: 'https', hostname: 'images.onepiece.tcgcollector.com' },
    ],
  },
  async headers() {
    const preLaunch = process.env['SITE_LAUNCHED'] !== 'true';
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

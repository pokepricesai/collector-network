import type { Metadata, Viewport } from 'next';
import { ReactNode } from 'react';
import { SITE_NAME, SITE_URL } from '@/lib/sites';

const PRODUCTION_DOMAIN = process.env['VERCEL_ENV'] === 'production';
const DESCRIPTION =
  'Collector Network brings together specialist pricing, market data and collection platforms for Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece and Disney Lorcana collectors.';

// Root layout. Deliberately minimal — the public site and the
// private admin surface have different shells. The public shell
// (header + footer + global styles) lives in `(site)/layout.tsx`;
// the admin shell (left rail + top bar + admin styles) lives in
// `admin/layout.tsx`. Only `<html>` and `<body>` live here.

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | Trading Card Pricing & Collector Platforms`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} | Trading Card Pricing & Collector Platforms`,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: DESCRIPTION,
  },
  alternates: { canonical: SITE_URL },
  robots: PRODUCTION_DOMAIN
    ? {
        index: true,
        follow: true,
        googleBot: {
          index: true,
          follow: true,
          'max-video-preview': -1,
          'max-image-preview': 'large',
          'max-snippet': -1,
        },
      }
    : { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FAFAFA',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

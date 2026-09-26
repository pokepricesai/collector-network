import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import SiteStructuredData from '@/components/SiteStructuredData';
import { AccountChip } from '@/components/AccountChip';
import { SITE_LAUNCHED, SITE_URL } from '@/lib/site-url';

const SITE_NAME = 'LorcanaPrice';
const SITE_TAGLINE = 'Live Disney Lorcana prices, sets and Enchanted chases';
// Marketing copy only names treatments we can back with production
// data — see docs/lorcana/data-audit.md §3 and §4. Enchanted, Iconic,
// Epic, Legendary and Promo are the honest chase axes; foil vs
// nonfoil is the finish axis. No language variants exist in the
// current ingest.
const SITE_DESCRIPTION =
  'LorcanaPrice. Live Disney Lorcana card prices, printings and chase treatments — Enchanted, Iconic, Epic, Legendary and Promo cards priced individually across foil and nonfoil. Set catalogue, ink discovery, market movers and graded-price history. Free, no login required. Not affiliated with Disney or Ravensburger.';

const LAUNCHED_ROBOTS: NonNullable<Metadata['robots']> = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    'max-video-preview': -1,
    'max-image-preview': 'large',
    'max-snippet': -1,
  },
};

const PRE_LAUNCH_ROBOTS: NonNullable<Metadata['robots']> = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: {
    index: false,
    follow: false,
    noimageindex: true,
  },
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}. ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME}. ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME}. ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  alternates: { canonical: SITE_URL },
  robots: SITE_LAUNCHED ? LAUNCHED_ROBOTS : PRE_LAUNCH_ROBOTS,
};

// Next 15 pulls viewport out of metadata; without this every page ships
// without the device-width viewport meta tag and mobile browsers zoom
// out to 980px. That was the root cause of the mobile overflow in the
// first QA pass.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F6EFE0',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Figtree:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-screen flex flex-col"
        style={{ background: 'var(--bg)', color: 'var(--text)' }}
      >
        <SiteStructuredData />
        <Navbar accountSlot={<AccountChip />} />
        <main className="flex-1">{children}</main>
        <Footer />
        {/* Vercel Web Analytics — anonymous page-view counts + the
            track() API for custom events. Only records data on
            production deployments; a no-op on dev + preview. Same
            wiring as apps/yugioh. Add Google Analytics 4 later via
            a small client component if the network standardises on
            it. */}
        <Analytics />
      </body>
    </html>
  );
}

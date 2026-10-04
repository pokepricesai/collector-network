import type { Metadata } from 'next';
import type { HTMLAttributes, ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { GoogleAnalytics } from '@collector-network/analytics';
import { AffiliateTracking } from '@collector-network/affiliate-tracking/client';
import { ygoFontClassName } from '../design/fonts';
import '../design/tokens.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://ygoprices.io'),
  title: {
    default: 'YGOPrices: Yu-Gi-Oh! card prices, printings, rarities and graded values',
    template: '%s · YGOPrices',
  },
  description:
    'Every Yu-Gi-Oh! card, every printing, every rarity. Live retail and graded market values. Collection tracking, deck building, Forbidden and Limited, market movers.',
  applicationName: 'YGOPrices',
  openGraph: {
    type: 'website',
    siteName: 'YGOPrices',
    url: 'https://ygoprices.io',
    title: 'YGOPrices: Yu-Gi-Oh! card prices, printings, rarities and graded values',
    description:
      'Every Yu-Gi-Oh! card, every printing, every rarity. Live retail and graded market values.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'YGOPrices: Yu-Gi-Oh! card prices, printings, rarities and graded values',
    description:
      'Every Yu-Gi-Oh! card, every printing, every rarity. Live retail and graded market values.',
  },
  robots: { index: true, follow: true },
  verification: {
    // Google Search Console ownership verification. Emitted globally
    // as <meta name="google-site-verification" content="..."> by
    // Next's Metadata API so every public route inherits it and no
    // route can accidentally drop it.
    google: 'A4mrElgE5m9Ht5AfcVqb_b0pDBh9FUTeJ2NUbVOqUpI',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={ygoFontClassName}>
      <head>
        {/* Impact.com TCG affiliate site-verification tag. Impact
            reads the `value` attribute, not the `content` attribute
            Next's Metadata API would produce, so we render it directly
            in the root <head>. Once here means every public route
            inherits it without duplication and without touching the
            robots metadata above. Cast because React's HTMLMetaElement
            types only declare `content`. */}
        <meta {...({ name: 'impact-site-verification', value: 'f007a060-45e7-4b7d-adc4-d642c2d73f83' } as HTMLAttributes<HTMLMetaElement>)} />
      </head>
      <body>
        {children}
        {/* Vercel Web Analytics - anonymous page-view counts. Custom
            events are fired from client components via `track()` in
            src/lib/analytics.ts. Runs only on production; disabled in
            dev and preview by default. */}
        <Analytics />
        {/* GA4 via shared @collector-network/analytics. Safe no-op
            when NEXT_PUBLIC_GA_ID is unset. */}
        <GoogleAnalytics />
        {/* Phase 5: capture-phase click beacons for <a data-affiliate="1">
            links. Fire-and-forget; never blocks navigation. */}
        <AffiliateTracking />
      </body>
    </html>
  );
}

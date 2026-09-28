import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { GoogleAnalytics } from '@collector-network/analytics';
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
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={ygoFontClassName}>
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
      </body>
    </html>
  );
}

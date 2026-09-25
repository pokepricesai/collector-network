import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { ygoFontClassName } from '../design/fonts';
import '../design/tokens.css';

export const metadata: Metadata = {
  title: 'Yu-Gi-Oh! - Collector Network',
  description: 'Yu-Gi-Oh! specialist site (foundation).',
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
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ygoFontClassName } from '../design/fonts';
import '../design/tokens.css';

export const metadata: Metadata = {
  title: 'Yu-Gi-Oh! — Collector Network',
  description: 'Yu-Gi-Oh! specialist site (foundation).',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={ygoFontClassName}>
      <body>{children}</body>
    </html>
  );
}

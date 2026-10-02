import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './admin.css';

// Private admin area. Noindex at every level, excluded from the
// public sitemap and robots. Server-side authentication enforcement
// lives in each page via `requireAdmin()`; this layout only
// handles the CSS boundary.
//
// Important: NO SSR check here. If we redirected from the layout,
// the login/denied screens that live INSIDE /admin would never be
// reachable (they would redirect themselves). Each real admin page
// calls requireAdmin() at the top, which is the actual security
// boundary.

export const metadata: Metadata = {
  title: {
    default: 'Admin — Collector Network OS',
    template: '%s — Collector Network OS',
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

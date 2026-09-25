// Single source of truth for the site's canonical origin and its
// public launch state. Kept minimal so every page metadata / sitemap
// route reaches for the same values.

export const SITE_LAUNCHED = process.env['SITE_LAUNCHED'] === 'true';

// Deployment writes NEXT_PUBLIC_SITE_URL. Default here is the
// intended production origin; it is safe to expose because it is
// public. Never www; always https.
const RAW =
  process.env['NEXT_PUBLIC_SITE_URL'] ??
  process.env['SITE_URL'] ??
  'https://onepieceprices.io';

// Strip trailing slash so callers can build `${SITE_URL}${path}` safely.
export const SITE_URL = RAW.replace(/\/+$/, '');

export function absoluteUrl(path: string): string {
  if (!path.startsWith('/')) return `${SITE_URL}/${path}`;
  return `${SITE_URL}${path}`;
}

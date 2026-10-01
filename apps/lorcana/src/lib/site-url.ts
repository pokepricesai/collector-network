// Single source of truth for the site's canonical origin and its
// public launch state. Kept minimal so every page metadata / sitemap
// route reaches for the same values.

export const SITE_LAUNCHED = process.env['SITE_LAUNCHED'] === 'true';

// Deployment writes NEXT_PUBLIC_SITE_URL. Default here is the
// intended production origin; it is safe to expose because it is
// public. Vercel's project domain config permanently redirects the
// apex to www, so canonicals + auth redirectTo values use www to
// avoid a double-hop at serve time.
const RAW =
  process.env['NEXT_PUBLIC_SITE_URL'] ??
  process.env['SITE_URL'] ??
  'https://www.lorcanaprices.io';

// Defensive sanitisation. The value can arrive with:
//   • a UTF-8 BOM (U+FEFF) baked in — PowerShell's `vercel env add`
//     pipeline encoding is a known source of this
//   • surrounding double quotes if the deploy pipeline forwards the
//     literal .env line instead of the value
//   • leading/trailing whitespace
// All three would make `new URL(SITE_URL)` throw at build time,
// which is what broke the previous deploy.
const CLEANED = RAW
  .replace(/[﻿​]/g, '')
  .trim()
  .replace(/^"|"$/g, '')
  .trim();

// Strip trailing slash so callers can build `${SITE_URL}${path}` safely.
export const SITE_URL = CLEANED.replace(/\/+$/, '');

export function absoluteUrl(path: string): string {
  if (!path.startsWith('/')) return `${SITE_URL}/${path}`;
  return `${SITE_URL}${path}`;
}

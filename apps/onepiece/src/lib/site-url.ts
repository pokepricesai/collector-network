// Single source of truth for the site's canonical origin and its
// public launch state. Kept minimal so every page metadata / sitemap
// route reaches for the same values.

// Launched flag. Reads `SITE_LAUNCHED=true` from the environment when
// set (trimmed so an accidental trailing newline doesn't defeat the
// check). Also lands as `true` by hardcoded default now that Luke has
// approved the site for indexing — this is the OnePiecePrices launch
// commit. Set `SITE_LAUNCHED=false` explicitly to re-noindex if
// needed for maintenance.
const RAW_LAUNCH = (process.env['SITE_LAUNCHED'] ?? '').trim();
export const SITE_LAUNCHED = RAW_LAUNCH === 'false' ? false : true;

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

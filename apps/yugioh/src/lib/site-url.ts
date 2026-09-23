// Single source for the production origin. Every canonical URL, OG
// URL, sitemap entry, JSON-LD graph, and robots directive resolves
// through this helper so the site's public origin can be moved by
// setting one environment variable.
//
// Fallback is a deliberately-unreachable *.example placeholder so
// misconfigured deploys are obvious rather than silently pointing at
// a wrong-but-valid domain. Choose the real domain in Slice 10 (public
// launch) and set NEXT_PUBLIC_SITE_URL in Vercel; no code change
// needed.

// eslint-disable-next-line @typescript-eslint/dot-notation
const FALLBACK = 'https://duelistprices.example';

export function siteUrl(): string {
  const configured = process.env['NEXT_PUBLIC_SITE_URL'];
  if (configured && configured.trim().length > 0) return trimTrailingSlash(configured);
  return FALLBACK;
}

// Convenience: returns the fully qualified URL for a path. `path`
// should include the leading slash.
export function absoluteUrl(path: string): string {
  const origin = siteUrl();
  if (!path.startsWith('/')) return `${origin}/${path}`;
  return `${origin}${path}`;
}

function trimTrailingSlash(v: string): string {
  return v.endsWith('/') ? v.slice(0, -1) : v;
}

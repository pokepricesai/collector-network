// packages/seo/src/site-url.ts
// Canonical origin + launch-state helpers.
//
// Every specialist site consumes this via the shared package so the
// SITE_LAUNCHED gate + NEXT_PUBLIC_SITE_URL fallback logic never drifts.
//
// Callers wrap this with a site-specific default URL (typically
// hardcoded to their production domain) via `createSiteUrl`.

export interface SiteUrlOptions {
  /** Production domain fallback if no env var is set. e.g.
   *  'https://ygoprices.io'. Must be https and have no trailing slash. */
  productionDefault: string;
}

export interface SiteUrl {
  /** True when SITE_LAUNCHED=='true' in env. */
  readonly launched: boolean;
  /** Canonical origin, no trailing slash. */
  readonly origin: string;
  /** Absolute URL for a given path (path may start with `/` or not). */
  absolute(path: string): string;
}

/** Build a site-scoped url helper. */
export function createSiteUrl(opts: SiteUrlOptions): SiteUrl {
  const launched = process.env['SITE_LAUNCHED'] === 'true';
  const raw =
    process.env['NEXT_PUBLIC_SITE_URL'] ??
    process.env['SITE_URL'] ??
    opts.productionDefault;
  const origin = raw.replace(/\/+$/, '');
  return {
    launched,
    origin,
    absolute(path: string) {
      if (!path.startsWith('/')) return `${origin}/${path}`;
      return `${origin}${path}`;
    },
  };
}

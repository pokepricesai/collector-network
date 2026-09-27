// packages/seo/src/domain.ts
// Production-domain validation for the specialist-sites launch
// programme. Every canonical/OG/sitemap URL must (a) start with
// https://, (b) not point at localhost, and (c) not point at a
// preview subdomain. This module gives callers a fast assertion.
//
// Note: does NOT enforce a specific expected host. Callers pass their
// production host in — the SEO layer just checks structure. Per-app
// SITE_URL const still holds the canonical value.

const FORBIDDEN_HOST_FRAGMENTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '.vercel.app',
  '.now.sh',
  '.pages.dev',
  '.ngrok.io',
];

export interface DomainCheck {
  ok: boolean;
  reasons: string[];
}

/** Validate a fully-qualified URL that will be baked into a canonical,
 *  OG:url, sitemap <loc>, robots sitemap directive, etc. */
export function assertProductionUrl(url: string): DomainCheck {
  const reasons: string[] = [];
  let u: URL | null = null;
  try {
    u = new URL(url);
  } catch {
    reasons.push('malformed URL');
    return { ok: false, reasons };
  }
  if (u.protocol !== 'https:') reasons.push(`must be https, got ${u.protocol}`);
  const host = u.host.toLowerCase();
  for (const frag of FORBIDDEN_HOST_FRAGMENTS) {
    if (host === frag || host.endsWith(frag)) {
      reasons.push(`host contains forbidden fragment "${frag}"`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** Same check plus host equality. Useful in unit tests. */
export function assertExactProductionHost(url: string, expectedHost: string): DomainCheck {
  const base = assertProductionUrl(url);
  if (!base.ok) return base;
  const u = new URL(url);
  if (u.host !== expectedHost) {
    return { ok: false, reasons: [`expected host ${expectedHost}, got ${u.host}`] };
  }
  return base;
}

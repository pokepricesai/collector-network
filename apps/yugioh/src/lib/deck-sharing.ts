// Slice G — pure sharing helpers.
//
// Slug + share-token generation, visibility validation, and public
// URL / share URL construction. All pure — no DB, no crypto imports
// that require Node, just Web Crypto (available in both Next server
// runtimes and modern browsers).

export type Visibility = 'private' | 'unlisted' | 'public';
export const VISIBILITY_VALUES: readonly Visibility[] = ['private', 'unlisted', 'public'];

export function isVisibility(v: unknown): v is Visibility {
  return typeof v === 'string' && (VISIBILITY_VALUES as readonly string[]).includes(v);
}

// ── Public-slug generation ───────────────────────────────────────
//
// A public slug is <human-readable-name>-<8-char-random>. The random
// suffix is generated ONCE at first publish and is not regenerated
// on rename — so a URL stays valid even after the owner renames.
// Suffix chars are lowercase alphanumeric so URLs are case-tolerant.

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function slugifyDeckName(name: string, maxLen = 60): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '');
  // Empty base (all punctuation) falls back to "deck" so we always
  // get a readable slug plus suffix.
  return base.length > 0 ? base : 'deck';
}

// 8 chars from a 36-char alphabet ≈ 41 bits — collision-safe up to
// millions of decks. Format is `<slug>-<suffix>` so operators can
// eyeball a slug and still find the deck.
export function generatePublicSlug(
  name: string,
  randomBytes?: (n: number) => Uint8Array,
): string {
  const suffix = generateRandomString(8, SLUG_ALPHABET, randomBytes);
  return `${slugifyDeckName(name)}-${suffix}`;
}

// Preserve the original 8-char suffix when renaming a deck that
// already has a public slug. Same random suffix, new human prefix.
export function reslugifyKeepingSuffix(newName: string, existingSlug: string): string {
  const suffix = existingSlug.slice(-8);
  const isValidSuffix =
    suffix.length === 8 && /^[a-z0-9]+$/.test(suffix);
  if (!isValidSuffix) return generatePublicSlug(newName);
  return `${slugifyDeckName(newName)}-${suffix}`;
}

// Extract the immutable random suffix from a public slug. Returns
// null if the slug does not conform.
export function extractSlugSuffix(slug: string): string | null {
  const m = /-([a-z0-9]{8})$/.exec(slug);
  return m ? m[1]! : null;
}

// ── Share tokens (unlisted) ───────────────────────────────────────
//
// 32 chars from a 32-char alphabet = 160 bits of entropy. Chars are
// [a-z2-7] (Crockford-free base32 lowercase) so URL-safe without any
// escaping. The DB CHECK is length ≥ 24; we generate 32 for safety.

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function generateShareToken(randomBytes?: (n: number) => Uint8Array): string {
  return generateRandomString(32, TOKEN_ALPHABET, randomBytes);
}

// Superficial validation — DB check enforces length ≥ 24. This
// filter is used to reject obviously-malformed tokens from URL
// parameters before we spend a DB round-trip.
export function isPlausibleShareToken(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 24 && v.length <= 128 && /^[a-z0-9]+$/.test(v);
}

// ── URL builders ────────────────────────────────────────────────

export function publicDeckPath(slug: string): string {
  return `/deck/${encodeURIComponent(slug)}`;
}
export function unlistedDeckPath(token: string): string {
  return `/deck/share/${encodeURIComponent(token)}`;
}

// ── Public-slug resolution (pure) ───────────────────────────────
//
// Rename model:
//   • immutable 8-char suffix is the real public identity;
//   • the human-readable prefix follows the current deck name;
//   • an incoming URL is either canonical, a stale-prefix redirect,
//     or not-found.
//
// The DB never reveals unlisted/private decks by suffix — the
// anonymous SELECT policy already scopes anon to visibility='public',
// so suffix lookups on stale slugs naturally return nothing for
// unlisted or private decks. This helper describes what the page
// should do given the DB result.

export type SlugResolution =
  | { kind: 'canonical' }
  | { kind: 'redirect'; toSlug: string }
  | { kind: 'not-found' };

// Given the URL slug and whatever the DB returned (if anything),
// classify the response. The caller is expected to have already
// filtered on visibility='public' when doing the lookup.
export function classifyPublicSlugResolution(
  requestedSlug: string,
  found: { public_slug: string | null; visibility: Visibility } | null,
): SlugResolution {
  if (!found) return { kind: 'not-found' };
  if (found.visibility !== 'public' || !found.public_slug) return { kind: 'not-found' };
  if (found.public_slug === requestedSlug) return { kind: 'canonical' };
  return { kind: 'redirect', toSlug: found.public_slug };
}

// ── Internals ────────────────────────────────────────────────────

function generateRandomString(
  len: number,
  alphabet: string,
  randomBytes?: (n: number) => Uint8Array,
): string {
  const gen = randomBytes ?? defaultRandomBytes;
  const alen = alphabet.length;
  // Reject-and-retry to avoid modulo bias.
  const out: string[] = [];
  while (out.length < len) {
    const buf = gen(len - out.length);
    for (const byte of buf) {
      // Any byte ≥ (256 - 256 % alen) is discarded to avoid bias.
      const cap = 256 - (256 % alen);
      if (byte >= cap) continue;
      out.push(alphabet[byte % alen]!);
      if (out.length === len) break;
    }
  }
  return out.join('');
}

function defaultRandomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  // globalThis.crypto is available in Next server + Edge + browsers.
  (globalThis.crypto ?? crypto).getRandomValues(buf);
  return buf;
}

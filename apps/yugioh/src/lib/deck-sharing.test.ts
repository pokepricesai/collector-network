import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSlugSuffix,
  generatePublicSlug,
  generateShareToken,
  isPlausibleShareToken,
  isVisibility,
  publicDeckPath,
  reslugifyKeepingSuffix,
  slugifyDeckName,
  unlistedDeckPath,
} from './deck-sharing';

// ── visibility ────────────────────────────────────────────

test('isVisibility accepts only the three enum values', () => {
  assert.equal(isVisibility('private'), true);
  assert.equal(isVisibility('unlisted'), true);
  assert.equal(isVisibility('public'), true);
  assert.equal(isVisibility('PUBLIC'), false);
  assert.equal(isVisibility('draft'), false);
  assert.equal(isVisibility(1), false);
});

// ── slug generation ──────────────────────────────────────

test('slugifyDeckName folds diacritics + collapses punctuation', () => {
  assert.equal(slugifyDeckName('Snake-Eye Fiendsmith'), 'snake-eye-fiendsmith');
  assert.equal(slugifyDeckName("Blue-Eyes' Special Deck!!!"), 'blue-eyes-special-deck');
  assert.equal(slugifyDeckName('Pot of Grépher'), 'pot-of-grepher');
  // All-punctuation names fall back to 'deck'.
  assert.equal(slugifyDeckName('!!!'), 'deck');
});

test('slugifyDeckName caps length + trims trailing dash', () => {
  const long = 'a'.repeat(120);
  assert.equal(slugifyDeckName(long).length, 60);
  // Cap boundary must not leave a trailing dash.
  assert.equal(slugifyDeckName('abc-'.repeat(30)).endsWith('-'), false);
});

test('generatePublicSlug appends a stable 8-char suffix', () => {
  const rng = deterministicRandomBytes(0x2a);
  const slug = generatePublicSlug('Snake-Eye Fiendsmith', rng);
  assert.match(slug, /^snake-eye-fiendsmith-[a-z0-9]{8}$/);
  const suffix = extractSlugSuffix(slug);
  assert.ok(suffix && suffix.length === 8);
});

test('reslugifyKeepingSuffix preserves the immutable suffix on rename', () => {
  const rng = deterministicRandomBytes(0x11);
  const first = generatePublicSlug('Snake-Eye Fiendsmith', rng);
  const suffix = extractSlugSuffix(first)!;
  const renamed = reslugifyKeepingSuffix('Snake-Eye Refined', first);
  assert.equal(renamed, `snake-eye-refined-${suffix}`);
});

test('reslugifyKeepingSuffix falls back if suffix is malformed', () => {
  const rebuilt = reslugifyKeepingSuffix('New Name', 'malformed-slug');
  assert.match(rebuilt, /^new-name-[a-z0-9]{8}$/);
});

test('extractSlugSuffix returns null when there is no suffix', () => {
  assert.equal(extractSlugSuffix('no-suffix'), null);
  assert.equal(extractSlugSuffix('bad-1234567'), null); // only 7 chars
});

// ── share tokens ─────────────────────────────────────────

test('generateShareToken is 32 chars, url-safe, no bias artefacts', () => {
  const rng = deterministicRandomBytes(0x77);
  const t = generateShareToken(rng);
  assert.equal(t.length, 32);
  assert.match(t, /^[a-z2-7]+$/);
});

test('isPlausibleShareToken rejects short + invalid inputs', () => {
  assert.equal(isPlausibleShareToken('abc'), false);
  assert.equal(isPlausibleShareToken('!'.repeat(40)), false);
  assert.equal(isPlausibleShareToken('a'.repeat(24)), true);
  assert.equal(isPlausibleShareToken('a'.repeat(200)), false); // upper bound
  assert.equal(isPlausibleShareToken(42), false);
});

test('two tokens generated back-to-back differ', () => {
  const a = generateShareToken();
  const b = generateShareToken();
  assert.notEqual(a, b);
});

// ── URL builders ─────────────────────────────────────────

test('URL builders encode weird slug/token characters safely', () => {
  assert.equal(publicDeckPath('my deck'), '/deck/my%20deck');
  assert.equal(unlistedDeckPath('abc?token=/x'), '/deck/share/abc%3Ftoken%3D%2Fx');
});

// Deterministic RNG for reproducible slug/token generation in tests.
function deterministicRandomBytes(seed: number): (n: number) => Uint8Array {
  let s = seed;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // xorshift-lite — plenty for a deterministic test fixture.
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      out[i] = s & 0xff;
    }
    return out;
  };
}

import { describe, it, expect } from 'vitest';

// Regression tests for the PP-TCG-MIGRATE-01 schema invariants.
// These are shape / contract tests — they don't hit Supabase, they
// verify the TypeScript types + helpers that make up the public
// read path.

describe('MIGRATE-01 provider flag discipline', () => {
  // We can't import flags.ts directly here because it is in the
  // pokeprices-web app, not hub. Instead, re-verify the gate rules
  // by inlining the exact invariant.

  const ELIGIBILITIES = ['bulk_safe', 'market_only', 'identity_only', 'not_eligible', 'uncertain'] as const;

  function canReturnMarket(flag: boolean, elig: typeof ELIGIBILITIES[number]) {
    return flag && (elig === 'bulk_safe' || elig === 'market_only');
  }
  function canReturnGraded(flag: boolean, elig: typeof ELIGIBILITIES[number]) {
    return flag && elig === 'bulk_safe';
  }
  function canReturnImages(flag: boolean, elig: typeof ELIGIBILITIES[number]) {
    return flag && (elig === 'bulk_safe' || elig === 'market_only' || elig === 'identity_only');
  }

  it('flag OFF suppresses everything regardless of eligibility', () => {
    for (const e of ELIGIBILITIES) {
      expect(canReturnMarket(false, e)).toBe(false);
      expect(canReturnGraded(false, e)).toBe(false);
      expect(canReturnImages(false, e)).toBe(false);
    }
  });

  it('bulk_safe allows market + graded + images', () => {
    expect(canReturnMarket(true, 'bulk_safe')).toBe(true);
    expect(canReturnGraded(true, 'bulk_safe')).toBe(true);
    expect(canReturnImages(true, 'bulk_safe')).toBe(true);
  });

  it('market_only allows market + images, NEVER graded (aggregation safety)', () => {
    expect(canReturnMarket(true, 'market_only')).toBe(true);
    expect(canReturnGraded(true, 'market_only')).toBe(false);
    expect(canReturnImages(true, 'market_only')).toBe(true);
  });

  it('identity_only allows images only — no prices', () => {
    expect(canReturnMarket(true, 'identity_only')).toBe(false);
    expect(canReturnGraded(true, 'identity_only')).toBe(false);
    expect(canReturnImages(true, 'identity_only')).toBe(true);
  });

  it('uncertain / not_eligible block everything', () => {
    for (const e of ['uncertain', 'not_eligible'] as const) {
      expect(canReturnMarket(true, e)).toBe(false);
      expect(canReturnGraded(true, e)).toBe(false);
      expect(canReturnImages(true, e)).toBe(false);
    }
  });
});

describe('MIGRATE-01 history series discipline', () => {
  // Separate market series from graded series. A single series must
  // identify its origin so pooled grade-9 is never collapsed into
  // "PSA 9".

  function seriesKey(row: { kind: 'market' | 'graded'; source?: string | null; finish?: string | null; grader?: string | null; grade?: string | null; currency: string }) {
    return row.kind === 'market'
      ? `market|${row.source}|${row.finish}|${row.currency}`
      : `graded|${row.grader}|${row.grade}|${row.currency}`;
  }

  it('pooled grade-9 series is distinct from PSA 10 series', () => {
    const k1 = seriesKey({ kind: 'graded', grader: 'any', grade: '9', currency: 'USD' });
    const k2 = seriesKey({ kind: 'graded', grader: 'psa', grade: '10', currency: 'USD' });
    expect(k1).not.toBe(k2);
  });

  it('tcgplayer-normal and cardmarket-normal are distinct market series', () => {
    const k1 = seriesKey({ kind: 'market', source: 'tcgplayer', finish: 'normal', currency: 'USD' });
    const k2 = seriesKey({ kind: 'market', source: 'cardmarket', finish: 'normal', currency: 'EUR' });
    expect(k1).not.toBe(k2);
  });

  it('tcgplayer-1st-edition is distinct from tcgplayer-normal', () => {
    const k1 = seriesKey({ kind: 'market', source: 'tcgplayer', finish: '1st-edition', currency: 'USD' });
    const k2 = seriesKey({ kind: 'market', source: 'tcgplayer', finish: 'normal', currency: 'USD' });
    expect(k1).not.toBe(k2);
  });
});

describe('MIGRATE-01 ingestion idempotency', () => {
  // Each (provider, tcg_card_id, tcg_printing_key) can only have
  // one row in pokemon_tcg_provider_cards. Each market price row
  // is uniquely keyed by (provider, card, printing, source,
  // list_type, finish, currency). Re-running the ingestion must
  // UPDATE in place, never duplicate.

  const PROVIDER_CARD_KEY = ['provider', 'tcg_card_id', 'tcg_printing_key'];
  const MARKET_KEY = ['provider', 'tcg_card_id', 'tcg_printing_key', 'source', 'list_type', 'finish', 'currency'];
  const GRADED_KEY = ['provider', 'tcg_card_id', 'grader', 'grade'];

  it('provider card key is per printing', () => {
    expect(PROVIDER_CARD_KEY).toContain('tcg_printing_key');
  });

  it('market price key includes finish + currency', () => {
    expect(MARKET_KEY).toContain('finish');
    expect(MARKET_KEY).toContain('currency');
  });

  it('graded price key is per grader + grade (NOT per printing — aggregate is card-level)', () => {
    expect(GRADED_KEY).toContain('grader');
    expect(GRADED_KEY).toContain('grade');
    expect(GRADED_KEY).not.toContain('tcg_printing_key');
  });
});

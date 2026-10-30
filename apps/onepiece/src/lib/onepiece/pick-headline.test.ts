import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickHeadlinePrice } from './pick-headline';
import type { RetailQuote } from '@collector-network/market-data';

// Baseline quote. Overrides let each test exercise one condition.
function q(overrides: Partial<RetailQuote> = {}): RetailQuote {
  return {
    printingId: 'onepiece:print:sample:normal:en',
    source: 'tcggraph.cardmarket',
    listType: 'retail',
    region: 'EU',
    currency: 'EUR',
    finish: 'nonfoil',
    price: 10,
    priceLow: 5,
    priceTrend: null,
    avg1d: null,
    avg7d: null,
    avg30d: null,
    updatedAt: '2026-10-30T00:00:00Z',
    ...overrides,
  };
}

// ─── Pass-through / legitimate cases ────────────────────────────

test('avg30d is always surfaced regardless of other fields', () => {
  const h = pickHeadlinePrice([q({ avg30d: 42 })], 'EUR');
  assert.equal(h?.price, 42);
  assert.equal(h?.signal, 'avg30d');
});

test('legitimate TCGplayer foil $90-100 with no averaging surfaces', () => {
  // Representative of the bulk of OP TCGplayer USD foils per
  // the pre-push catalogue probe. price=99.94, priceLow=79.99,
  // no averaging. Ratio 1.25× — far below 5× threshold.
  const h = pickHeadlinePrice(
    [q({ currency: 'USD', source: 'tcggraph.tcgplayer', finish: 'foil',
         price: 99.94, priceLow: 79.99, avg1d: null, avg7d: null, avg30d: null })],
    'USD',
  );
  assert.notEqual(h, null, 'legitimate TCGplayer foil must not be suppressed');
  assert.equal(h?.signal, 'priceLow');
  assert.equal(h?.price, 79.99);
});

test('high-value card with consistent averaging surfaces normally', () => {
  // $5,000 chase card with averaging close to listing — kept.
  const h = pickHeadlinePrice(
    [q({ currency: 'USD', price: 5200, priceLow: 4800, avg7d: 4900, avg30d: 4950 })],
    'USD',
  );
  assert.notEqual(h, null, 'high-value card with consistent averaging must surface');
  assert.equal(h?.signal, 'avg30d');
  assert.equal(h?.price, 4950);
});

test('priceLow surfaces when its sole-field quote has no comparator', () => {
  // price absent, priceLow present, no averaging — no outlier evidence.
  const h = pickHeadlinePrice(
    [q({ price: null, priceLow: 50, avg1d: null, avg7d: null, avg30d: null })],
    'EUR',
  );
  assert.equal(h?.signal, 'priceLow');
  assert.equal(h?.price, 50);
});

// ─── Outlier suppression cases ──────────────────────────────────

test('Zoro p2 shape: price/priceLow ratio > 5x, no averaging → suppressed', () => {
  const h = pickHeadlinePrice(
    [q({ price: 589600, priceLow: 39999, avg1d: null, avg7d: null, avg30d: null })],
    'EUR',
  );
  assert.equal(h, null, 'single-source outlier with ratio 14.7x must not surface');
});

test('ST21-015_p2 shape: lone priceLow far above its own avg_30d → suppressed', () => {
  // price=59.99, priceLow=175000, avg_30d=59.99
  // priceLow / avg_30d = 2917x → suppress priceLow.
  // avg_30d still kept as headline.
  const h = pickHeadlinePrice(
    [q({ price: 59.99, priceLow: 175000, avg7d: 59.99, avg30d: 59.99 })],
    'EUR',
  );
  assert.equal(h?.signal, 'avg30d');
  assert.equal(h?.price, 59.99);
});

test('EB01-003_p4 shape: priceLow 1290x above avg_30d → priceLow suppressed, avg wins', () => {
  // Real production: price=1449.07, priceLow=1000000, avg_30d=775
  const h = pickHeadlinePrice(
    [q({ price: 1449.07, priceLow: 1000000, avg7d: 775, avg30d: 775 })],
    'EUR',
  );
  assert.equal(h?.signal, 'avg30d');
  assert.equal(h?.price, 775);
});

test('priceLow kept when within 4x of avg (chase card legitimately above avg)', () => {
  // Rising card: avg_30d=1000, priceLow=1200. Ratio 1.2x — kept.
  const h = pickHeadlinePrice(
    [q({ price: 1500, priceLow: 1200, avg30d: 1000 })],
    'EUR',
  );
  assert.equal(h?.signal, 'avg30d');
  assert.equal(h?.price, 1000);
});

test('trend/price suppressed when it exceeds 4x avg', () => {
  // Price listing is wildly above avg; avg still wins.
  const h = pickHeadlinePrice(
    [q({ price: 10000, priceLow: null, avg30d: 100 })],
    'EUR',
  );
  assert.equal(h?.signal, 'avg30d');
  assert.equal(h?.price, 100);
});

test('TCGplayer sentinel priceLow $0.01 vs price $0.07 is kept (ratio noise floor)', () => {
  // Common card: TCGplayer's priceLow floor is $0.01 even when no
  // real listings exist. A legitimate $0.07 common with $0.01 floor
  // yields a 7× ratio by construction — not an outlier. Ratio check
  // skips when the smaller value is below the $1 floor.
  const h = pickHeadlinePrice(
    [q({ currency: 'USD', source: 'tcggraph.tcgplayer', finish: 'nonfoil',
         price: 0.07, priceLow: 0.01, avg1d: null, avg7d: null, avg30d: null })],
    'USD',
  );
  assert.notEqual(h, null, 'bulk/common cards must not be suppressed by ratio noise');
  assert.equal(h?.price, 0.01, 'priceLow kept as headline');
});

test('ratio check still fires when both values are above floor', () => {
  // price=$6, priceLow=$1.20 — min=1.20 > $1 floor, ratio=5× exactly.
  // 5× is NOT strictly greater than threshold 5× → kept. 6× is suppressed.
  const barelyKept = pickHeadlinePrice(
    [q({ currency: 'USD', price: 6, priceLow: 1.20, avg1d: null, avg7d: null, avg30d: null })],
    'USD',
  );
  assert.notEqual(barelyKept, null, '5× at threshold stays');
  const suppressed = pickHeadlinePrice(
    [q({ currency: 'USD', price: 100, priceLow: 10, avg1d: null, avg7d: null, avg30d: null })],
    'USD',
  );
  assert.equal(suppressed, null, '10× above floor suppressed');
});

test('currency mismatch returns null (unchanged pre-existing behaviour)', () => {
  const h = pickHeadlinePrice([q({ currency: 'USD', avg30d: 20 })], 'EUR');
  assert.equal(h, null);
});

test('empty array returns null', () => {
  assert.equal(pickHeadlinePrice([], 'EUR'), null);
});

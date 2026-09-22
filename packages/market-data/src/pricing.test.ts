import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  TcgGradedPriceCurrent,
  TcgMarketPriceCurrent,
} from '@collector-network/database';
import { toGradedQuote, toRetailQuote } from './mappers.js';
import { splitGradedRows } from './pricing.js';
import { RAW_GRADER } from './types.js';

// Fixtures reflect the audited production shape — see docs/yugioh/data-audit.md.

const LOB_UNL_PRINTING = 'ygo:print:ygo_lob_001:normal:en';
const LOB_1ST_PRINTING = 'ygo:print:ygo_lob_001:1st-edition:en';

function gradedRow(
  overrides: Partial<TcgGradedPriceCurrent> = {},
): TcgGradedPriceCurrent {
  return {
    tcg_printing_id: LOB_UNL_PRINTING,
    game_id: 'ygo',
    grader: 'psa',
    grade: '10',
    currency: 'USD',
    price: 5450,
    card_sales_volume: 279,
    updated_at: '2026-09-11T00:00:00Z',
    ingested_at: '2026-09-22T00:00:00Z',
    source_run_id: null,
    ...overrides,
  };
}

function marketRow(
  overrides: Partial<TcgMarketPriceCurrent> = {},
): TcgMarketPriceCurrent {
  return {
    tcg_printing_id: LOB_UNL_PRINTING,
    game_id: 'ygo',
    source: 'tcggraph.tcgplayer',
    list_type: 'retail',
    region: 'NA',
    currency: 'USD',
    finish: 'nonfoil',
    price: 128.54,
    price_low: 64.99,
    price_trend: null,
    avg_1d: null,
    avg_7d: null,
    avg_30d: null,
    updated_at: '2026-09-11T13:09:34.86+00:00',
    ingested_at: '2026-09-22T00:00:00Z',
    source_run_id: null,
    ...overrides,
  };
}

test('grader=raw goes to raw[], never graded[]', () => {
  const rows: TcgGradedPriceCurrent[] = [
    gradedRow({ grader: RAW_GRADER, grade: 'ungraded', price: 75 }),
    gradedRow({ grader: 'psa', grade: '10', price: 5450 }),
    gradedRow({ grader: 'bgs', grade: '10', price: 7085 }),
    gradedRow({ grader: 'any', grade: '9', price: 640 }),
  ];
  const { raw, graded } = splitGradedRows(rows);
  assert.equal(raw.length, 1, 'exactly one raw observation');
  assert.equal(raw[0]?.grader, 'raw');
  assert.equal(graded.length, 3, 'three slab quotes');
  for (const g of graded) {
    assert.notEqual(g.grader, 'raw', 'no raw grader in graded[]');
  }
});

test('empty input produces empty split, not crash', () => {
  const { raw, graded } = splitGradedRows([]);
  assert.deepEqual(raw, []);
  assert.deepEqual(graded, []);
});

test('graded currencies are preserved without conversion', () => {
  const rows = [
    gradedRow({ grader: 'psa', grade: '10', currency: 'USD', price: 5450 }),
    gradedRow({ grader: 'psa', grade: '10', currency: 'EUR', price: 4900 }),
  ];
  const { graded } = splitGradedRows(rows);
  const currencies = graded.map((g) => g.currency).sort();
  assert.deepEqual(currencies, ['EUR', 'USD']);
  // Prices are the source values, not averages or conversions.
  const usdRow = graded.find((g) => g.currency === 'USD');
  const eurRow = graded.find((g) => g.currency === 'EUR');
  assert.equal(usdRow?.price, 5450);
  assert.equal(eurRow?.price, 4900);
});

test('missing price stays null; never coerced to 0', () => {
  const { graded } = splitGradedRows([
    gradedRow({ grader: 'sgc', grade: '10', price: null }),
  ]);
  assert.equal(graded[0]?.price, null);
});

test('retail quote mapping preserves all fields', () => {
  const q = toRetailQuote(
    marketRow({
      source: 'tcggraph.cardmarket',
      currency: 'EUR',
      region: 'EU',
      price: 17.6,
      price_low: 27.0,
      price_trend: 17.6,
      avg_1d: 25.55,
      avg_7d: 23.2,
      avg_30d: 35.62,
    }),
  );
  assert.equal(q.source, 'tcggraph.cardmarket');
  assert.equal(q.currency, 'EUR');
  assert.equal(q.region, 'EU');
  assert.equal(q.price, 17.6);
  assert.equal(q.priceLow, 27.0);
  assert.equal(q.priceTrend, 17.6);
  assert.equal(q.avg1d, 25.55);
  assert.equal(q.avg7d, 23.2);
  assert.equal(q.avg30d, 35.62);
});

test('printing IDs are preserved — no cross-printing contamination', () => {
  const rows = [
    gradedRow({ tcg_printing_id: LOB_UNL_PRINTING, grader: 'psa', grade: '10', price: 5450 }),
    gradedRow({ tcg_printing_id: LOB_1ST_PRINTING, grader: 'psa', grade: '10', price: 15000 }),
  ];
  const { graded } = splitGradedRows(rows);
  const unl = graded.find((g) => g.printingId === LOB_UNL_PRINTING);
  const first = graded.find((g) => g.printingId === LOB_1ST_PRINTING);
  assert.equal(unl?.price, 5450);
  assert.equal(first?.price, 15000);
});

test('toGradedQuote does not synthesize fields', () => {
  const q = toGradedQuote(
    gradedRow({ grader: 'cgc', grade: '9.5', price: 886.62, card_sales_volume: 42 }),
  );
  assert.equal(q.grader, 'cgc');
  assert.equal(q.grade, '9.5');
  assert.equal(q.price, 886.62);
  assert.equal(q.cardSalesVolume, 42);
});

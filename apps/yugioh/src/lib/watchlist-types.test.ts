import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMovementBundle,
  computeMovement,
  isTargetCurrency,
  validateAddWatchInput,
  validateUpdateTargetInput,
  type PriceObservation,
} from './watchlist-types';

// ── validators ────────────────────────────────────────────

test('isTargetCurrency accepts USD/EUR only', () => {
  assert.equal(isTargetCurrency('USD'), true);
  assert.equal(isTargetCurrency('EUR'), true);
  assert.equal(isTargetCurrency('GBP'), false);
  assert.equal(isTargetCurrency('usd'), false);
  assert.equal(isTargetCurrency(1), false);
});

test('validateAddWatchInput requires card + printing', () => {
  const r = validateAddWatchInput({});
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.errors.sort(), ['Choose a printing', 'Missing card']);
  }
});

test('validateAddWatchInput accepts a minimal record', () => {
  const r = validateAddWatchInput({ tcg_card_id: 'c1', tcg_printing_id: 'p1' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.target_price, null);
    assert.equal(r.value.target_currency, null);
    assert.equal(r.value.note, null);
  }
});

test('validateAddWatchInput rejects target price without currency', () => {
  const r = validateAddWatchInput({
    tcg_card_id: 'c1',
    tcg_printing_id: 'p1',
    target_price: 50,
    target_currency: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.includes('Choose a target currency'));
});

test('validateAddWatchInput rejects negative target', () => {
  const r = validateAddWatchInput({
    tcg_card_id: 'c1',
    tcg_printing_id: 'p1',
    target_price: -10,
    target_currency: 'USD',
  });
  assert.equal(r.ok, false);
});

test('validateUpdateTargetInput clears when both null', () => {
  const r = validateUpdateTargetInput({ target_price: null, target_currency: null });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.target_price, null);
    assert.equal(r.value.target_currency, null);
  }
});

// ── movement math ─────────────────────────────────────────

function obs(daysAgo: number, price: number, currency = 'USD', source = 'x'): PriceObservation {
  const d = new Date('2026-09-01T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return {
    observedOn: d.toISOString().slice(0, 10),
    price,
    currency,
    source,
  };
}

const TODAY = new Date('2026-09-01T00:00:00Z');

test('computeMovement returns null when no observations', () => {
  assert.equal(computeMovement([], 7, TODAY), null);
});

test('computeMovement uses closest at-or-before baseline (not future)', () => {
  const series = [
    obs(10, 10),
    obs(7, 12),
    obs(3, 15),
    obs(0, 20),
  ];
  const r = computeMovement(series, 7, TODAY);
  assert.ok(r);
  // Baseline should be the 7-days-ago observation (price 12), not future.
  assert.equal(r!.baselinePrice, 12);
  assert.equal(r!.latestPrice, 20);
  assert.equal(r!.absolute, 8);
  assert.equal(Math.round(r!.percent! * 100) / 100, 66.67);
});

test('computeMovement reports null when history does not reach lookback', () => {
  const series = [obs(3, 15), obs(0, 20)];
  const r = computeMovement(series, 30, TODAY);
  assert.ok(r);
  assert.equal(r!.absolute, null);
  assert.equal(r!.percent, null);
  assert.equal(r!.baselineOn, null);
});

test('computeMovement refuses mixed currencies within one series', () => {
  const series = [obs(10, 10, 'USD'), obs(5, 12, 'EUR'), obs(0, 15, 'USD')];
  const r = computeMovement(series, 7, TODAY);
  assert.equal(r, null);
});

test('computeMovement refuses mixed sources within one series', () => {
  const series = [obs(10, 10, 'USD', 'a'), obs(0, 15, 'USD', 'b')];
  const r = computeMovement(series, 7, TODAY);
  assert.equal(r, null);
});

test('computeMovement handles zero baseline safely', () => {
  const series = [obs(10, 0), obs(0, 5)];
  const r = computeMovement(series, 7, TODAY);
  assert.ok(r);
  assert.equal(r!.absolute, 5);
  assert.equal(r!.percent, null);
});

test('buildMovementBundle computes all three windows', () => {
  const series = [
    obs(120, 5),
    obs(90, 8),
    obs(30, 12),
    obs(7, 15),
    obs(0, 20),
  ];
  const b = buildMovementBundle(series, TODAY);
  assert.ok(b);
  assert.equal(b!.currentPrice, 20);
  assert.equal(b!.windows.d7?.baselinePrice, 15);
  assert.equal(b!.windows.d30?.baselinePrice, 12);
  assert.equal(b!.windows.d90?.baselinePrice, 8);
});

test('buildMovementBundle returns null for empty series', () => {
  assert.equal(buildMovementBundle([], TODAY), null);
});

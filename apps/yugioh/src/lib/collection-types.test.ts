import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCondition,
  isGrader,
  isPurchaseCurrency,
  summarise,
  validateAddCollectionInput,
  type CollectionItemRow,
  type PricedItem,
} from './collection-types';

// ── validators ────────────────────────────────────────────

test('type guards accept known values, reject junk', () => {
  assert.equal(isCondition('near-mint'), true);
  assert.equal(isCondition('brand-new'), false);
  assert.equal(isCondition(1), false);
  assert.equal(isGrader('psa'), true);
  assert.equal(isGrader('PSA'), false); // lowercase enum by design
  assert.equal(isPurchaseCurrency('USD'), true);
  assert.equal(isPurchaseCurrency('GBP'), false);
});

test('validateAddCollectionInput requires card + printing', () => {
  const r = validateAddCollectionInput({ quantity: 1, is_graded: false });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.errors.sort(), ['Choose a printing', 'Missing card']);
  }
});

test('validateAddCollectionInput rejects graded without grader/grade', () => {
  const r = validateAddCollectionInput({
    tcg_card_id: 'c1',
    tcg_printing_id: 'p1',
    quantity: 1,
    is_graded: true,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.includes('Choose a grader'));
    assert.ok(r.errors.includes('Choose a grade'));
  }
});

test('validateAddCollectionInput accepts a valid raw record', () => {
  const r = validateAddCollectionInput({
    tcg_card_id: 'c1',
    tcg_printing_id: 'p1',
    quantity: 3,
    is_graded: false,
    condition: 'lightly-played',
    purchase_price: 12.5,
    purchase_currency: 'USD',
    purchase_date: '2026-01-01',
    notes: '  ok  ',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.quantity, 3);
    assert.equal(r.value.is_graded, false);
    assert.equal(r.value.condition, 'lightly-played');
    assert.equal(r.value.grader, null);
    assert.equal(r.value.grade, null);
    assert.equal(r.value.purchase_price, 12.5);
    assert.equal(r.value.purchase_currency, 'USD');
    assert.equal(r.value.purchase_date, '2026-01-01');
    assert.equal(r.value.notes, 'ok');
  }
});

test('validateAddCollectionInput accepts a valid graded record', () => {
  const r = validateAddCollectionInput({
    tcg_card_id: 'c1',
    tcg_printing_id: 'p1',
    quantity: 1,
    is_graded: true,
    grader: 'psa',
    grade: '10',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.grader, 'psa');
    assert.equal(r.value.grade, '10');
    assert.equal(r.value.condition, null);
  }
});

test('validateAddCollectionInput rejects negative purchase price', () => {
  const r = validateAddCollectionInput({
    tcg_card_id: 'c1',
    tcg_printing_id: 'p1',
    quantity: 1,
    is_graded: false,
    purchase_price: -5,
  });
  assert.equal(r.ok, false);
});

test('validateAddCollectionInput rejects malformed date', () => {
  const r = validateAddCollectionInput({
    tcg_card_id: 'c1',
    tcg_printing_id: 'p1',
    quantity: 1,
    is_graded: false,
    purchase_date: '2026/01/01' as never,
  });
  assert.equal(r.ok, false);
});

test('validateAddCollectionInput caps quantity out-of-range', () => {
  const r = validateAddCollectionInput({
    tcg_card_id: 'c1',
    tcg_printing_id: 'p1',
    quantity: 5000,
    is_graded: false,
  });
  assert.equal(r.ok, false);
});

// ── summariser ────────────────────────────────────────────

function row(patch: Partial<CollectionItemRow>): CollectionItemRow {
  return {
    id: 'id',
    user_id: 'u',
    tcg_card_id: 'c1',
    tcg_printing_id: 'p1',
    quantity: 1,
    is_graded: false,
    grader: null,
    grade: null,
    condition: 'near-mint',
    purchase_price: null,
    purchase_currency: null,
    purchase_date: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...patch,
  };
}

function priced(
  r: CollectionItemRow,
  unit: number | null,
  source: PricedItem['valueUsdSource'] = 'printing-retail',
): PricedItem {
  return { row: r, unitValueUsd: unit, valueUsdSource: source, currency: 'USD' };
}

test('summarise counts copies + unique cards + raw/graded split', () => {
  const items: PricedItem[] = [
    priced(row({ id: '1', tcg_card_id: 'c1', quantity: 3 }), 5),
    priced(row({ id: '2', tcg_card_id: 'c1', quantity: 1, is_graded: true, grader: 'psa', grade: '10' }), 200, 'printing-graded'),
    priced(row({ id: '3', tcg_card_id: 'c2', quantity: 2 }), 10),
  ];
  const s = summarise(items);
  assert.equal(s.totalCopies, 6);
  assert.equal(s.uniqueHoldings, 3);
  assert.equal(s.uniqueCards, 2);
  assert.equal(s.rawCount, 5);
  assert.equal(s.gradedCount, 1);
  assert.equal(s.totalCurrentUsd, 3 * 5 + 200 + 2 * 10);
  assert.equal(s.rawValueUsd, 3 * 5 + 2 * 10);
  assert.equal(s.gradedValueUsd, 200);
});

test('summarise never counts a missing price as zero', () => {
  const items: PricedItem[] = [
    priced(row({ id: '1', quantity: 2 }), null, 'none'),
    priced(row({ id: '2', quantity: 1 }), 5),
  ];
  const s = summarise(items);
  assert.equal(s.totalCurrentUsd, 5);
  assert.equal(s.missingPriceCount, 1);
  assert.equal(s.unrealisedUsd, null);
});

test('summarise refuses acquisition total when non-USD purchases exist', () => {
  const items: PricedItem[] = [
    priced(row({ id: '1', purchase_price: 10, purchase_currency: 'USD' }), 5),
    priced(row({ id: '2', purchase_price: 20, purchase_currency: 'EUR' }), 5),
  ];
  const s = summarise(items);
  assert.equal(s.totalAcquisitionUsd, null);
  assert.equal(s.unrealisedUsd, null);
});

test('summarise reports unrealised gain when everything is comparable', () => {
  const items: PricedItem[] = [
    priced(row({ id: '1', quantity: 2, purchase_price: 4, purchase_currency: 'USD' }), 10),
    priced(row({ id: '2', quantity: 1, purchase_price: 3, purchase_currency: 'USD' }), 15),
  ];
  const s = summarise(items);
  assert.equal(s.totalCurrentUsd, 35);
  assert.equal(s.totalAcquisitionUsd, 11);
  assert.equal(s.unrealisedUsd, 24);
});

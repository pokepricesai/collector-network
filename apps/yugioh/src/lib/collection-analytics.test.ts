import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPortfolioDepth,
  computeAnalytics,
} from './collection-analytics';
import type { CollectionListItem } from '../server/collection';
import type { CollectionItemRow, PricedItem } from './collection-types';

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

function priced(r: CollectionItemRow, unit: number | null): PricedItem {
  return {
    row: r,
    unitValueUsd: unit,
    valueUsdSource: unit == null ? 'none' : 'printing-retail',
    currency: 'USD',
  };
}

function item(
  patch: Partial<CollectionItemRow>,
  unit: number | null,
  extras: Partial<Pick<CollectionListItem, 'card' | 'printing' | 'set'>> = {},
): CollectionListItem {
  const r = row(patch);
  return {
    row: r,
    card: extras.card ?? null,
    printing: extras.printing ?? null,
    set: extras.set ?? null,
    priced: priced(r, unit),
  };
}

// ── breakdowns ────────────────────────────────────────────

test('computeAnalytics groups by set/rarity/raw-vs-graded/grader', () => {
  const items: CollectionListItem[] = [
    item(
      { id: '1', quantity: 2 },
      5,
      {
        card: { id: 'c1', name: 'A', rarity: 'Rare', set_id: 'S1' } as never,
        set: { id: 'S1', code: 's1', name: 'Set One' } as never,
      },
    ),
    item(
      {
        id: '2',
        quantity: 1,
        is_graded: true,
        grader: 'psa',
        grade: '10',
        condition: null,
      },
      100,
      {
        card: { id: 'c1', name: 'A', rarity: 'Rare', set_id: 'S1' } as never,
        set: { id: 'S1', code: 's1', name: 'Set One' } as never,
      },
    ),
    item(
      { id: '3', quantity: 3 },
      2,
      {
        card: { id: 'c2', name: 'B', rarity: 'Common', set_id: 'S2' } as never,
        set: { id: 'S2', code: 's2', name: 'Set Two' } as never,
      },
    ),
  ];
  const a = computeAnalytics({ items });
  assert.equal(a.breakdowns.bySet.length, 2);
  assert.equal(a.breakdowns.bySet[0]!.valueUsd, 110); // S1 = 2×5 + 100
  assert.equal(a.breakdowns.byRarity.find((b) => b.key === 'Rare')?.valueUsd, 110);
  assert.equal(a.breakdowns.byRawGraded.find((b) => b.key === 'raw')?.valueUsd, 16);
  assert.equal(a.breakdowns.byRawGraded.find((b) => b.key === 'graded')?.valueUsd, 100);
  assert.equal(a.breakdowns.byGrader[0]!.key, 'psa');
});

test('missing prices go to missingPrice + missingPriceRows, never counted', () => {
  const items = [
    item({ id: '1', quantity: 5 }, null),
    item({ id: '2', quantity: 2 }, 3),
  ];
  const a = computeAnalytics({ items });
  assert.equal(a.missingPrice.length, 1);
  const setBucket = a.breakdowns.bySet[0]!;
  assert.equal(setBucket.valueUsd, 6);
  assert.equal(setBucket.missingPriceRows, 1);
});

test('top10 most valuable ranks by total × quantity', () => {
  const items = [
    item({ id: '1', quantity: 1 }, 100),
    item({ id: '2', quantity: 3 }, 40), // 120
    item({ id: '3', quantity: 10 }, 5), // 50
  ];
  const a = computeAnalytics({ items });
  assert.equal(a.topMostValuable[0]!.item.row.id, '2');
  assert.equal(a.topMostValuable[0]!.totalValueUsd, 120);
});

test('gain/loss only computed for USD acquisition + priced current', () => {
  const items = [
    item({ id: '1', quantity: 1, purchase_price: 4, purchase_currency: 'USD' }, 10), // +6
    item({ id: '2', quantity: 2, purchase_price: 5, purchase_currency: 'USD' }, 3),  // -4
    // EUR purchase → excluded from lists but flagged
    item({ id: '3', quantity: 1, purchase_price: 8, purchase_currency: 'EUR' }, 15),
    // No current price → excluded
    item({ id: '4', quantity: 1, purchase_price: 3, purchase_currency: 'USD' }, null),
  ];
  const a = computeAnalytics({ items });
  assert.equal(a.topGains.length, 1);
  assert.equal(a.topGains[0]!.gainUsd, 6);
  assert.equal(a.topLosses.length, 1);
  assert.equal(a.topLosses[0]!.gainUsd, -4);
  assert.equal(a.hasNonUsdAcquisition, true);
});

// ── portfolio depth decision ──────────────────────────────

test('assessPortfolioDepth requires min 30 days', () => {
  assert.equal(assessPortfolioDepth([]).ok, false);
  assert.equal(assessPortfolioDepth([5, 10]).ok, false);
  assert.equal(assessPortfolioDepth([29]).ok, false);
  assert.equal(assessPortfolioDepth([30]).ok, true);
  assert.equal(assessPortfolioDepth([100, 5, 8]).ok, true);
});

test('assessPortfolioDepth respects custom required days', () => {
  assert.equal(assessPortfolioDepth([50], 60).ok, false);
  assert.equal(assessPortfolioDepth([60], 60).ok, true);
});

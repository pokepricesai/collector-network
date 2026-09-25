// Slice E — pure collection analytics helpers.
//
// Composes the (row + printing + set + priced) tuples produced by
// server/collection.ts into breakdowns and top lists. No DB reads.
// No FX conversion.
//
// Attribution rules from Slice D are preserved:
//   • missing valuations stay OUT of totals (never counted as zero).
//   • gain/loss only computed when acquisition currency = USD
//     (matches Slice D summariser). Mixed-currency rows carry a
//     "no compare" flag.

import type { CollectionListItem } from '../server/collection';
import type { CollectionItemRow, PricedItem } from './collection-types';

// ── Breakdown types ─────────────────────────────────────────────

export interface BreakdownBucket {
  key: string;              // stable machine key
  label: string;            // display label
  valueUsd: number;         // sum of unit × qty (USD, priced rows only)
  copies: number;           // sum of quantities
  holdings: number;         // row count
  missingPriceRows: number; // rows with no priced current value
}

export interface CollectionBreakdowns {
  bySet: BreakdownBucket[];
  byRarity: BreakdownBucket[];
  byRawGraded: BreakdownBucket[];
  byGrader: BreakdownBucket[];
}

export interface TopHolding {
  item: CollectionListItem;
  totalValueUsd: number;
}

export interface GainLossHolding {
  item: CollectionListItem;
  gainUsd: number;          // (current − cost) × qty, USD only
}

export interface AnalyticsResult {
  breakdowns: CollectionBreakdowns;
  topMostValuable: TopHolding[];
  topGains: GainLossHolding[];
  topLosses: GainLossHolding[];
  missingPrice: CollectionListItem[];
  hasNonUsdAcquisition: boolean;
}

// ── Group helpers ───────────────────────────────────────────────

function bucket(
  map: Map<string, BreakdownBucket>,
  key: string,
  label: string,
): BreakdownBucket {
  let b = map.get(key);
  if (!b) {
    b = { key, label, valueUsd: 0, copies: 0, holdings: 0, missingPriceRows: 0 };
    map.set(key, b);
  }
  return b;
}

function toArray(map: Map<string, BreakdownBucket>): BreakdownBucket[] {
  return [...map.values()].sort((a, b) => b.valueUsd - a.valueUsd || a.label.localeCompare(b.label));
}

// ── Main computation ────────────────────────────────────────────

export interface AnalyticsInput {
  items: readonly CollectionListItem[];
}

export function computeAnalytics({ items }: AnalyticsInput): AnalyticsResult {
  const bySet = new Map<string, BreakdownBucket>();
  const byRarity = new Map<string, BreakdownBucket>();
  const byRawGraded = new Map<string, BreakdownBucket>();
  const byGrader = new Map<string, BreakdownBucket>();

  const topMostValuable: TopHolding[] = [];
  const topGains: GainLossHolding[] = [];
  const topLosses: GainLossHolding[] = [];
  const missingPrice: CollectionListItem[] = [];
  let hasNonUsdAcquisition = false;

  for (const it of items) {
    const q = it.row.quantity;
    const priced = it.priced;
    const holdingValue = priced.unitValueUsd != null ? priced.unitValueUsd * q : null;

    // Sets
    const setKey = it.set?.code ?? it.set?.id ?? '__unknown__';
    const setLabel = it.set?.name ?? it.set?.code ?? 'Unknown set';
    contribute(bucket(bySet, setKey, setLabel), q, holdingValue);

    // Rarities
    const rarity = it.card?.rarity ?? 'Unknown';
    contribute(bucket(byRarity, rarity, rarity), q, holdingValue);

    // Raw vs graded
    const rgKey = it.row.is_graded ? 'graded' : 'raw';
    const rgLabel = it.row.is_graded ? 'Graded' : 'Raw';
    contribute(bucket(byRawGraded, rgKey, rgLabel), q, holdingValue);

    // Grader (graded rows only)
    if (it.row.is_graded && it.row.grader) {
      contribute(bucket(byGrader, it.row.grader, it.row.grader.toUpperCase()), q, holdingValue);
    }

    // Top lists
    if (holdingValue != null) {
      topMostValuable.push({ item: it, totalValueUsd: holdingValue });
    } else {
      missingPrice.push(it);
    }

    // Gain/loss: only when acquisition is USD AND current price known.
    if (it.row.purchase_price != null) {
      if (it.row.purchase_currency === 'USD' && priced.unitValueUsd != null) {
        const gain = (priced.unitValueUsd - it.row.purchase_price) * q;
        if (gain >= 0) topGains.push({ item: it, gainUsd: gain });
        else topLosses.push({ item: it, gainUsd: gain });
      } else if (it.row.purchase_currency !== 'USD') {
        hasNonUsdAcquisition = true;
      }
    }
  }

  topMostValuable.sort((a, b) => b.totalValueUsd - a.totalValueUsd);
  topGains.sort((a, b) => b.gainUsd - a.gainUsd);
  topLosses.sort((a, b) => a.gainUsd - b.gainUsd);

  return {
    breakdowns: {
      bySet: toArray(bySet),
      byRarity: toArray(byRarity),
      byRawGraded: toArray(byRawGraded),
      byGrader: toArray(byGrader),
    },
    topMostValuable: topMostValuable.slice(0, 10),
    topGains: topGains.slice(0, 10),
    topLosses: topLosses.slice(0, 10),
    missingPrice,
    hasNonUsdAcquisition,
  };
}

function contribute(b: BreakdownBucket, quantity: number, holdingValueUsd: number | null) {
  b.copies += quantity;
  b.holdings += 1;
  if (holdingValueUsd != null) {
    b.valueUsd += holdingValueUsd;
  } else {
    b.missingPriceRows += 1;
  }
}

// ── Historical-value decision ───────────────────────────────────
//
// Question: can we derive a portfolio-value-over-time chart from
// existing per-printing daily history?
//
// Rules that MUST hold before we render one:
//   1. Every priced holding must have printing-scoped daily history
//      in the same currency it is currently valued in.
//   2. Graded holdings must have matching (grader, grade) history
//      or be excluded honestly from the chart.
//   3. The chart must cover at least 30 distinct calendar days —
//      shorter windows produce mostly noise.
//
// This helper reports whether the data available today satisfies
// rule 3 given a mapping of per-holding series lengths. Callers use
// it to decide whether to render the chart or the "collection
// history will appear as YGOPrices accumulates more observations"
// placeholder.

export interface PortfolioDepthCheck {
  ok: boolean;
  distinctDaysMax: number;
  requiredDays: number;
  reason?: string;
}

export function assessPortfolioDepth(
  perHoldingDayCounts: readonly number[],
  requiredDays = 30,
): PortfolioDepthCheck {
  if (perHoldingDayCounts.length === 0) {
    return {
      ok: false,
      distinctDaysMax: 0,
      requiredDays,
      reason: 'Collection is empty.',
    };
  }
  const distinctDaysMax = Math.max(...perHoldingDayCounts, 0);
  if (distinctDaysMax < requiredDays) {
    return {
      ok: false,
      distinctDaysMax,
      requiredDays,
      reason: `Not enough historical depth (${distinctDaysMax} of ${requiredDays} required days).`,
    };
  }
  return { ok: true, distinctDaysMax, requiredDays };
}

// Utility re-export so tests can construct minimal fixtures.
export type { CollectionItemRow, PricedItem };

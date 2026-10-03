import 'server-only';

// PokePrices pricing evidence provider.
//
// PokePrices stores its price history + trend data in the SAME
// Supabase project that hosts Collector Network OS. The relevant
// tables (read-only from CN's perspective) are:
//
//   cards              — card catalog + canonical PokePrices URLs
//   card_trends        — pre-computed trend metrics per card
//                        (current / 7d / 30d / 90d / 180d / 365d
//                        for raw and PSA 10, plus pct changes and
//                        robust_pct variants + is_recovery)
//   card_volume        — liquidity signals per (card_slug, grade):
//                        sales_30d, sales_90d, confidence, median
//   card_latest_prices — current snapshot by grade
//
// This module exposes a stable, reusable interface for Phase 3
// data-driven editorial — it is NOT a one-off script.
//
// Design rules:
//
//   • Read-only. Service-role client provided by caller.
//   • Illiquid cards filtered out — we require real sales in the
//     window at the chosen grade.
//   • Minimum price threshold to exclude penny-mover noise.
//   • Absolute change floor to exclude micro-price percentage noise.
//   • Hard cap on percentage change — anything beyond is almost
//     certainly a data error / single-sale spike, not a real
//     market move.
//   • Returns provenance per card: table names + filter chain used.
//   • Always distinguishes graded vs ungraded.
//
// IMPORTANT: PokePrices stores prices in CENTS. The underlying
// card_trends columns (current_raw, raw_30d_ago, psa10_30d_ago, etc.)
// are integer cents. This module converts cents → USD at the
// boundary — all public interfaces are USD. All internal threshold
// comparisons use cents (× 100) to match the stored data.

import type { SupabaseClient } from '@supabase/supabase-js';

const POKEPRICES_ORIGIN = 'https://www.pokeprices.io';

export type PriceGrade = 'raw' | 'psa10' | 'psa9';
export type PriceWindow = 7 | 30 | 90;

export interface PriceMover {
  cardSlug: string;
  cardName: string;
  setName: string;
  cardNumber: string | null;
  setReleaseDate: string | null;
  pokepricesUrl: string;
  grade: PriceGrade;
  startPriceUsd: number;
  endPriceUsd: number;
  absChangeUsd: number;
  pctChange: number;
  robustPctChange: number | null;
  salesLastWindow: number | null;      // card_volume.sales_90d (90d is the smallest sliding window the table carries)
  confidence: 'high' | 'low' | null;
  isRecovery: boolean;
  windowLabel: string;
  dataNotes: string[];
}

export interface MarketMoversResult {
  grade: PriceGrade;
  windowDays: PriceWindow;
  asOf: string;
  windowLabel: string;
  risers: PriceMover[];
  fallers: PriceMover[];
  filters: {
    minPriceUsd: number;
    minAbsChangeUsd: number;
    minSales90d: number;
    minConfidence: 'high' | 'low';
    pctChangeCap: number;
    includeSealed: boolean;
  };
  exclusions: {
    initialCount: number;
    droppedBelowPriceFloor: number;
    droppedBelowAbsChange: number;
    droppedBelowLiquidity: number;
    droppedAbovePctCap: number;
    droppedMissingCard: number;
    survivors: number;
  };
  provenance: {
    tables_read: string[];
    service_endpoint: string;
    retrieved_at: string;
  };
}

interface CardTrendsRow {
  card_slug: string;
  card_name: string;
  set_name: string;
  current_raw: number | null;
  current_psa10: number | null;
  current_psa9: number | null;
  raw_7d_ago: number | null;
  raw_30d_ago: number | null;
  raw_90d_ago: number | null;
  psa10_30d_ago: number | null;
  psa10_90d_ago: number | null;
  raw_pct_7d: number | null;
  raw_pct_30d: number | null;
  raw_pct_90d: number | null;
  psa10_pct_30d: number | null;
  psa10_pct_90d: number | null;
  robust_pct_30d: number | null;
  robust_pct_7d: number | null;
  is_recovery: boolean;
  as_of: string;
}
interface CardsRow {
  card_slug: string;
  card_number: string | null;
  card_url_slug: string | null;
  set_release_date: string | null;
  is_sealed: boolean;
}
interface CardVolumeRow {
  card_slug: string;
  grade: string;
  sales_30d: number | null;
  sales_90d: number | null;
  confidence: 'high' | 'low' | null;
}

function volumeGradeFor(grade: PriceGrade): string {
  if (grade === 'raw') return 'Ungraded';
  if (grade === 'psa10') return 'PSA 10';
  return 'PSA 9';
}

function pokepricesUrl(setName: string, cardUrlSlug: string | null, cardSlug: string): string {
  if (!cardUrlSlug) return `${POKEPRICES_ORIGIN}/`;
  return `${POKEPRICES_ORIGIN}/set/${encodeURIComponent(setName)}/card/${cardUrlSlug}`;
}

/**
 * Fetch top price risers and fallers.
 *
 * Example (Phase 3 September 2026 editorial):
 *   await getMarketMovers(sb, { grade: 'raw', windowDays: 30, topN: 10 });
 *
 * Returns the lists already sorted (biggest riser first, biggest
 * faller first) with full provenance.
 */
export async function getMarketMovers(
  sb: SupabaseClient,
  opts: {
    grade: PriceGrade;
    windowDays: PriceWindow;
    topN?: number;
    minPriceUsd?: number;
    minAbsChangeUsd?: number;
    minSales90d?: number;
    minConfidence?: 'high' | 'low';
    pctChangeCap?: number;
    includeSealed?: boolean;
  },
): Promise<MarketMoversResult> {
  const topN = opts.topN ?? 10;
  const grade = opts.grade;
  const windowDays = opts.windowDays;
  const minPriceUsd = opts.minPriceUsd ?? (grade === 'raw' ? 50 : 150);
  const minAbsChangeUsd = opts.minAbsChangeUsd ?? (grade === 'raw' ? 20 : 50);
  const minSales90d = opts.minSales90d ?? 5;
  const minConfidence = opts.minConfidence ?? 'high';
  const pctChangeCap = opts.pctChangeCap ?? 150;
  const includeSealed = opts.includeSealed ?? false;
  // Underlying columns are in cents. Convert thresholds for the WHERE
  // clause so we filter correctly in the database.
  const minPriceCents = Math.round(minPriceUsd * 100);
  const minAbsChangeCents = Math.round(minAbsChangeUsd * 100);

  // Column selection — only the fields we need for the given grade +
  // window to keep the row payload lean.
  const priceColumn = grade === 'raw' ? 'current_raw' : grade === 'psa10' ? 'current_psa10' : 'current_psa9';
  const startColumn = grade === 'raw' ? `raw_${windowDays}d_ago` : grade === 'psa10' ? `psa10_${windowDays}d_ago` : (() => { throw new Error(`[pokeprices-pricing] psa9 start-price column not present for window ${windowDays}d`); })();
  const pctColumn = grade === 'raw' ? `raw_pct_${windowDays}d` : grade === 'psa10' ? `psa10_pct_${windowDays}d` : (() => { throw new Error(`[pokeprices-pricing] psa9 pct column not present for window ${windowDays}d`); })();
  const robustColumn = windowDays === 30 ? 'robust_pct_30d' : windowDays === 7 ? 'robust_pct_7d' : null;

  const select = [
    'card_slug', 'card_name', 'set_name',
    priceColumn, startColumn, pctColumn,
    ...(robustColumn ? [robustColumn] : []),
    'is_recovery', 'as_of',
  ].join(',');

  // Pull trend rows above the price/absolute floors. We fetch
  // comfortably more than topN because the subsequent liquidity +
  // pct-cap filters will remove some.
  const FETCH_LIMIT = Math.max(500, topN * 25);

  // Risers: positive pct change, non-null columns. minPriceCents
  // because the underlying columns are integer cents.
  const { data: riserRaw, error: riserErr } = await sb
    .from('card_trends')
    .select(select)
    .gte(priceColumn, minPriceCents)
    .gte(startColumn, 100)               // start price must be >= $1 to avoid div noise
    .gt(pctColumn, 0)
    .lte(pctColumn, pctChangeCap)
    .order(pctColumn, { ascending: false })
    .limit(FETCH_LIMIT);
  if (riserErr) throw new Error(`[pokeprices-pricing] risers: ${riserErr.message}`);

  const { data: fallerRaw, error: fallerErr } = await sb
    .from('card_trends')
    .select(select)
    .gte(startColumn, minPriceCents)
    .gte(priceColumn, 100)
    .lt(pctColumn, 0)
    .gte(pctColumn, -pctChangeCap)
    .order(pctColumn, { ascending: true })
    .limit(FETCH_LIMIT);
  if (fallerErr) throw new Error(`[pokeprices-pricing] fallers: ${fallerErr.message}`);

  const trendRows = [...((riserRaw ?? []) as unknown as CardTrendsRow[]), ...((fallerRaw ?? []) as unknown as CardTrendsRow[])];
  const asOf = trendRows[0]?.as_of ?? new Date().toISOString().slice(0, 10);

  // Lookup liquidity for every candidate card.
  const slugs = [...new Set(trendRows.map((r) => r.card_slug))];
  const volumeGrade = volumeGradeFor(grade);
  const liquidityMap = new Map<string, CardVolumeRow>();
  // Chunk the IN query to avoid URL length limits.
  const CHUNK = 150;
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const slice = slugs.slice(i, i + CHUNK);
    const { data: volData } = await sb
      .from('card_volume')
      .select('card_slug, grade, sales_30d, sales_90d, confidence')
      .in('card_slug', slice).eq('grade', volumeGrade);
    for (const v of ((volData ?? []) as unknown as CardVolumeRow[])) {
      liquidityMap.set(v.card_slug, v);
    }
  }

  // Lookup catalog info (url_slug, card_number, release date, is_sealed).
  const cardsMap = new Map<string, CardsRow>();
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const slice = slugs.slice(i, i + CHUNK);
    const { data: cardsData } = await sb
      .from('cards')
      .select('card_slug, card_number, card_url_slug, set_release_date, is_sealed')
      .in('card_slug', slice);
    for (const c of ((cardsData ?? []) as unknown as CardsRow[])) {
      cardsMap.set(c.card_slug, c);
    }
  }

  function toMover(row: CardTrendsRow, direction: 'riser' | 'faller'): PriceMover | { skip: 'price_floor' | 'abs_change' | 'liquidity' | 'pct_cap' | 'missing_card' } {
    const cardInfo = cardsMap.get(row.card_slug);
    if (!cardInfo) return { skip: 'missing_card' };
    if (!includeSealed && cardInfo.is_sealed) return { skip: 'missing_card' };

    // Cents → USD at the boundary.
    const endCents = Number((row as unknown as Record<string, number | null>)[priceColumn] ?? 0);
    const startCents = Number((row as unknown as Record<string, number | null>)[startColumn] ?? 0);
    const endPrice = endCents / 100;
    const startPrice = startCents / 100;
    const pct = Number((row as unknown as Record<string, number | null>)[pctColumn] ?? 0);
    const robust = robustColumn ? ((row as unknown as Record<string, number | null>)[robustColumn] ?? null) : null;
    const absChangeCents = Math.abs(endCents - startCents);

    if (endCents < minPriceCents && startCents < minPriceCents) return { skip: 'price_floor' };
    if (absChangeCents < minAbsChangeCents) return { skip: 'abs_change' };
    if (Math.abs(pct) > pctChangeCap) return { skip: 'pct_cap' };

    const liq = liquidityMap.get(row.card_slug);
    if (!liq) return { skip: 'liquidity' };
    const sales90 = Number(liq.sales_90d ?? 0);
    if (sales90 < minSales90d) return { skip: 'liquidity' };
    if (minConfidence === 'high' && liq.confidence !== 'high') return { skip: 'liquidity' };

    const url = pokepricesUrl(row.set_name, cardInfo.card_url_slug, row.card_slug);
    const windowLabel = `${windowDays}-day window as of ${row.as_of}`;
    const notes: string[] = [];
    if (row.is_recovery) notes.push('flagged as recovery pattern');
    if (robust == null) notes.push('robust_pct not available for this window');
    if (liq.confidence === 'low') notes.push('low-confidence liquidity signal');

    return {
      cardSlug: row.card_slug,
      cardName: row.card_name,
      setName: row.set_name,
      cardNumber: cardInfo.card_number,
      setReleaseDate: cardInfo.set_release_date,
      pokepricesUrl: url,
      grade,
      startPriceUsd: startPrice,
      endPriceUsd: endPrice,
      absChangeUsd: Number((endPrice - startPrice).toFixed(2)),
      pctChange: Number(pct.toFixed(2)),
      robustPctChange: robust == null ? null : Number((robust as number).toFixed(2)),
      salesLastWindow: sales90,
      confidence: liq.confidence,
      isRecovery: row.is_recovery,
      windowLabel,
      dataNotes: notes,
    };
  }

  const risersOut: PriceMover[] = [];
  const fallersOut: PriceMover[] = [];
  const exc = { droppedBelowPriceFloor: 0, droppedBelowAbsChange: 0, droppedBelowLiquidity: 0, droppedAbovePctCap: 0, droppedMissingCard: 0 };

  for (const r of (riserRaw ?? []) as unknown as CardTrendsRow[]) {
    const result = toMover(r, 'riser');
    if ('skip' in result) {
      if (result.skip === 'price_floor') exc.droppedBelowPriceFloor++;
      else if (result.skip === 'abs_change') exc.droppedBelowAbsChange++;
      else if (result.skip === 'liquidity') exc.droppedBelowLiquidity++;
      else if (result.skip === 'pct_cap') exc.droppedAbovePctCap++;
      else if (result.skip === 'missing_card') exc.droppedMissingCard++;
      continue;
    }
    if (risersOut.length < topN) risersOut.push(result);
  }
  for (const r of (fallerRaw ?? []) as unknown as CardTrendsRow[]) {
    const result = toMover(r, 'faller');
    if ('skip' in result) {
      if (result.skip === 'price_floor') exc.droppedBelowPriceFloor++;
      else if (result.skip === 'abs_change') exc.droppedBelowAbsChange++;
      else if (result.skip === 'liquidity') exc.droppedBelowLiquidity++;
      else if (result.skip === 'pct_cap') exc.droppedAbovePctCap++;
      else if (result.skip === 'missing_card') exc.droppedMissingCard++;
      continue;
    }
    if (fallersOut.length < topN) fallersOut.push(result);
  }

  const initialCount = trendRows.length;
  const survivors = risersOut.length + fallersOut.length;

  return {
    grade, windowDays, asOf,
    windowLabel: `${windowDays}-day window as of ${asOf}`,
    risers: risersOut, fallers: fallersOut,
    filters: { minPriceUsd, minAbsChangeUsd, minSales90d, minConfidence, pctChangeCap, includeSealed },
    exclusions: { initialCount, ...exc, survivors },
    provenance: {
      tables_read: ['card_trends', 'card_volume', 'cards'],
      service_endpoint: 'supabase://pokeprices (shared with Collector Network OS)',
      retrieved_at: new Date().toISOString(),
    },
  };
}

/** Convenience: fetch raw + PSA 10 movers for the same window and
 *  merge into a single evidence payload (useful for data-driven
 *  editorial where we want graded + ungraded alongside each other). */
export async function getFullMarketSnapshot(
  sb: SupabaseClient,
  args: {
    windowDays: PriceWindow;
    rawTopN?: number;
    psa10TopN?: number;
    rawFilters?: Parameters<typeof getMarketMovers>[1];
    psa10Filters?: Parameters<typeof getMarketMovers>[1];
  },
): Promise<{ raw: MarketMoversResult; psa10: MarketMoversResult }> {
  const [raw, psa10] = await Promise.all([
    getMarketMovers(sb, { grade: 'raw', windowDays: args.windowDays, topN: args.rawTopN ?? 10, ...(args.rawFilters ?? {}) }),
    getMarketMovers(sb, { grade: 'psa10', windowDays: args.windowDays, topN: args.psa10TopN ?? 10, ...(args.psa10Filters ?? {}) }),
  ]);
  return { raw, psa10 };
}

// Slice E — watchlist CRUD + valuation + movement composition.
//
// Every read/write goes through the caller's own Supabase session,
// so RLS alone enforces owner-only access.
//
// Movement math preserves the same attribution rules the rest of
// YGOPrices uses:
//   • per-printing retail only (never card-scoped, never cross-
//     printing)
//   • single currency per delta (never USD/EUR mixed)
//   • single source per delta (never TCGplayer vs Cardmarket mixed)
//   • baseline observation is closest-at-or-before the lookback
//     boundary; if no such observation exists, movement is null.

import {
  getPrintingsForCards,
  getSetsByIds,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
} from '@collector-network/database';
import { createServerSupabase } from '@collector-network/auth';
import {
  getRetailQuotesForPrintings,
  selectPreferredRetailQuote,
  type DailyRetailPoint,
} from '@collector-network/market-data';
import {
  buildMovementBundle,
  validateAddWatchInput,
  validateUpdateTargetInput,
  type AddWatchInput,
  type MovementBundle,
  type PriceObservation,
  type UpdateTargetInput,
  type WatchlistItemRow,
} from '../lib/watchlist-types';

const TABLE = 'ygo_watchlist_items';

// 95 days covers the 90D window comfortably even if the DB has one
// mid-week gap. Bound is inclusive-lower.
const HISTORY_LOOKBACK_DAYS = 95;

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    /does not exist/i.test(err.message ?? '') ||
    /Could not find the table/i.test(err.message ?? '')
  );
}

// ── Result types ────────────────────────────────────────────────

export interface TableMissing { ok: false; reason: 'table-missing'; }
export interface Failure { ok: false; reason: 'failed'; error: string; }
export interface Success<T> { ok: true; value: T; }
export type WatchlistResult<T> = Success<T> | TableMissing | Failure;

// ── Public shapes ───────────────────────────────────────────────

export interface WatchlistListItem {
  row: WatchlistItemRow;
  card: TcgCard | null;
  printing: TcgPrinting | null;
  set: TcgSet | null;
  currentPrice: number | null;
  currentCurrency: 'USD' | 'EUR' | null;
  currentSource: string | null;
  movement: MovementBundle | null;
  targetReached: boolean; // false when no target set OR currency mismatch
}

export interface WatchlistPageData {
  items: WatchlistListItem[];
}

// ── List + hydrate + price + movement ───────────────────────────

export async function listWatchlistForCurrentUser(): Promise<
  WatchlistResult<WatchlistPageData>
> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  const rows = (data as WatchlistItemRow[] | null) ?? [];
  if (rows.length === 0) return { ok: true, value: { items: [] } };

  const cardIds = Array.from(new Set(rows.map((r) => r.tcg_card_id)));
  const printingIds = Array.from(new Set(rows.map((r) => r.tcg_printing_id)));

  const [cardsById, printings, historyByPrinting] = await Promise.all([
    fetchCardsById(supabase, cardIds),
    getPrintingsForCards(supabase, cardIds),
    fetchRetailHistoryBatch(supabase, printingIds),
  ]);
  const printingsById = new Map<string, TcgPrinting>();
  for (const p of printings) printingsById.set(p.id, p);
  const setIds = Array.from(new Set([...cardsById.values()].map((c) => c.set_id)));
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  // Current-price fallback (in case a printing has no history rows in
  // the daily table but does have a current quote — batch fetches all).
  const currentQuotes = await getRetailQuotesForPrintings(supabase, printingIds);
  const currentByPrinting = new Map<string, ReturnType<typeof selectPreferredRetailQuote>>();
  const perPrinting = new Map<string, typeof currentQuotes>();
  for (const q of currentQuotes) {
    const b = perPrinting.get(q.printingId) ?? [];
    b.push(q);
    perPrinting.set(q.printingId, b);
  }
  for (const pid of printingIds) {
    currentByPrinting.set(
      pid,
      selectPreferredRetailQuote(perPrinting.get(pid) ?? [], 'USD'),
    );
  }

  const items: WatchlistListItem[] = rows.map((row) => {
    const card = cardsById.get(row.tcg_card_id) ?? null;
    const printing = printingsById.get(row.tcg_printing_id) ?? null;
    const set = card ? setsById.get(card.set_id) ?? null : null;

    // Pick the best single (currency × source) series for this
    // printing. Prefer USD, then EUR; within a currency, prefer the
    // source with the most recent observation.
    const series = historyByPrinting.get(row.tcg_printing_id) ?? [];
    const bestSeries = pickBestSeries(series);
    const movement = bestSeries ? buildMovementBundle(bestSeries) : null;

    // Prefer live current-quote when it exists (fresher than daily
    // aggregate); fall back to latest historical observation.
    const liveQuote = currentByPrinting.get(row.tcg_printing_id) ?? null;
    let currentPrice: number | null = null;
    let currentCurrency: 'USD' | 'EUR' | null = null;
    let currentSource: string | null = null;
    if (liveQuote?.price != null && (liveQuote.currency === 'USD' || liveQuote.currency === 'EUR')) {
      currentPrice = liveQuote.price;
      currentCurrency = liveQuote.currency;
      currentSource = liveQuote.source;
    } else if (movement) {
      currentPrice = movement.currentPrice;
      currentCurrency = (movement.currency === 'USD' || movement.currency === 'EUR')
        ? movement.currency
        : null;
      currentSource = movement.source;
    }

    // Target-reached requires SAME currency + a live current price.
    // Mixed-currency targets never fire — we don't FX-convert.
    const targetReached =
      row.target_price != null &&
      row.target_currency != null &&
      currentPrice != null &&
      currentCurrency === row.target_currency &&
      currentPrice <= row.target_price;

    return {
      row,
      card,
      printing,
      set,
      currentPrice,
      currentCurrency,
      currentSource,
      movement,
      targetReached,
    };
  });

  return { ok: true, value: { items } };
}

async function fetchCardsById(
  supabase: SupabaseClient,
  cardIds: readonly string[],
): Promise<Map<string, TcgCard>> {
  const out = new Map<string, TcgCard>();
  if (cardIds.length === 0) return out;
  const IN_BATCH = 100;
  for (let i = 0; i < cardIds.length; i += IN_BATCH) {
    const batch = cardIds.slice(i, i + IN_BATCH);
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('*')
      .in('id', batch as string[]);
    if (error) throw new Error(`[yugioh/watchlist] cards: ${error.message}`);
    for (const c of (data as TcgCard[] | null) ?? []) out.set(c.id, c);
  }
  return out;
}

// Batch retail-history fetch for many printings. Groups by
// (printing, currency, source) so the caller can pick a single series
// per row without cross-source or cross-currency contamination.
async function fetchRetailHistoryBatch(
  supabase: SupabaseClient,
  printingIds: readonly string[],
): Promise<Map<string, PriceObservation[]>> {
  const out = new Map<string, PriceObservation[]>();
  if (printingIds.length === 0) return out;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - HISTORY_LOOKBACK_DAYS);
  const sinceStr = since.toISOString().slice(0, 10);
  const IN_BATCH = 100;
  for (let i = 0; i < printingIds.length; i += IN_BATCH) {
    const batch = printingIds.slice(i, i + IN_BATCH);
    const { data, error } = await supabase
      .from('tcg_market_price_daily')
      .select('tcg_printing_id, observed_on, source, currency, price')
      .in('tcg_printing_id', batch as string[])
      .gte('observed_on', sinceStr)
      .not('price', 'is', null)
      .order('observed_on', { ascending: true });
    if (error) throw new Error(`[yugioh/watchlist] history: ${error.message}`);
    for (const raw of (data as DailyRetailRow[] | null) ?? []) {
      const bucket = out.get(raw.tcg_printing_id) ?? [];
      bucket.push({
        observedOn: raw.observed_on,
        price: raw.price as number,
        currency: raw.currency,
        source: raw.source,
      });
      out.set(raw.tcg_printing_id, bucket);
    }
  }
  return out;
}

interface DailyRetailRow {
  tcg_printing_id: string;
  observed_on: string;
  source: string;
  currency: string;
  price: number | null;
}

// Split observations by (currency × source), then pick the series
// with the most-recent observation. Ties broken by longest series.
// Preferring USD is deliberate — the rest of the app uses USD as the
// canonical display currency and we never FX-convert.
function pickBestSeries(
  observations: readonly PriceObservation[],
): PriceObservation[] | null {
  if (observations.length === 0) return null;
  const buckets = new Map<string, PriceObservation[]>();
  for (const o of observations) {
    const key = `${o.currency}::${o.source}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key))!.push(o);
  }
  const series = [...buckets.values()];
  series.sort((a, b) => {
    // USD ahead of everything else.
    const usdA = a[0]!.currency === 'USD' ? 1 : 0;
    const usdB = b[0]!.currency === 'USD' ? 1 : 0;
    if (usdA !== usdB) return usdB - usdA;
    // Most recent observation wins.
    const lastA = a.at(-1)!.observedOn;
    const lastB = b.at(-1)!.observedOn;
    if (lastA !== lastB) return lastA < lastB ? 1 : -1;
    // Longer series wins.
    if (a.length !== b.length) return b.length - a.length;
    return 0;
  });
  return series[0] ?? null;
}

// ── Writes ──────────────────────────────────────────────────────

export async function addWatchItem(
  input: Partial<AddWatchInput>,
): Promise<WatchlistResult<WatchlistItemRow>> {
  const validation = validateAddWatchInput(input);
  if (!validation.ok) {
    return { ok: false, reason: 'failed', error: validation.errors.join('; ') };
  }
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: user.id,
      tcg_card_id: validation.value.tcg_card_id,
      tcg_printing_id: validation.value.tcg_printing_id,
      target_price: validation.value.target_price,
      target_currency: validation.value.target_currency,
      note: validation.value.note,
    })
    .select('*')
    .single();
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    // 23505 = unique_violation on (user_id, tcg_printing_id). Treat
    // "already watched" as a soft success: reload the row and return
    // it, so the client just updates its UI.
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from(TABLE)
        .select('*')
        .eq('user_id', user.id)
        .eq('tcg_printing_id', validation.value.tcg_printing_id)
        .single();
      if (existing) return { ok: true, value: existing as WatchlistItemRow };
    }
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: data as WatchlistItemRow };
}

export async function updateWatchTarget(
  id: string,
  patch: Partial<UpdateTargetInput>,
): Promise<WatchlistResult<WatchlistItemRow>> {
  const validation = validateUpdateTargetInput(patch);
  if (!validation.ok) {
    return { ok: false, reason: 'failed', error: validation.errors.join('; ') };
  }
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      target_price: validation.value.target_price,
      target_currency: validation.value.target_currency,
      note: validation.value.note ?? null,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: data as WatchlistItemRow };
}

export async function removeWatchItem(
  id: string,
): Promise<WatchlistResult<null>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: null };
}

// Convenience: remove by (card, printing). Used by the toggle
// button on card + printing pages so it doesn't need to know the row id.
export async function removeWatchByPrinting(
  tcg_printing_id: string,
): Promise<WatchlistResult<null>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', user.id)
    .eq('tcg_printing_id', tcg_printing_id);
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: null };
}

// "Am I already watching this printing?" — used by the Watch button
// on card + printing pages so we can render the toggle in its correct
// state on first paint.
export async function isWatchingPrinting(
  tcg_printing_id: string,
): Promise<WatchlistResult<boolean>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true, value: false };
  const { data, error } = await supabase
    .from(TABLE)
    .select('id')
    .eq('user_id', user.id)
    .eq('tcg_printing_id', tcg_printing_id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { ok: true, value: false };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: !!data };
}

// Wipe every watchlist row owned by the caller. Used by the
// DangerZone flow.
export async function deleteAllWatchlistForCurrentUser(): Promise<
  WatchlistResult<number>
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { data, error, count } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', user.id)
    .select('id');
  if (error) {
    if (isMissingTable(error)) return { ok: true, value: 0 };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: count ?? data?.length ?? 0 };
}

// Lightweight counters for the /account dashboard.
export async function getWatchlistCountForCurrentUser(): Promise<
  WatchlistResult<number>
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true, value: 0 };
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if (error) {
    if (isMissingTable(error)) return { ok: true, value: 0 };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: count ?? 0 };
}

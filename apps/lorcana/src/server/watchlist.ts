// Lorcana watchlist CRUD + valuation (currency-aware).
//
// Every read/write goes through the caller's own Supabase session, so
// RLS enforces owner-only isolation. No service role.
//
// Valuation: raw retail quote for the (printing, currency) pair. USD
// uses TCGPlayer as the preferred source (via selectPreferredRetailQuote);
// EUR pulls Cardmarket native quotes directly — never FX-converted.

import 'server-only';
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
} from '@collector-network/market-data';
import { CURRENCY_SOURCE_KEY, type LorcanaCurrency } from '../lib/currency';

const TABLE = 'lorcana_watchlist_items';

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

export interface WatchlistItemRow {
  id: string;
  user_id: string;
  tcg_card_id: string;
  tcg_printing_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddWatchlistInput {
  tcg_card_id: string;
  tcg_printing_id: string;
  notes?: string | null;
}

export interface WatchlistListItem {
  row: WatchlistItemRow;
  card: TcgCard | null;
  printing: TcgPrinting | null;
  set: TcgSet | null;
  /** Price in the requested currency; null if we have no native quote. */
  priceInCurrency: number | null;
  currency: LorcanaCurrency;
}

export interface WatchlistPageData {
  items: WatchlistListItem[];
  count: number;
}

// ── List + hydrate + price ──────────────────────────────────────

export async function listWatchlistForCurrentUser(
  currency: LorcanaCurrency = 'USD',
): Promise<WatchlistResult<WatchlistPageData>> {
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
  if (rows.length === 0) return { ok: true, value: { items: [], count: 0 } };

  const cardIds = Array.from(new Set(rows.map((r) => r.tcg_card_id)));
  const printingIds = Array.from(new Set(rows.map((r) => r.tcg_printing_id)));

  const [cardsById, printings] = await Promise.all([
    fetchCardsById(supabase, cardIds),
    getPrintingsForCards(supabase, cardIds),
  ]);
  const printingsById = new Map<string, TcgPrinting>();
  for (const p of printings) printingsById.set(p.id, p);
  const setIds = Array.from(new Set([...cardsById.values()].map((c) => c.set_id)));
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  const priceByPrinting = await priceWatchlist(supabase, printingIds, currency);

  const items: WatchlistListItem[] = rows.map((row) => {
    const card = cardsById.get(row.tcg_card_id) ?? null;
    const printing = printingsById.get(row.tcg_printing_id) ?? null;
    const set = card ? setsById.get(card.set_id) ?? null : null;
    return {
      row,
      card,
      printing,
      set,
      priceInCurrency: priceByPrinting.get(row.tcg_printing_id) ?? null,
      currency,
    };
  });

  return { ok: true, value: { items, count: rows.length } };
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
    if (error) throw new Error(`[lorcana/watchlist] cards: ${error.message}`);
    for (const c of (data as TcgCard[] | null) ?? []) out.set(c.id, c);
  }
  return out;
}

async function priceWatchlist(
  supabase: SupabaseClient,
  printingIds: readonly string[],
  currency: LorcanaCurrency,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (printingIds.length === 0) return out;

  if (currency === 'EUR') {
    const { data, error } = await supabase
      .from('tcg_market_prices_current')
      .select('tcg_printing_id, price')
      .in('tcg_printing_id', [...printingIds])
      .eq('source', CURRENCY_SOURCE_KEY.EUR)
      .eq('currency', 'EUR');
    if (!error) {
      interface Row { tcg_printing_id: string; price: number | null; }
      for (const row of (data as Row[] | null) ?? []) {
        if (row.price != null) out.set(row.tcg_printing_id, row.price);
      }
    }
    return out;
  }

  const quotes = await getRetailQuotesForPrintings(supabase, [...printingIds]);
  const byPrinting = new Map<string, typeof quotes>();
  for (const q of quotes) {
    const b = byPrinting.get(q.printingId) ?? [];
    b.push(q);
    byPrinting.set(q.printingId, b);
  }
  for (const pid of printingIds) {
    const preferred = selectPreferredRetailQuote(byPrinting.get(pid) ?? [], 'USD');
    if (preferred?.price != null) out.set(pid, preferred.price);
  }
  return out;
}

// ── Writes ──────────────────────────────────────────────────────

export async function addWatchlistItem(
  input: Partial<AddWatchlistInput>,
): Promise<WatchlistResult<WatchlistItemRow>> {
  const tcg_card_id = typeof input.tcg_card_id === 'string' ? input.tcg_card_id.trim() : '';
  const tcg_printing_id =
    typeof input.tcg_printing_id === 'string' ? input.tcg_printing_id.trim() : '';
  if (!tcg_card_id || !tcg_printing_id) {
    return { ok: false, reason: 'failed', error: 'Missing card or printing' };
  }
  const notes =
    typeof input.notes === 'string' && input.notes.trim().length > 0
      ? input.notes.trim().slice(0, 500)
      : null;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: user.id,
      tcg_card_id,
      tcg_printing_id,
      notes,
    })
    .select('*')
    .single();
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    // 23505 = already watching this printing. Treat as soft success.
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from(TABLE)
        .select('*')
        .eq('user_id', user.id)
        .eq('tcg_printing_id', tcg_printing_id)
        .single();
      if (existing) return { ok: true, value: existing as WatchlistItemRow };
    }
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: data as WatchlistItemRow };
}

export async function removeWatchlistItem(id: string): Promise<WatchlistResult<null>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { error } = await supabase.from(TABLE).delete().eq('id', id).eq('user_id', user.id);
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: null };
}

export async function removeWatchlistItemByPrinting(
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

export async function isPrintingOnWatchlist(
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

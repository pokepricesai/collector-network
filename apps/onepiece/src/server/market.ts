import 'server-only';
import type { SupabaseClient, TcgCard, TcgPrinting, TcgSet } from '@collector-network/database';
import { getOnepieceClient } from './client';

// Market-movers helper.
//
// CN-COST-03 / CN-MARKET-FIX: aggregation moved into Postgres. See
// supabase/migrations/20261021000000_op_market_movers_rpc.sql. The
// RPC public.op_market_movers(p_window_days, p_currency) returns at
// most 60 pre-filtered rows from a cache that is rebuilt daily by
// the mtgprices-web tcggraph-refresh cron after each one-piece
// ingest. This module only enriches those 60 rows with
// printings / cards / sets metadata.
//
// The previous implementation streamed 190k-270k rows through
// PostgREST per 30-day window and timed out at ~8 s, producing a
// public-facing HTTP 500 on /market.

export type MoverWindow = 7 | 30 | 90;

export interface MoverEntry {
  card: TcgCard;
  printing: TcgPrinting;
  set: TcgSet | null;
  currency: string;
  latestPrice: number;
  previousPrice: number;
  changeAbs: number;
  changePct: number;
  flags: MoverFlags;
}

interface PrintingRow extends TcgPrinting {}

// Flag threshold is still enforced client-side so changes don't need
// a DB migration. The movers data itself already clamps to
// MAX_SANE_PRICE = 50 000 inside the RPC.
const FLAG_HIGH_PRICE = 5_000;

export interface MoverFlags {
  /** True when the price is unusually high and worth manual review
   *  before featuring in editorial placements. */
  highPrice: boolean;
}

interface MoverRpcRow {
  direction: 'riser' | 'faller';
  tcg_printing_id: string;
  currency: string;
  first_price: number | string;
  last_price:  number | string;
  observation_count: number;
  change_pct: number | string;
  computed_at: string;
}

/**
 * Fetches the top-N risers and fallers for a given window.
 *
 * `computedAt` is the timestamp of the cache snapshot the data was
 * served from. The page uses it to render a "data as of" label so
 * users understand the freshness. A thrown error (including the
 * SQLSTATE 02000 "no snapshot yet" case from the RPC) propagates to
 * the Next.js error boundary — the /market route is dynamic, so an
 * error produces a per-request HTTP 500, never a cached empty 200.
 */
export async function getMovers(
  windowDays: MoverWindow,
  limit = 30,       // ignored on the server side — RPC always returns 30 per tier
  currencyFilter?: string,
): Promise<{ risers: MoverEntry[]; fallers: MoverEntry[]; computedAt: Date | null }> {
  // `limit` kept for signature compatibility with existing callers.
  // The RPC's cache is sized for the top 30 per tier; a caller
  // asking for more is capped at 30. A caller asking for fewer gets
  // the top 30 and must slice downstream.
  void limit;

  const supabase = getOnepieceClient();

  const { data, error } = await supabase.rpc('op_market_movers', {
    p_window_days: windowDays,
    p_currency:    currencyFilter ?? null,
  });
  if (error) {
    // Throw so Next.js propagates to 500. Never fabricate empty.
    throw new Error(`[apps/onepiece] getMovers window=${windowDays}: ${error.message}`);
  }

  const rpcRows = (data as MoverRpcRow[] | null) ?? [];
  if (rpcRows.length === 0) {
    // Should be unreachable: the RPC raises when the cache is
    // missing, so a successful call with zero rows would mean the
    // cache was populated with an empty payload — which the refresh
    // function explicitly prevents via `WHERE a.n > 0`. Treat as a
    // genuine error.
    throw new Error(`[apps/onepiece] getMovers window=${windowDays}: cache returned zero rows`);
  }

  const num = (v: number | string): number => (typeof v === 'number' ? v : Number(v));
  const computedAt = rpcRows[0]?.computed_at
    ? new Date(rpcRows[0]!.computed_at)
    : null;

  const printingIds = new Set<string>();
  const raw: Array<MoverEntry & { direction: 'riser' | 'faller' }> = [];
  for (const r of rpcRows) {
    const first = num(r.first_price);
    const last  = num(r.last_price);
    const pct   = num(r.change_pct);
    printingIds.add(r.tcg_printing_id);
    raw.push({
      direction:     r.direction,
      printing:      { id: r.tcg_printing_id } as TcgPrinting,
      card:          { id: '' } as TcgCard,
      set:           null,
      currency:      r.currency,
      latestPrice:   last,
      previousPrice: first,
      changeAbs:     last - first,
      changePct:     pct,
      flags:         { highPrice: last >= FLAG_HIGH_PRICE },
    });
  }

  const printings = await fetchPrintingsByIds(supabase, [...printingIds]);
  const printingById = new Map(printings.map((p) => [p.id, p]));
  const cardIds = new Set<string>();
  for (const p of printings) cardIds.add(p.tcg_card_id);
  const setIds = new Set<string>();
  for (const p of printings) setIds.add(p.set_id);

  const [cardMap, setMap] = await Promise.all([
    fetchCardsByIds(supabase, [...cardIds]),
    fetchSetsByIds(supabase, [...setIds]),
  ]);

  // Preserve the RPC's ORDER BY by walking in input order and
  // splitting on direction.
  const risers:  MoverEntry[] = [];
  const fallers: MoverEntry[] = [];
  for (const m of raw) {
    const printing = printingById.get(m.printing.id);
    if (!printing) continue;
    const card = cardMap.get(printing.tcg_card_id);
    if (!card) continue;
    const populated: MoverEntry = {
      printing,
      card,
      set:           setMap.get(printing.set_id) ?? null,
      currency:      m.currency,
      latestPrice:   m.latestPrice,
      previousPrice: m.previousPrice,
      changeAbs:     m.changeAbs,
      changePct:     m.changePct,
      flags:         m.flags,
    };
    if (m.direction === 'riser') risers.push(populated);
    else fallers.push(populated);
  }
  return { risers, fallers, computedAt };
}

async function fetchPrintingsByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<PrintingRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('tcg_printings')
    .select('*')
    .in('id', ids);
  if (error) throw new Error(`[apps/onepiece] fetchPrintingsByIds: ${error.message}`);
  return (data as PrintingRow[] | null) ?? [];
}

async function fetchCardsByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, TcgCard>> {
  const out = new Map<string, TcgCard>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('*')
    .in('id', ids);
  if (error) throw new Error(`[apps/onepiece] fetchCardsByIds: ${error.message}`);
  for (const row of (data as TcgCard[] | null) ?? []) out.set(row.id, row);
  return out;
}

async function fetchSetsByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, TcgSet>> {
  const out = new Map<string, TcgSet>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from('tcg_sets')
    .select('*')
    .in('id', ids);
  if (error) throw new Error(`[apps/onepiece] fetchSetsByIds: ${error.message}`);
  for (const row of (data as TcgSet[] | null) ?? []) out.set(row.id, row);
  return out;
}

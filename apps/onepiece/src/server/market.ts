import 'server-only';
import type { SupabaseClient, TcgCard, TcgPrinting, TcgSet } from '@collector-network/database';
import { getOnepieceClient, getOnepieceGameId } from './client';

// Market-movers helper.
//
// Reads directly from tcg_market_price_daily to compute % change over
// the last N days. Filters out low-signal noise (>= $2, >= 3 observed
// days) mirroring the MTGPrices heuristic — this keeps the movers
// board legible.
//
// Query strategy: pull the newest and Nth-most-recent snapshot per
// printing in the window in one call, then join card / set metadata in
// bulk. Never mixes currencies — a mover always has one currency.

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
}

interface DailyRow {
  tcg_printing_id: string;
  currency: string;
  price: number | null;
  observed_on: string;
}

interface PrintingRow extends TcgPrinting {}

const MIN_LATEST_PRICE = 2;
const MIN_OBSERVATIONS = 3;

export async function getMovers(
  windowDays: MoverWindow,
  limit = 30,
): Promise<{ risers: MoverEntry[]; fallers: MoverEntry[] }> {
  const supabase = getOnepieceClient();
  const gameId = await getOnepieceGameId(supabase);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);
  const isoSince = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('tcg_market_price_daily')
    .select('tcg_printing_id, currency, price, observed_on')
    .eq('game_id', gameId)
    .gte('observed_on', isoSince)
    .order('observed_on', { ascending: true });
  if (error) {
    throw new Error(`[apps/onepiece] getMovers window=${windowDays}: ${error.message}`);
  }

  const rows = (data as DailyRow[] | null) ?? [];
  const buckets = new Map<string, DailyRow[]>();
  for (const r of rows) {
    if (r.price == null) continue;
    const key = `${r.tcg_printing_id}::${(r.currency ?? '').toUpperCase()}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }

  const raw: MoverEntry[] = [];
  const printingIds = new Set<string>();

  for (const [key, series] of buckets) {
    if (series.length < MIN_OBSERVATIONS) continue;
    const first = series[0];
    const last = series[series.length - 1];
    if (!first || !last || first.price == null || last.price == null) continue;
    if (last.price < MIN_LATEST_PRICE) continue;
    const changeAbs = last.price - first.price;
    if (first.price === 0) continue;
    const changePct = changeAbs / first.price;
    const [printingId, currency] = key.split('::');
    if (!printingId) continue;
    printingIds.add(printingId);
    raw.push({
      printing: { id: printingId } as TcgPrinting,
      card: { id: '' } as TcgCard,
      set: null,
      currency: currency ?? 'USD',
      latestPrice: last.price,
      previousPrice: first.price,
      changeAbs,
      changePct,
    });
  }

  if (raw.length === 0) return { risers: [], fallers: [] };

  const [printings, cards] = await Promise.all([
    fetchPrintingsByIds(supabase, [...printingIds]),
    Promise.resolve(null as null | Map<string, TcgCard>),
  ]);

  const printingById = new Map(printings.map((p) => [p.id, p]));
  const cardIds = new Set<string>();
  for (const p of printings) cardIds.add(p.tcg_card_id);
  const setIds = new Set<string>();
  for (const p of printings) setIds.add(p.set_id);

  const [cardMap, setMap] = await Promise.all([
    fetchCardsByIds(supabase, [...cardIds]),
    fetchSetsByIds(supabase, [...setIds]),
  ]);

  const populated: MoverEntry[] = [];
  for (const m of raw) {
    const printing = printingById.get(m.printing.id);
    if (!printing) continue;
    const card = cardMap.get(printing.tcg_card_id);
    if (!card) continue;
    populated.push({
      ...m,
      printing,
      card,
      set: setMap.get(printing.set_id) ?? null,
    });
  }

  const risers = [...populated]
    .filter((m) => m.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, limit);
  const fallers = [...populated]
    .filter((m) => m.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, limit);
  return { risers, fallers };
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

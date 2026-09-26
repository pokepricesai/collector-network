import 'server-only';
import type { SupabaseClient } from '@collector-network/database';
import { getOnepieceClient } from './client';

// Graded read model for OP. Same shape as tcg_graded_prices_current
// consumed by yugioh's collection layer — we return every row keyed
// to the given printing (printing attribution) plus every row keyed
// to its card family (card attribution). The pure `buildGradedView`
// helper decides which are surfaced and how.

export interface TcgGradedRow {
  tcg_printing_id: string | null;
  tcg_card_id: string | null;
  attribution: 'printing' | 'card';
  grader: string;
  grade: string;
  currency: string;
  price: number;
  card_sales_volume: number | null;
  updated_at: string | null;
}

export async function getGradedRowsForAnchor(
  anchor: { printingId: string; cardId: string },
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<TcgGradedRow[]> {
  // Two anchor queries in parallel: printing-attributed + card-
  // attributed. anon RLS allows both.
  const [byPrinting, byCard] = await Promise.all([
    supabase
      .from('tcg_graded_prices_current')
      .select('tcg_printing_id, tcg_card_id, attribution, grader, grade, currency, price, card_sales_volume, updated_at')
      .eq('tcg_printing_id', anchor.printingId)
      .eq('attribution', 'printing')
      .not('price', 'is', null),
    supabase
      .from('tcg_graded_prices_current')
      .select('tcg_printing_id, tcg_card_id, attribution, grader, grade, currency, price, card_sales_volume, updated_at')
      .eq('tcg_card_id', anchor.cardId)
      .eq('attribution', 'card')
      .not('price', 'is', null),
  ]);

  const rows: TcgGradedRow[] = [];
  for (const r of (byPrinting.data as TcgGradedRow[] | null) ?? []) rows.push(r);
  for (const r of (byCard.data as TcgGradedRow[] | null) ?? []) rows.push(r);
  return rows;
}

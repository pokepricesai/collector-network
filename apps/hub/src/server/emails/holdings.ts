import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrandSiteCode } from '@collector-network/email';

export interface HoldingSummary {
  holdingCount: number;
  totalValueMinor: number | null;
  currency: string;
  topHoldings: { name: string; valueFormatted: string }[];
}

// Per-site holdings query. For CN-03 MVP we report an honest count +
// optional top-N holding names; we do NOT invent a total value until
// pricing is wired through from TCGGraph in a follow-up slice. The
// spec is explicit: "If no reliable weekly movement is available,
// use a simpler useful summary rather than sending misleading
// figures."
export async function readHoldingSummary(
  admin: SupabaseClient,
  userId: string,
  siteCode: BrandSiteCode,
): Promise<HoldingSummary> {
  const empty: HoldingSummary = {
    holdingCount: 0,
    totalValueMinor: null,
    currency: 'GBP',
    topHoldings: [],
  };

  const tableFor: Partial<Record<BrandSiteCode, string>> = {
    mtg: 'mtg_collection_items',
    ygo: 'ygo_collection_items',
    onepiece: 'onepiece_collection_items',
    lorcana: 'lorcana_collection_items',
  };
  const table = tableFor[siteCode];
  if (!table) return empty;

  const { count, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) return empty;

  const holdingCount = count ?? 0;
  if (holdingCount === 0) return empty;

  // Keep the "top holdings" list honest: just return the first 3
  // distinct card ids as names. A follow-up slice can enrich with
  // card titles via a join to the shared cards table.
  const { data: rows } = await admin
    .from(table)
    .select('tcg_card_id')
    .eq('user_id', userId)
    .limit(3);
  const top = (rows ?? []).slice(0, 3).map((r) => ({
    name: typeof (r as { tcg_card_id?: unknown }).tcg_card_id === 'string'
      ? `Card ${((r as { tcg_card_id: string }).tcg_card_id).slice(0, 8)}`
      : 'Card',
    valueFormatted: '—',
  }));

  return {
    holdingCount,
    totalValueMinor: null,
    currency: 'GBP',
    topHoldings: top,
  };
}

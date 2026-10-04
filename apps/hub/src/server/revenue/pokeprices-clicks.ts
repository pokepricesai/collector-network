import 'server-only';

// Read-through for the existing pokeprices-web affiliate_events table
// that lives in the SAME shared Supabase project. We never write to
// this table from the hub — PP's own public ingest route owns it.
//
// Returns null if the table isn't reachable (missing migration or
// different project), so the dashboard can render a clear
// "not reachable" state without blowing up.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PokePricesClickTotals {
  views: number;
  clicks: number;
  total: number;
}

export async function pokepricesClickTotals(
  sb: SupabaseClient,
  sinceDate: string,
): Promise<PokePricesClickTotals | null> {
  const sinceIso = new Date(sinceDate + 'T00:00:00Z').toISOString();
  const { data, error } = await sb
    .from('affiliate_events')
    .select('event_type')
    .gte('created_at', sinceIso);
  if (error) {
    // Table not reachable in this Supabase project (or RLS blocked
    // for the admin role) — surface null so the UI can explain.
    return null;
  }
  const rows = (data ?? []) as Array<{ event_type: string }>;
  let views = 0;
  let clicks = 0;
  for (const r of rows) {
    if (r.event_type === 'view') views += 1;
    else if (r.event_type === 'click') clicks += 1;
  }
  return { views, clicks, total: views + clicks };
}

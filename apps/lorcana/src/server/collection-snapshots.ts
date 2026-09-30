// Lorcana collection value snapshots.
//
// One row per (user, observed_on, currency). The dashboard view is what
// triggers today's snapshot — writeSnapshotIfDue is called at the top
// of the /dashboard render. INSERT ON CONFLICT DO NOTHING guarantees
// at most one snapshot per user per day per currency.
//
// Never back-fills. The first snapshot IS the earliest datapoint; the
// value graph starts on the day the user first views their dashboard.

import 'server-only';
import { createServerSupabase } from '@collector-network/auth';
import { priceHoldings } from './collection';
import type { CollectionItemRow } from '../lib/collection-types';
import { CURRENCY_SOURCE_KEY, type LorcanaCurrency } from '../lib/currency';

const COLLECTION_TABLE = 'lorcana_collection_items';
const SNAPSHOTS_TABLE = 'lorcana_collection_snapshots';

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    /does not exist/i.test(err.message ?? '') ||
    /Could not find the table/i.test(err.message ?? '')
  );
}

export interface SnapshotRow {
  id: string;
  user_id: string;
  observed_on: string;
  currency: LorcanaCurrency;
  card_count: number;
  value: number;
  source: string;
  created_at: string;
}

export interface WriteSnapshotResult {
  ok: boolean;
  wrote: boolean;
  reason?: 'table-missing' | 'not-signed-in' | 'failed' | 'no-holdings';
  error?: string;
}

// UTC date string for "today". We snapshot per UTC day so a viewer in
// any timezone gets a single canonical daily row.
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function writeSnapshotIfDue(
  currency: LorcanaCurrency,
): Promise<WriteSnapshotResult> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, wrote: false, reason: 'not-signed-in' };

  // Load current holdings. If the collection table is missing we
  // simply skip — the dashboard will surface an empty state without
  // this call throwing.
  const { data: rowsData, error: rowsError } = await supabase
    .from(COLLECTION_TABLE)
    .select('*');
  if (rowsError) {
    if (isMissingTable(rowsError)) {
      return { ok: true, wrote: false, reason: 'table-missing' };
    }
    return { ok: false, wrote: false, reason: 'failed', error: rowsError.message };
  }
  const rows = (rowsData as CollectionItemRow[] | null) ?? [];
  if (rows.length === 0) {
    return { ok: true, wrote: false, reason: 'no-holdings' };
  }

  const priced = await priceHoldings(supabase, rows, new Map(), currency);
  let value = 0;
  let cardCount = 0;
  for (const p of priced) {
    cardCount += p.row.quantity;
    if (p.unitValue != null) value += p.unitValue * p.row.quantity;
  }
  // Round to 2dp to fit numeric(14,2) cleanly.
  value = Math.round(value * 100) / 100;

  const { error: insertError } = await supabase
    .from(SNAPSHOTS_TABLE)
    .insert({
      user_id: user.id,
      observed_on: todayUtc(),
      currency,
      card_count: cardCount,
      value,
      source: CURRENCY_SOURCE_KEY[currency],
    });
  if (insertError) {
    if (isMissingTable(insertError)) {
      return { ok: true, wrote: false, reason: 'table-missing' };
    }
    // 23505 = duplicate for (user, observed_on, currency). That's the
    // "already snapshotted today" case — success, but wrote:false.
    if (insertError.code === '23505') {
      return { ok: true, wrote: false };
    }
    return { ok: false, wrote: false, reason: 'failed', error: insertError.message };
  }
  return { ok: true, wrote: true };
}

export async function getCollectionValueHistory(
  currency: LorcanaCurrency,
  days = 30,
): Promise<SnapshotRow[]> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from(SNAPSHOTS_TABLE)
    .select('*')
    .eq('user_id', user.id)
    .eq('currency', currency)
    .gte('observed_on', sinceStr)
    .order('observed_on', { ascending: true });
  if (error) return [];
  return (data as SnapshotRow[] | null) ?? [];
}

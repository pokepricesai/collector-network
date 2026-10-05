import 'server-only';

// Read-only live production audit of the affiliate ledger. Powers
// /admin/revenue/audit so the OS itself can inspect what's in the DB
// instead of asking Luke to paste SQL output.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LedgerAudit {
  total_rows: number;
  earliest_occurred: string | null;
  latest_occurred: string | null;
  rows_without_occurred_on: number;
  rows_without_amount: number;
  rows_without_currency: number;
  rows_without_ledger_status: number;
  by_currency: Record<string, { rows: number; net_minor: number; booked_minor: number; pending_minor: number; reversed_minor: number }>;
  by_status: Array<{ status: string; rows: number; amount_minor_total: number }>;
  by_source: Array<{ source_slug: string; source_name: string; rows: number }>;
  by_campaign: Array<{ campaign_id: string | null; rows: number; mapped: number; unmapped: number }>;
  duplicate_transaction_ids: Array<{ transaction_id: string; count: number }>;
  aged_pending: Array<{ bucket: string; rows: number; amount_minor_by_currency: Record<string, number> }>;
  history_rows: number;
  history_transitions: number;
  recent_imports: Array<{ occurred_at: string; file_name: string | null; new_rows: number; updated_rows: number; status_transitions: number }>;
}

const AGE_BUCKETS: Array<{ label: string; minDays: number; maxDays: number | null }> = [
  { label: '<30d',   minDays: 0,   maxDays: 30 },
  { label: '30–60d', minDays: 30,  maxDays: 60 },
  { label: '60–90d', minDays: 60,  maxDays: 90 },
  { label: '90–180d',minDays: 90,  maxDays: 180 },
  { label: '180+d',  minDays: 180, maxDays: null },
];

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

export async function fetchLedgerAudit(sb: SupabaseClient): Promise<LedgerAudit> {
  // We page the full ledger because PostgREST caps at 1000 rows by
  // default and the audit must be complete, not sampled. Annual EPN
  // imports have landed ~4–5k rows historically; we cap defensively
  // at 50k to protect the function.
  const PAGE = 1000;
  const HARD_CAP = 50_000;
  const rows: Array<{
    id: string;
    source_id: string;
    site_id: string | null;
    occurred_on: string | null;
    amount_minor: number | null;
    currency: string | null;
    event_kind: string;
    ledger_status: string | null;
    external_ref: string | null;
    source_detail: Record<string, unknown> | null;
    first_seen_at: string | null;
  }> = [];
  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    const { data, error } = await sb
      .from('network_revenue_events')
      .select('id, source_id, site_id, occurred_on, amount_minor, currency, event_kind, ledger_status, external_ref, source_detail, first_seen_at')
      .in('event_kind', ['revenue', 'reversal'])
      .order('occurred_on', { ascending: true, nullsFirst: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`[audit] ledger page: ${error.message}`);
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // Only consider EPN rows in the aggregations; non-EPN sources
  // (sponsorship, display_ads, manual) don't have EPN semantics.
  const [{ data: sources }] = await Promise.all([
    sb.from('network_revenue_sources').select('id, slug, display_name, kind'),
  ]);
  const sourceById = new Map<string, { slug: string; name: string; kind: string }>();
  for (const s of (sources ?? []) as Array<{ id: string; slug: string; display_name: string; kind: string }>) {
    sourceById.set(s.id, { slug: s.slug, name: s.display_name, kind: s.kind });
  }
  const epnSourceIds = new Set(
    Array.from(sourceById.entries())
      .filter(([, v]) => v.kind === 'ebay_epn')
      .map(([id]) => id),
  );
  const epnRows = rows.filter((r) => epnSourceIds.has(r.source_id));

  // Validation counters.
  const rowsWithoutDate = epnRows.filter((r) => !r.occurred_on).length;
  const rowsWithoutAmount = epnRows.filter((r) => r.amount_minor == null).length;
  const rowsWithoutCurrency = epnRows.filter((r) => !r.currency).length;
  const rowsWithoutStatus = epnRows.filter((r) => !r.ledger_status).length;

  // Date range.
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const r of epnRows) {
    if (!r.occurred_on) continue;
    if (!earliest || r.occurred_on < earliest) earliest = r.occurred_on;
    if (!latest || r.occurred_on > latest) latest = r.occurred_on;
  }

  // By currency.
  const byCurrency: LedgerAudit['by_currency'] = {};
  for (const r of epnRows) {
    const ccy = r.currency ?? 'UNKNOWN';
    const b = byCurrency[ccy] ?? { rows: 0, net_minor: 0, booked_minor: 0, pending_minor: 0, reversed_minor: 0 };
    b.rows += 1;
    const amt = r.amount_minor ?? 0;
    b.net_minor += amt;
    const status = r.ledger_status ?? (r.source_detail?.['status'] as string | undefined) ?? 'unknown';
    if (status === 'confirmed') b.booked_minor += amt;
    else if (status === 'pending') b.pending_minor += amt;
    else if (status === 'reversed') b.reversed_minor += amt;
    byCurrency[ccy] = b;
  }

  // By raw status (catches anything we didn't predict).
  const byStatusMap = new Map<string, { rows: number; amount: number }>();
  for (const r of epnRows) {
    const status = r.ledger_status ?? (r.source_detail?.['status'] as string | undefined) ?? '(null)';
    const b = byStatusMap.get(status) ?? { rows: 0, amount: 0 };
    b.rows += 1;
    b.amount += r.amount_minor ?? 0;
    byStatusMap.set(status, b);
  }
  const byStatus = Array.from(byStatusMap.entries())
    .map(([status, b]) => ({ status, rows: b.rows, amount_minor_total: b.amount }))
    .sort((a, b) => b.rows - a.rows);

  // By source.
  const bySourceMap = new Map<string, number>();
  for (const r of epnRows) {
    bySourceMap.set(r.source_id, (bySourceMap.get(r.source_id) ?? 0) + 1);
  }
  const bySource = Array.from(bySourceMap.entries())
    .map(([sid, rowsCount]) => ({
      source_slug: sourceById.get(sid)?.slug ?? '(unknown source)',
      source_name: sourceById.get(sid)?.name ?? '(unknown)',
      rows: rowsCount,
    }))
    .sort((a, b) => b.rows - a.rows);

  // By campaign (reads source_detail jsonb since it isn't a column).
  const byCampaignMap = new Map<string | null, { rows: number; mapped: number; unmapped: number }>();
  for (const r of epnRows) {
    const campaign = (r.source_detail?.['campaign_id'] as string | undefined) ?? null;
    const bucket = byCampaignMap.get(campaign) ?? { rows: 0, mapped: 0, unmapped: 0 };
    bucket.rows += 1;
    if (r.site_id) bucket.mapped += 1;
    else bucket.unmapped += 1;
    byCampaignMap.set(campaign, bucket);
  }
  const byCampaign = Array.from(byCampaignMap.entries())
    .map(([cid, b]) => ({ campaign_id: cid, rows: b.rows, mapped: b.mapped, unmapped: b.unmapped }))
    .sort((a, b) => b.rows - a.rows);

  // Duplicate transaction ids. The (source_id, idempotency_key) unique
  // constraint prevents dupes within a source; a transaction appearing
  // under two different sources is possible but shouldn't happen in
  // the EPN flow (one transaction = one source).
  const txCount = new Map<string, number>();
  for (const r of epnRows) {
    const ref = r.external_ref;
    if (!ref) continue;
    txCount.set(ref, (txCount.get(ref) ?? 0) + 1);
  }
  const duplicates = Array.from(txCount.entries())
    .filter(([, c]) => c > 1)
    .map(([transaction_id, count]) => ({ transaction_id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Aged pending — only rows whose current ledger_status is 'pending'.
  const now = new Date();
  const bucketAccum: Record<string, Record<string, number>> = {};
  const bucketCounts: Record<string, number> = {};
  for (const b of AGE_BUCKETS) {
    bucketAccum[b.label] = {};
    bucketCounts[b.label] = 0;
  }
  for (const r of epnRows) {
    const status = r.ledger_status ?? (r.source_detail?.['status'] as string | undefined);
    if (status !== 'pending') continue;
    if (!r.occurred_on) continue;
    const age = daysBetween(now, new Date(r.occurred_on + 'T00:00:00Z'));
    for (const b of AGE_BUCKETS) {
      if (age >= b.minDays && (b.maxDays == null || age < b.maxDays)) {
        bucketCounts[b.label] = (bucketCounts[b.label] ?? 0) + 1;
        const ccy = r.currency ?? 'UNKNOWN';
        bucketAccum[b.label]![ccy] = (bucketAccum[b.label]![ccy] ?? 0) + (r.amount_minor ?? 0);
        break;
      }
    }
  }
  const agedPending = AGE_BUCKETS.map((b) => ({
    bucket: b.label,
    rows: bucketCounts[b.label] ?? 0,
    amount_minor_by_currency: bucketAccum[b.label] ?? {},
  }));

  // History volume + transition count.
  const { count: histCount } = await sb
    .from('network_affiliate_status_history')
    .select('*', { count: 'exact', head: true });
  const { count: transitionCount } = await sb
    .from('network_affiliate_status_history')
    .select('*', { count: 'exact', head: true })
    .not('from_status', 'is', null);

  // Last 5 EPN import audit log entries.
  const { data: imports } = await sb
    .from('network_audit_log')
    .select('occurred_at, new_value')
    .eq('action', 'revenue.epn_import')
    .order('occurred_at', { ascending: false })
    .limit(5);
  const recentImports = ((imports ?? []) as Array<{ occurred_at: string; new_value: Record<string, unknown> }>).map((r) => ({
    occurred_at: r.occurred_at,
    file_name: (r.new_value['file_name'] as string | undefined) ?? null,
    new_rows: (r.new_value['new_revenue'] as number | undefined) ?? (r.new_value['revenue_inserted'] as number | undefined) ?? 0,
    updated_rows: (r.new_value['updated_revenue'] as number | undefined) ?? 0,
    status_transitions: (r.new_value['status_transitions'] as number | undefined) ?? 0,
  }));

  return {
    total_rows: epnRows.length,
    earliest_occurred: earliest,
    latest_occurred: latest,
    rows_without_occurred_on: rowsWithoutDate,
    rows_without_amount: rowsWithoutAmount,
    rows_without_currency: rowsWithoutCurrency,
    rows_without_ledger_status: rowsWithoutStatus,
    by_currency: byCurrency,
    by_status: byStatus,
    by_source: bySource,
    by_campaign: byCampaign,
    duplicate_transaction_ids: duplicates,
    aged_pending: agedPending,
    history_rows: histCount ?? 0,
    history_transitions: transitionCount ?? 0,
    recent_imports: recentImports,
  };
}

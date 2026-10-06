import 'server-only';

// Read-only audit of exactly what would be removed if we reset the
// EPN ledger and rebuild from the Impact API.
//
// Scope rule: an EPN row is any row whose source_id lives in the set
// of network_revenue_sources where kind = 'ebay_epn'. That set is
// fixed (seeded as `ebay_epn_uk` + `ebay_epn_us`) and will not grow
// without an explicit migration, so this is deterministic.
//
// We also surface non-EPN sanity totals that MUST remain unchanged
// after any reset: those include sponsorship revenue, non-eBay
// affiliate rows, operating/AI costs, partners, tasks, approvals.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface EpnSourceRow {
  id: string;
  slug: string;
  display_name: string;
  default_currency: string;
  is_active: boolean;
  provider: string | null;
}

export interface DeleteScopeReport {
  ran_at: string;
  epn_sources: EpnSourceRow[];
  epn_source_ids: string[];
  counts: {
    // EPN-attributed rows that WOULD be removed by a scoped delete.
    network_revenue_events: number;
    network_revenue_events_by_source: Record<string, number>;
    network_affiliate_conversions: number;
    network_affiliate_status_history: number;   // auto-cascades on event delete
    network_revenue_daily: number;              // cascades too (ON DELETE CASCADE)
    network_affiliate_clicks: number;           // NOT deleted; FK is ON DELETE SET NULL. Shown for context.
    // Rows that would be AFFECTED but not deleted:
    network_partner_opportunities_touching_epn: number;   // source_id → SET NULL
  };
  // Everything that is NOT EPN. Totals here MUST NOT change post-reset.
  non_epn_sanity: {
    non_epn_revenue_events: number;
    sponsorship_attributed_revenue_events: number;
    revenue_sources_total: number;
    revenue_sources_non_epn: number;
    operating_costs: number;
    tasks: number;
    partners: number;
    approvals: number;
  };
  cascade_notes: Array<{ table: string; fk: string; delete_action: string }>;
  warnings: string[];
}

async function countAll(sb: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
  if (error) return 0;
  return count ?? 0;
}

async function countEq(sb: SupabaseClient, table: string, col: string, val: string): Promise<number> {
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true }).eq(col, val);
  if (error) return 0;
  return count ?? 0;
}

export async function runDeleteScopeAudit(sb: SupabaseClient): Promise<DeleteScopeReport> {
  const ran_at = new Date().toISOString();
  const warnings: string[] = [];

  // ── EPN source rows ───────────────────────────────────────────
  const { data: epnSourcesRaw, error: srcErr } = await sb
    .from('network_revenue_sources')
    .select('id, slug, display_name, default_currency, is_active, provider, kind')
    .eq('kind', 'ebay_epn')
    .order('slug');
  if (srcErr) warnings.push(`Could not read network_revenue_sources: ${srcErr.message}`);

  const epnSources: EpnSourceRow[] = (epnSourcesRaw ?? []).map((r) => ({
    id: String((r as { id: string }).id),
    slug: String((r as { slug: string }).slug),
    display_name: String((r as { display_name: string }).display_name),
    default_currency: String((r as { default_currency: string }).default_currency),
    is_active: Boolean((r as { is_active: boolean }).is_active),
    provider: ((r as { provider: string | null }).provider) ?? null,
  }));
  const epnSourceIds = epnSources.map((s) => s.id);

  // Everything downstream requires at least one EPN source.
  if (epnSourceIds.length === 0) {
    warnings.push('No rows in network_revenue_sources with kind = ebay_epn. There is nothing EPN-scoped to delete.');
  }

  // ── EPN row counts (what WOULD be removed) ────────────────────
  const eventsTotal = await safeCountIn(sb, 'network_revenue_events', 'source_id', epnSourceIds);
  const conversionsTotal = await safeCountIn(sb, 'network_affiliate_conversions', 'source_id', epnSourceIds);
  const dailyTotal = await safeCountIn(sb, 'network_revenue_daily', 'source_id', epnSourceIds);
  const clicksTotal = await safeCountIn(sb, 'network_affiliate_clicks', 'source_id', epnSourceIds);
  const oppsTotal = await safeCountIn(sb, 'network_partner_opportunities', 'source_id', epnSourceIds);

  // Per-source event count (so the UI can show UK vs US split).
  const perSource: Record<string, number> = {};
  for (const src of epnSources) {
    perSource[src.slug] = await countEq(sb, 'network_revenue_events', 'source_id', src.id);
  }

  // Status history piggybacks on revenue_event ids. Count them in two
  // steps: page the event ids in chunks of 1000, then for each chunk
  // further sub-chunk the IN list for the history count to 100 ids —
  // PostgREST passes the IN list as a URL query parameter, and a
  // single-shot `.in('revenue_event_id', 767_uuids)` produces a URL
  // too long for the proxy (fails with "fetch failed" or 414 and
  // Supabase surfaces it as a generic PostgrestError). 100 UUIDs
  // keeps the URL comfortably under 8 KB.
  let historyTotal = 0;
  if (epnSourceIds.length > 0) {
    const EVENT_PAGE = 1000;
    const COUNT_CHUNK = 100;
    let offset = 0;
    while (offset < 200_000) {
      const { data: eventIds, error } = await sb
        .from('network_revenue_events')
        .select('id')
        .in('source_id', epnSourceIds)
        .range(offset, offset + EVENT_PAGE - 1);
      if (error) {
        warnings.push(`Status-history count: event paging failed at offset=${offset}: ${error.code ?? 'err'} ${error.message}`);
        break;
      }
      const ids = (eventIds ?? []).map((r: { id: string }) => r.id);
      if (ids.length === 0) break;
      let chunkErr = false;
      for (let i = 0; i < ids.length; i += COUNT_CHUNK) {
        const slice = ids.slice(i, i + COUNT_CHUNK);
        const { count, error: histErr } = await sb
          .from('network_affiliate_status_history')
          .select('*', { count: 'exact', head: true })
          .in('revenue_event_id', slice);
        if (histErr) {
          warnings.push(`Status-history count: in(${slice.length} ids) failed — ${histErr.code ?? 'err'} ${histErr.message}`);
          chunkErr = true;
          break;
        }
        historyTotal += count ?? 0;
      }
      if (chunkErr) break;
      if (ids.length < EVENT_PAGE) break;
      offset += EVENT_PAGE;
    }
  }

  // ── Non-EPN sanity totals ─────────────────────────────────────
  // All these should remain exactly the same after the destructive step.
  let nonEpnEvents = 0;
  if (epnSourceIds.length === 0) {
    nonEpnEvents = await countAll(sb, 'network_revenue_events');
  } else {
    const { count, error } = await sb
      .from('network_revenue_events')
      .select('*', { count: 'exact', head: true })
      .not('source_id', 'in', `(${epnSourceIds.join(',')})`);
    if (error) warnings.push(`Error counting non-EPN events: ${error.message}`);
    nonEpnEvents = count ?? 0;
  }

  let sponsorshipEvents = 0;
  {
    const { count, error } = await sb
      .from('network_revenue_events')
      .select('*', { count: 'exact', head: true })
      .not('sponsorship_id', 'is', null);
    if (!error) sponsorshipEvents = count ?? 0;
  }

  const sourcesTotal = await countAll(sb, 'network_revenue_sources');

  let sourcesNonEpn = 0;
  {
    const { count, error } = await sb
      .from('network_revenue_sources')
      .select('*', { count: 'exact', head: true })
      .neq('kind', 'ebay_epn');
    if (!error) sourcesNonEpn = count ?? 0;
  }

  const opCosts = await countAll(sb, 'network_operating_costs');
  const tasks = await countAll(sb, 'network_tasks');
  const partners = await countAll(sb, 'network_partners');
  const approvals = await countAll(sb, 'network_approvals');

  return {
    ran_at,
    epn_sources: epnSources,
    epn_source_ids: epnSourceIds,
    counts: {
      network_revenue_events: eventsTotal,
      network_revenue_events_by_source: perSource,
      network_affiliate_conversions: conversionsTotal,
      network_affiliate_status_history: historyTotal,
      network_revenue_daily: dailyTotal,
      network_affiliate_clicks: clicksTotal,
      network_partner_opportunities_touching_epn: oppsTotal,
    },
    non_epn_sanity: {
      non_epn_revenue_events: nonEpnEvents,
      sponsorship_attributed_revenue_events: sponsorshipEvents,
      revenue_sources_total: sourcesTotal,
      revenue_sources_non_epn: sourcesNonEpn,
      operating_costs: opCosts,
      tasks: tasks,
      partners: partners,
      approvals: approvals,
    },
    cascade_notes: [
      { table: 'network_revenue_events',            fk: 'source_id → network_revenue_sources(id)',       delete_action: 'ON DELETE RESTRICT — keep the sources, delete events by source_id in (...)' },
      { table: 'network_affiliate_status_history',  fk: 'revenue_event_id → network_revenue_events(id)', delete_action: 'ON DELETE CASCADE — removed automatically with their events' },
      { table: 'network_affiliate_conversions',     fk: 'revenue_event_id → network_revenue_events(id)', delete_action: 'ON DELETE SET NULL — but must be deleted separately by source_id' },
      { table: 'network_affiliate_conversions',     fk: 'source_id → network_revenue_sources(id)',       delete_action: 'ON DELETE RESTRICT — delete these explicitly' },
      { table: 'network_revenue_daily',             fk: 'source_id → network_revenue_sources(id)',       delete_action: 'ON DELETE CASCADE — would be removed if source dropped; we keep source so delete rollups explicitly' },
      { table: 'network_affiliate_clicks',          fk: 'source_id → network_revenue_sources(id)',       delete_action: 'ON DELETE SET NULL — leave untouched (click data is independent of transaction identity)' },
      { table: 'network_partner_opportunities',     fk: 'source_id → network_revenue_sources(id)',       delete_action: 'ON DELETE SET NULL — leave untouched (opportunities survive)' },
    ],
    warnings,
  };
}

// Small helper to count rows whose column IN (values) safely when the
// values array is empty (Supabase `.in()` with [] returns 0 without
// hitting the DB, but we want to short-circuit cleanly either way).
async function safeCountIn(
  sb: SupabaseClient,
  table: string,
  column: string,
  values: string[],
): Promise<number> {
  if (values.length === 0) return 0;
  const { count, error } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true })
    .in(column, values);
  if (error) return 0;
  return count ?? 0;
}

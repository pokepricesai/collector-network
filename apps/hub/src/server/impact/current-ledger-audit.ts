import 'server-only';

// Read-only audit of what's currently in the EPN slice of
// network_revenue_events — used to diagnose the 453-vs-0 discrepancy
// on the reset executor page.
//
// All queries are SELECT-only. No writes anywhere.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MinimalAction } from './dry-run';

export interface LedgerRowShape {
  total: number;
  by_source_slug: Record<string, number>;
  by_ledger_status: Record<string, number>;         // '(null)' bucket for missing
  by_event_kind: Record<string, number>;
  by_currency: Record<string, number>;
  by_idempotency_prefix: Record<string, number>;    // 'impact:epn' / 'epn' / '(none)' / etc.
  by_shared_id_in_source_detail: Record<string, number>;  // '5339152105' etc.
  payout_total_minor_by_status: Record<string, Record<string, number>>; // status → currency → sum
  amount_total_minor_by_status: Record<string, Record<string, number>>;
  occurred_on_min: string | null;
  occurred_on_max: string | null;
  first_seen_min: string | null;
  first_seen_max: string | null;
  recorded_at_min: string | null;
  recorded_at_max: string | null;
  distinct_external_refs: number;
  duplicate_external_refs: number;
  provider_payload_present_count: number;           // source_detail.provider_payload present
}

export interface LedgerVsApi {
  api_action_count: number;
  ledger_action_count: number;
  both: number;                                     // ids in both
  only_api: number;
  only_ledger: number;
  // Note: this uses external_ref == Impact Action.Id as the join key.
  // Canonical ingest sets external_ref = Action.Id, so an "only_ledger"
  // row with an impact:epn:* idempotency_key implies the Action was
  // deleted from the Impact side (reversed-and-aged-out) OR there's a
  // mismatch worth investigating.
}

export interface JobRunRow {
  id: string;
  job_name: string;
  job_type: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  rows_examined: number | null;
  rows_inserted: number | null;
  rows_updated: number | null;
  rows_rejected: number | null;
  error_summary: string | null;
}

export interface SettingsRow {
  key: string;
  updated_at: string | null;
  value_summary: string;                            // one-line stringification for display
}

export interface AuditLogRow {
  id: string;
  occurred_at: string | null;
  actor: string | null;
  action: string | null;
  target: string | null;
  summary: string;
}

export interface CurrentLedgerAudit {
  ran_at: string;
  epn_sources: Array<{ id: string; slug: string }>;
  shape: LedgerRowShape;
  api_comparison: LedgerVsApi | null;
  recent_impact_job_runs: JobRunRow[];
  impact_settings_rows: SettingsRow[];
  recent_impact_audit_log: AuditLogRow[];
  warnings: string[];
}

interface LedgerRow {
  id: string;
  source_id: string;
  external_ref: string | null;
  idempotency_key: string | null;
  event_kind: string | null;
  ledger_status: string | null;
  amount_minor: number | null;
  currency: string | null;
  occurred_on: string | null;
  first_seen_at: string | null;
  recorded_at: string | null;
  source_detail: Record<string, unknown> | null;
}

function idempotencyPrefix(key: string | null): string {
  if (!key) return '(none)';
  const idx = key.lastIndexOf(':');
  if (idx <= 0) return key;
  // Treat 'impact:epn:<id>' as prefix 'impact:epn', 'epn:<id>' as 'epn', etc.
  const prefixUpToSecondColon = key.indexOf(':', key.indexOf(':') + 1);
  if (prefixUpToSecondColon > 0 && prefixUpToSecondColon < key.length - 1) {
    return key.slice(0, prefixUpToSecondColon);
  }
  return key.slice(0, idx);
}

function addMinor(bucket: Record<string, Record<string, number>>, state: string, currency: string, amount: number): void {
  const row = bucket[state] ?? {};
  row[currency] = (row[currency] ?? 0) + amount;
  bucket[state] = row;
}

export async function auditCurrentEpnLedger(
  sb: SupabaseClient,
  rawApiActions: MinimalAction[] | null,
): Promise<CurrentLedgerAudit> {
  const ran_at = new Date().toISOString();
  const warnings: string[] = [];

  // ── EPN sources ──────────────────────────────────────────────
  const { data: srcData, error: srcErr } = await sb
    .from('network_revenue_sources')
    .select('id, slug')
    .eq('kind', 'ebay_epn');
  if (srcErr) warnings.push(`Could not read EPN sources: ${srcErr.message}`);
  const sources = (srcData ?? []) as Array<{ id: string; slug: string }>;
  const slugById = new Map(sources.map((s) => [s.id, s.slug]));
  const sourceIds = sources.map((s) => s.id);

  // ── Pull all EPN rows (453 is small; one paged read) ─────────
  const rows: LedgerRow[] = [];
  if (sourceIds.length > 0) {
    const PAGE = 1000;
    for (let offset = 0; offset < 20_000; offset += PAGE) {
      const { data, error } = await sb
        .from('network_revenue_events')
        .select('id, source_id, external_ref, idempotency_key, event_kind, ledger_status, amount_minor, currency, occurred_on, first_seen_at, recorded_at, source_detail')
        .in('source_id', sourceIds)
        .order('recorded_at', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) {
        warnings.push(`Ledger read failed at offset=${offset}: ${error.code ?? 'err'} ${error.message}`);
        break;
      }
      const page = (data ?? []) as LedgerRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
  }

  // ── Compute shape stats ──────────────────────────────────────
  const by_source_slug: Record<string, number> = {};
  const by_ledger_status: Record<string, number> = {};
  const by_event_kind: Record<string, number> = {};
  const by_currency: Record<string, number> = {};
  const by_idempotency_prefix: Record<string, number> = {};
  const by_shared_id: Record<string, number> = {};
  const payoutByStateCcy: Record<string, Record<string, number>> = {};
  const amountByStateCcy: Record<string, Record<string, number>> = {};
  let occMin: string | null = null, occMax: string | null = null;
  let seenMin: string | null = null, seenMax: string | null = null;
  let recMin: string | null = null, recMax: string | null = null;
  const extRefs = new Map<string, number>();
  let payloadPresent = 0;

  for (const r of rows) {
    const slug = slugById.get(r.source_id) ?? '(unknown)';
    by_source_slug[slug] = (by_source_slug[slug] ?? 0) + 1;

    const ls = r.ledger_status ?? '(null)';
    by_ledger_status[ls] = (by_ledger_status[ls] ?? 0) + 1;

    const ek = r.event_kind ?? '(null)';
    by_event_kind[ek] = (by_event_kind[ek] ?? 0) + 1;

    const cc = r.currency ?? '(null)';
    by_currency[cc] = (by_currency[cc] ?? 0) + 1;

    const prefix = idempotencyPrefix(r.idempotency_key);
    by_idempotency_prefix[prefix] = (by_idempotency_prefix[prefix] ?? 0) + 1;

    const sd = r.source_detail ?? {};
    const sid = (sd as { shared_id?: unknown })['shared_id'];
    const sidStr = sid == null ? '(none)' : String(sid);
    by_shared_id[sidStr] = (by_shared_id[sidStr] ?? 0) + 1;

    if ((sd as { provider_payload?: unknown })['provider_payload'] != null) payloadPresent += 1;

    if (r.ledger_status && r.currency && r.amount_minor != null) {
      addMinor(payoutByStateCcy, r.ledger_status, r.currency, r.amount_minor);
      addMinor(amountByStateCcy, r.ledger_status, r.currency, r.amount_minor);
    }

    if (r.occurred_on) {
      if (!occMin || r.occurred_on < occMin) occMin = r.occurred_on;
      if (!occMax || r.occurred_on > occMax) occMax = r.occurred_on;
    }
    if (r.first_seen_at) {
      if (!seenMin || r.first_seen_at < seenMin) seenMin = r.first_seen_at;
      if (!seenMax || r.first_seen_at > seenMax) seenMax = r.first_seen_at;
    }
    if (r.recorded_at) {
      if (!recMin || r.recorded_at < recMin) recMin = r.recorded_at;
      if (!recMax || r.recorded_at > recMax) recMax = r.recorded_at;
    }

    if (r.external_ref) extRefs.set(r.external_ref, (extRefs.get(r.external_ref) ?? 0) + 1);
  }
  const distinctRefs = extRefs.size;
  let dupRefs = 0;
  for (const n of extRefs.values()) if (n > 1) dupRefs += 1;

  const shape: LedgerRowShape = {
    total: rows.length,
    by_source_slug,
    by_ledger_status,
    by_event_kind,
    by_currency,
    by_idempotency_prefix,
    by_shared_id_in_source_detail: by_shared_id,
    payout_total_minor_by_status: payoutByStateCcy,
    amount_total_minor_by_status: amountByStateCcy,
    occurred_on_min: occMin,
    occurred_on_max: occMax,
    first_seen_min: seenMin,
    first_seen_max: seenMax,
    recorded_at_min: recMin,
    recorded_at_max: recMax,
    distinct_external_refs: distinctRefs,
    duplicate_external_refs: dupRefs,
    provider_payload_present_count: payloadPresent,
  };

  // ── API vs ledger comparison (only if we have fresh API data) ─
  let api_comparison: LedgerVsApi | null = null;
  if (rawApiActions && rawApiActions.length > 0) {
    const apiIds = new Set<string>();
    for (const a of rawApiActions) if (a.id) apiIds.add(a.id);
    const ledgerIds = new Set<string>();
    for (const r of rows) if (r.external_ref) ledgerIds.add(r.external_ref);
    let both = 0, onlyLedger = 0;
    for (const r of ledgerIds) {
      if (apiIds.has(r)) both += 1;
      else onlyLedger += 1;
    }
    let onlyApi = 0;
    for (const a of apiIds) if (!ledgerIds.has(a)) onlyApi += 1;
    api_comparison = {
      api_action_count: apiIds.size,
      ledger_action_count: ledgerIds.size,
      both,
      only_api: onlyApi,
      only_ledger: onlyLedger,
    };
  }

  // ── Insertion-history evidence ───────────────────────────────
  const recent_impact_job_runs: JobRunRow[] = [];
  {
    const { data, error } = await sb
      .from('network_job_runs')
      .select('id, job_name, job_type, status, started_at, finished_at, rows_examined, rows_inserted, rows_updated, rows_rejected, error_summary')
      .or('job_name.ilike.%impact%,job_name.ilike.%epn%')
      .order('started_at', { ascending: false })
      .limit(20);
    if (error) warnings.push(`network_job_runs read failed: ${error.message}`);
    for (const r of (data ?? []) as JobRunRow[]) recent_impact_job_runs.push(r);
  }

  const impact_settings_rows: SettingsRow[] = [];
  {
    const { data, error } = await sb
      .from('network_settings')
      .select('key, updated_at, value')
      .or('key.ilike.%impact%,key.ilike.%epn%')
      .order('updated_at', { ascending: false });
    if (error) warnings.push(`network_settings read failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{ key: string; updated_at: string | null; value: unknown }>) {
      const v = r.value as Record<string, unknown> | null;
      const summary = v == null ? '(null)' : summariseSettingsValue(v);
      impact_settings_rows.push({ key: r.key, updated_at: r.updated_at, value_summary: summary });
    }
  }

  const recent_impact_audit_log: AuditLogRow[] = [];
  {
    // network_audit_log schema is defensively unknown here — select *
    // and then read with best-effort column names.
    const { data, error } = await sb
      .from('network_audit_log')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(50);
    if (error) {
      warnings.push(`network_audit_log read failed: ${error.message}`);
    } else {
      const impactRe = /impact|epn/i;
      for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
        const action = (raw['action'] ?? raw['action_name'] ?? '') as string;
        const target = (raw['target'] ?? raw['target_resource'] ?? '') as string;
        const details = JSON.stringify(raw['details'] ?? raw['metadata'] ?? '');
        if (!impactRe.test(action) && !impactRe.test(target) && !impactRe.test(details)) continue;
        recent_impact_audit_log.push({
          id: String(raw['id'] ?? ''),
          occurred_at: (raw['occurred_at'] ?? raw['created_at'] ?? null) as string | null,
          actor: (raw['actor'] ?? raw['actor_id'] ?? raw['user_id'] ?? null) as string | null,
          action: action || null,
          target: target || null,
          summary: details.length > 300 ? details.slice(0, 300) + '…' : details,
        });
        if (recent_impact_audit_log.length >= 15) break;
      }
    }
  }

  return {
    ran_at,
    epn_sources: sources,
    shape,
    api_comparison,
    recent_impact_job_runs,
    impact_settings_rows,
    recent_impact_audit_log,
    warnings,
  };
}

function summariseSettingsValue(v: Record<string, unknown>): string {
  // Keep the summary short so the panel renders cleanly.
  const keys = Object.keys(v);
  const picked: string[] = [];
  for (const k of ['ran_at', 'actions_upserted', 'actions_inserted', 'actions_updated', 'actions_seen', 'skipped_reason', 'total_days']) {
    if (k in v) picked.push(`${k}=${JSON.stringify(v[k])}`);
  }
  if (picked.length === 0) {
    const trimmed = keys.slice(0, 8).join(', ') + (keys.length > 8 ? `, …+${keys.length - 8}` : '');
    return `{${trimmed}}`;
  }
  return `{${picked.join(', ')}}`;
}

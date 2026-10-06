import 'server-only';

// Canonical Impact EPN ingest.
//
// Reads /Actions (and /ActionUpdates for diagnostics) in <=45-day
// windows and upserts into network_revenue_events using
// `impact:epn:<Action.Id>` as the idempotency key.
//
// Source-of-origin is determined by SharedId → slug mapping
// (see coverage-audit.ts). Any Action with an unknown or missing
// SharedId is REJECTED — the ingest never silently guesses a source.
//
// Currency is stored EXACTLY as returned by the API (the account
// payout/settlement currency). Downstream reporting must always
// read event.currency; never infer currency from source slug.
//
// Status mapping:
//   PENDING                 → event_kind='revenue',  ledger_status='pending'
//   APPROVED/LOCKED/PAID    → event_kind='revenue',  ledger_status='confirmed'
//   REVERSED                → event_kind='reversal', ledger_status='reversed',
//                             amount_minor = 0 (we do NOT create a negative
//                             current-state row — historical loss belongs in
//                             status history, which we populate when a change
//                             is observed between runs).
//
// Zero reliance on in-memory dry-run state: this module re-fetches
// the API every time it runs.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createImpactClient, type ImpactResponse } from './client';
import { SHARED_ID_TO_SLUG } from './coverage-audit';

const PAGE_SIZE = 500;
const PER_WINDOW_SAFETY_CAP = 10_000;
const OVERALL_SAFETY_CAP = 100_000;
const MAX_PAGES_PER_WINDOW = Math.ceil(PER_WINDOW_SAFETY_CAP / PAGE_SIZE) + 2;

export interface IngestOptions {
  // Days of history to pull. Backfill = 365. Daily cron = 7 (overlap window).
  totalDays: number;
  // Max window size. Impact caps /Actions at 45 days.
  windowDays?: number;
}

export interface IngestResult {
  ran_at: string;
  skipped_reason: string | null;
  total_days: number;
  window_days: number;
  windows: Array<{ start: string; end: string; status: 'ok' | 'partial' | 'failed'; actions_fetched: number; action_updates_fetched: number; error: string | null; duration_ms: number }>;
  total_api_calls: number;

  actions_seen: number;
  actions_rejected_unknown_shared_id: number;
  actions_rejected_missing_critical_fields: number;
  actions_upserted: number;
  actions_inserted: number;              // we count newly-inserted vs updated by first_seen_at comparison
  actions_updated: number;
  status_history_rows_inserted: number;
  action_updates_fetched: number;

  by_slug: Record<string, { ingested: number; pending: number; confirmed: number; reversed: number; payout_minor: number; amount_minor: number }>;
  warnings: string[];
  errors: string[];
}

interface MappedSource {
  slug: string;
  id: string;
  default_currency: string;
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function dateIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function dateTimeIso(d: Date): string {
  return `${dateIso(d)}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`;
}
function pickRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of ['Actions', 'ActionUpdates', 'Records', 'Items']) {
      const v = d[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}
function envelope(resp: ImpactResponse): Record<string, unknown> {
  return resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)
    ? (resp.data as Record<string, unknown>)
    : {};
}
function hasNextPage(env: Record<string, unknown>): boolean | null {
  for (const k of ['@nextpageuri', 'NextPageUri', '@nextpage']) {
    if (k in env) {
      const v = env[k];
      return !(v == null || v === '');
    }
  }
  return null;
}
function toMinor(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const minor = Math.round(n * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

async function paginate(
  client: ReturnType<typeof createImpactClient>,
  endpoint: string,
  baseParams: Record<string, string>,
): Promise<{ pages: number; records: Array<Record<string, unknown>>; capHit: boolean; error: string | null }> {
  const records: Array<Record<string, unknown>> = [];
  let pages = 0;
  let error: string | null = null;
  let capHit = false;

  for (let page = 1; page <= MAX_PAGES_PER_WINDOW; page++) {
    const resp = await client.get(endpoint, {
      ...baseParams,
      PageSize: String(PAGE_SIZE),
      Page: String(page),
    });
    if (!resp.ok) {
      error = `page ${page} returned ${resp.status}: ${resp.errorMessage ?? 'error'}`;
      break;
    }
    pages += 1;
    const env = envelope(resp);
    const batch = pickRecords(resp.data) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;

    for (const r of batch) {
      if (records.length >= PER_WINDOW_SAFETY_CAP) { capHit = true; break; }
      records.push(r);
    }
    if (capHit) break;
    const next = hasNextPage(env);
    if (next === false) break;
    if (next === null && batch.length < PAGE_SIZE) break;
  }

  return { pages, records, capHit, error };
}

interface MappedAction {
  action_id: string;
  source_id: string;
  source_slug: string;
  shared_id: string;
  state: string;
  occurred_on: string;      // YYYY-MM-DD
  payout_minor: number;     // 0 for REVERSED
  amount_minor: number;     // gross sale value
  currency: string;         // as returned by API
  campaign_id: string | null;
  event_kind: 'revenue' | 'reversal';
  ledger_status: 'pending' | 'confirmed' | 'reversed';
  provider_payload: Record<string, unknown>;
}

function classifyState(state: string): { event_kind: MappedAction['event_kind']; ledger_status: MappedAction['ledger_status'] } | null {
  switch (state.toUpperCase()) {
    case 'PENDING':
      return { event_kind: 'revenue', ledger_status: 'pending' };
    case 'APPROVED':
    case 'LOCKED':
    case 'PAID':
      return { event_kind: 'revenue', ledger_status: 'confirmed' };
    case 'REVERSED':
      return { event_kind: 'reversal', ledger_status: 'reversed' };
    default:
      return null;
  }
}

export async function ingestImpactEpn(
  sb: SupabaseClient,
  opts: IngestOptions,
): Promise<IngestResult> {
  const ran_at = new Date().toISOString();
  const warnings: string[] = [];
  const errors: string[] = [];
  const totalDays = Math.max(1, Math.min(opts.totalDays, 365 * 3));
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? 45, 45));

  let client: ReturnType<typeof createImpactClient>;
  try {
    client = createImpactClient();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return emptyResult(ran_at, totalDays, windowDays, reason);
  }

  // ── Resolve SharedId → source UUID ───────────────────────────
  const { data: srcData, error: srcErr } = await sb
    .from('network_revenue_sources')
    .select('id, slug, default_currency')
    .eq('kind', 'ebay_epn');
  if (srcErr) return emptyResult(ran_at, totalDays, windowDays, `Cannot read EPN sources: ${srcErr.message}`);

  const slugToSource = new Map<string, MappedSource>();
  for (const r of (srcData ?? []) as Array<{ id: string; slug: string; default_currency: string }>) {
    slugToSource.set(r.slug, { id: r.id, slug: r.slug, default_currency: r.default_currency });
  }
  const sharedIdToSource = new Map<string, MappedSource>();
  for (const [sid, slug] of Object.entries(SHARED_ID_TO_SLUG)) {
    const src = slugToSource.get(slug);
    if (!src) {
      errors.push(`SharedId mapping expects slug "${slug}" in network_revenue_sources, but no row found.`);
      continue;
    }
    sharedIdToSource.set(sid, src);
  }
  if (errors.length > 0) {
    return emptyResult(ran_at, totalDays, windowDays, `Source resolution failed: ${errors.join('; ')}`);
  }

  // ── Window plan ──────────────────────────────────────────────
  const now = new Date();
  const todayEndUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  const windows: Array<{ startDate: Date; endDate: Date }> = [];
  let remaining = totalDays;
  let anchor = new Date(todayEndUtc);
  while (remaining > 0) {
    const span = Math.min(windowDays, remaining);
    const endDate = new Date(anchor);
    const startDate = new Date(anchor.getTime() - (span - 1) * 86_400_000);
    startDate.setUTCHours(0, 0, 0, 0);
    windows.push({ startDate, endDate });
    anchor = new Date(startDate.getTime() - 86_400_000);
    anchor.setUTCHours(23, 59, 59, 0);
    remaining -= span;
  }

  // ── Fetch + classify + upsert ────────────────────────────────
  const windowResults: IngestResult['windows'] = [];
  let totalApiCalls = 0;
  let actionUpdatesFetched = 0;

  const mapped: MappedAction[] = [];
  let rejectedUnknown = 0;
  let rejectedMissing = 0;

  for (const w of windows) {
    const start = dateIso(w.startDate);
    const end = dateIso(w.endDate);
    const t0 = Date.now();

    const actionsP = await paginate(client, '/Actions', {
      ActionDateStart: dateTimeIso(w.startDate),
      ActionDateEnd: dateTimeIso(w.endDate),
    });
    totalApiCalls += actionsP.pages;

    const updatesP = await paginate(client, '/ActionUpdates', {
      StartDate: dateTimeIso(w.startDate),
      EndDate: dateTimeIso(w.endDate),
    });
    totalApiCalls += updatesP.pages;
    actionUpdatesFetched += updatesP.records.length;

    const windowStatus: IngestResult['windows'][number]['status'] =
      actionsP.error && updatesP.error ? 'failed'
        : actionsP.error || updatesP.error ? 'partial'
        : 'ok';

    windowResults.push({
      start, end,
      status: windowStatus,
      actions_fetched: actionsP.records.length,
      action_updates_fetched: updatesP.records.length,
      error: actionsP.error ?? updatesP.error ?? null,
      duration_ms: Date.now() - t0,
    });

    if (actionsP.error && actionsP.records.length === 0) {
      errors.push(`Window ${start}→${end} failed: ${actionsP.error}`);
      continue;
    }

    for (const r of actionsP.records) {
      if (mapped.length >= OVERALL_SAFETY_CAP) {
        warnings.push(`Overall ingest cap ${OVERALL_SAFETY_CAP} hit; some records skipped.`);
        break;
      }
      const id = r['Id'] != null ? String(r['Id']) : null;
      const state = r['State'] != null ? String(r['State']) : null;
      const dt = (r['EventDate'] ?? r['ActionDate']) as string | null;
      const payout = toMinor(r['Payout']);
      const amount = toMinor(r['Amount']);
      const currency = r['Currency'] != null ? String(r['Currency']) : null;
      const sharedId = r['SharedId'] != null ? String(r['SharedId']) : null;
      const occurredOn = dt ? dt.slice(0, 10) : null;

      if (!id || !state || !occurredOn || payout == null || amount == null || !currency || !sharedId) {
        rejectedMissing += 1;
        continue;
      }
      const src = sharedIdToSource.get(sharedId);
      if (!src) {
        rejectedUnknown += 1;
        continue;
      }
      const cls = classifyState(state);
      if (!cls) {
        rejectedMissing += 1;
        warnings.push(`Unknown State value "${state}" on Action ${id} — rejected.`);
        continue;
      }

      const campaign = r['CampaignId'] != null ? String(r['CampaignId']) : null;
      // On REVERSED we store amount_minor = 0 (current state is £0).
      // The original Payout, if any, lives in provider_payload for forensic
      // recovery later.
      const amountMinor = cls.ledger_status === 'reversed' ? 0 : payout;

      mapped.push({
        action_id: id,
        source_id: src.id,
        source_slug: src.slug,
        shared_id: sharedId,
        state,
        occurred_on: occurredOn,
        payout_minor: payout,
        amount_minor: amountMinor,
        currency,
        campaign_id: campaign,
        event_kind: cls.event_kind,
        ledger_status: cls.ledger_status,
        provider_payload: r,
      });
    }
  }

  // ── Upsert into network_revenue_events ───────────────────────
  const result: IngestResult = {
    ran_at,
    skipped_reason: null,
    total_days: totalDays,
    window_days: windowDays,
    windows: windowResults,
    total_api_calls: totalApiCalls,
    actions_seen: windowResults.reduce((a, w) => a + w.actions_fetched, 0),
    actions_rejected_unknown_shared_id: rejectedUnknown,
    actions_rejected_missing_critical_fields: rejectedMissing,
    actions_upserted: 0,
    actions_inserted: 0,
    actions_updated: 0,
    status_history_rows_inserted: 0,
    action_updates_fetched: actionUpdatesFetched,
    by_slug: {},
    warnings,
    errors,
  };

  if (mapped.length === 0) {
    return result;
  }

  // Pre-read existing events so we can:
  //  (a) count insert vs update,
  //  (b) detect ledger_status changes so we can append history rows.
  const idempKeys = mapped.map((m) => `impact:epn:${m.action_id}`);
  const existingByKey = new Map<string, { id: string; ledger_status: string | null; amount_minor: number; event_kind: string }>();
  // Chunked SELECT to avoid URL-length overflows on large upserts.
  for (let i = 0; i < idempKeys.length; i += 200) {
    const slice = idempKeys.slice(i, i + 200);
    const { data, error } = await sb
      .from('network_revenue_events')
      .select('id, idempotency_key, ledger_status, amount_minor, event_kind, source_id')
      .in('idempotency_key', slice);
    if (error) {
      warnings.push(`Pre-read existing events failed at chunk ${i}: ${error.code ?? 'err'} ${error.message}`);
      continue;
    }
    for (const r of (data ?? []) as Array<{ id: string; idempotency_key: string; ledger_status: string | null; amount_minor: number; event_kind: string }>) {
      existingByKey.set(r.idempotency_key, { id: r.id, ledger_status: r.ledger_status, amount_minor: r.amount_minor, event_kind: r.event_kind });
    }
  }

  // Build upsert payload.
  const rows = mapped.map((m) => ({
    source_id: m.source_id,
    event_kind: m.event_kind,
    occurred_on: m.occurred_on,
    amount_minor: m.amount_minor,
    currency: m.currency,
    description: null,
    source_detail: {
      api_state: m.state,
      shared_id: m.shared_id,
      campaign_id: m.campaign_id,
      gross_sale_minor: m.amount_minor,
      provider_payload: m.provider_payload,
    },
    external_ref: m.action_id,
    idempotency_key: `impact:epn:${m.action_id}`,
    ledger_status: m.ledger_status,
    first_seen_at: existingByKey.get(`impact:epn:${m.action_id}`) ? undefined : new Date().toISOString(),
    status_changed_at: new Date().toISOString(),
  }));

  // Chunked upsert.
  let upserted = 0;
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200);
    const { data, error } = await sb
      .from('network_revenue_events')
      .upsert(slice, { onConflict: 'source_id,idempotency_key', ignoreDuplicates: false })
      .select('id, idempotency_key, ledger_status');
    if (error) {
      errors.push(`Upsert chunk ${i}/${rows.length} failed: ${error.code ?? 'err'} ${error.message}`);
      continue;
    }
    const returned = (data ?? []) as Array<{ id: string; idempotency_key: string; ledger_status: string }>;
    upserted += returned.length;
    for (const r of returned) {
      const existed = existingByKey.get(r.idempotency_key);
      if (existed) updated += 1;
      else inserted += 1;
    }

    // Status history for changed rows (we always insert on insert too).
    const histRows: Array<Record<string, unknown>> = [];
    for (const r of returned) {
      const existed = existingByKey.get(r.idempotency_key);
      const toStatus = r.ledger_status;
      if (!existed) {
        histRows.push({
          revenue_event_id: r.id,
          observed_at: new Date().toISOString(),
          from_status: null,
          to_status: toStatus,
          from_amount_minor: null,
          to_amount_minor: slice.find((s) => s.idempotency_key === r.idempotency_key)?.amount_minor ?? null,
          from_event_kind: null,
          to_event_kind: slice.find((s) => s.idempotency_key === r.idempotency_key)?.event_kind ?? null,
          import_file_name: null,
          notes: 'Impact API first observation.',
        });
      } else if (existed.ledger_status !== toStatus) {
        histRows.push({
          revenue_event_id: r.id,
          observed_at: new Date().toISOString(),
          from_status: existed.ledger_status,
          to_status: toStatus,
          from_amount_minor: existed.amount_minor,
          to_amount_minor: slice.find((s) => s.idempotency_key === r.idempotency_key)?.amount_minor ?? null,
          from_event_kind: existed.event_kind,
          to_event_kind: slice.find((s) => s.idempotency_key === r.idempotency_key)?.event_kind ?? null,
          import_file_name: null,
          notes: 'Impact API sync — status change observed.',
        });
      }
    }
    if (histRows.length > 0) {
      const { error: histErr } = await sb
        .from('network_affiliate_status_history')
        .insert(histRows);
      if (histErr) {
        warnings.push(`History insert chunk ${i} failed: ${histErr.code ?? 'err'} ${histErr.message}`);
      } else {
        result.status_history_rows_inserted += histRows.length;
      }
    }
  }

  result.actions_upserted = upserted;
  result.actions_inserted = inserted;
  result.actions_updated = updated;

  // Per-slug summary
  for (const m of mapped) {
    const row = result.by_slug[m.source_slug] ?? { ingested: 0, pending: 0, confirmed: 0, reversed: 0, payout_minor: 0, amount_minor: 0 };
    row.ingested += 1;
    if (m.ledger_status === 'pending') row.pending += 1;
    if (m.ledger_status === 'confirmed') row.confirmed += 1;
    if (m.ledger_status === 'reversed') row.reversed += 1;
    row.payout_minor += m.payout_minor;
    row.amount_minor += m.amount_minor;
    result.by_slug[m.source_slug] = row;
  }

  return result;
}

function emptyResult(ran_at: string, totalDays: number, windowDays: number, reason: string): IngestResult {
  return {
    ran_at,
    skipped_reason: reason,
    total_days: totalDays,
    window_days: windowDays,
    windows: [],
    total_api_calls: 0,
    actions_seen: 0,
    actions_rejected_unknown_shared_id: 0,
    actions_rejected_missing_critical_fields: 0,
    actions_upserted: 0,
    actions_inserted: 0,
    actions_updated: 0,
    status_history_rows_inserted: 0,
    action_updates_fetched: 0,
    by_slug: {},
    warnings: [reason],
    errors: [reason],
  };
}

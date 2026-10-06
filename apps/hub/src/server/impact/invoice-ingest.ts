import 'server-only';

// Canonical Impact invoice ingest.
//
// Reads /Invoices with full pagination and upserts into
// public.network_affiliate_invoices. Settlement data is intentionally
// kept OUT of network_revenue_events so dashboards do not conflate
// "earned commission" with "actually paid".
//
// Field mapping is defensive: Impact's invoice schema varies by
// account tier and we may see renamed keys over time. We accept
// several common field names and persist the full raw record under
// `provider_payload` for forensic recovery.
//
// Source routing: invoices are not tied to a single transaction, so
// we attach them to the EPN source that matches the invoice's
// Campaign/Advertiser name if we can, otherwise fall back to the
// account-currency source. All invoices are, in this account, GBP.
//
// Idempotency: unique (source_id, provider_invoice_id).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createImpactClient, type ImpactResponse } from './client';

const PAGE_SIZE = 200;
const SAFETY_CAP = 2_000;
const MAX_PAGES = Math.ceil(SAFETY_CAP / PAGE_SIZE) + 2;

export interface InvoiceIngestResult {
  ran_at: string;
  skipped_reason: string | null;
  pages_fetched: number;
  invoices_seen: number;
  invoices_upserted: number;
  invoices_inserted: number;
  invoices_updated: number;
  invoices_rejected: number;
  totals_by_currency: Record<string, { count: number; total_minor: number; paid_count: number }>;
  earliest_invoice_date: string | null;
  latest_invoice_date: string | null;
  warnings: string[];
  errors: string[];
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function dateIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function pickRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of ['Invoices', 'Records', 'Items']) {
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
function strOrNull(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}
function dateOnly(v: unknown): string | null {
  const s = strOrNull(v);
  if (!s) return null;
  return s.slice(0, 10);
}

interface MappedInvoice {
  source_id: string;
  provider_invoice_id: string;
  invoice_date: string | null;
  period_start_on: string | null;
  period_end_on: string | null;
  currency: string;
  total_minor: number;
  vat_minor: number | null;
  recipient: string | null;
  payment_status: string | null;
  paid_on: string | null;
  provider_payload: Record<string, unknown>;
}

export async function ingestImpactInvoices(sb: SupabaseClient): Promise<InvoiceIngestResult> {
  const ran_at = new Date().toISOString();
  const warnings: string[] = [];
  const errors: string[] = [];

  let client: ReturnType<typeof createImpactClient>;
  try {
    client = createImpactClient();
  } catch (err) {
    return empty(ran_at, err instanceof Error ? err.message : String(err));
  }

  // Resolve a default source — all invoices in this account are GBP,
  // so route to ebay_epn_uk unless we can match on a per-row signal
  // later. Keep both ids for future per-advertiser routing.
  const { data: srcData, error: srcErr } = await sb
    .from('network_revenue_sources')
    .select('id, slug')
    .eq('kind', 'ebay_epn');
  if (srcErr) return empty(ran_at, `EPN sources read failed: ${srcErr.message}`);
  const idBySlug = new Map<string, string>();
  for (const r of (srcData ?? []) as Array<{ id: string; slug: string }>) idBySlug.set(r.slug, r.id);
  const defaultSourceId = idBySlug.get('ebay_epn_uk') ?? idBySlug.get('ebay_epn_us') ?? null;
  if (!defaultSourceId) return empty(ran_at, 'No EPN sources resolvable for invoice attachment.');

  // ── Fetch ────────────────────────────────────────────────────
  const raw: Array<Record<string, unknown>> = [];
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await client.get('/Invoices', {
      PageSize: String(PAGE_SIZE),
      Page: String(page),
    });
    if (!resp.ok) {
      if (page === 1) {
        return empty(ran_at, `/Invoices returned ${resp.status}: ${resp.errorMessage ?? 'error'}`);
      }
      warnings.push(`/Invoices page ${page} returned ${resp.status}: ${resp.errorMessage ?? 'error'}; stopping at ${raw.length}.`);
      break;
    }
    pages += 1;
    const env = envelope(resp);
    const batch = pickRecords(resp.data) as Array<Record<string, unknown>>;
    if (batch.length === 0) break;
    for (const r of batch) {
      if (raw.length >= SAFETY_CAP) {
        warnings.push(`Invoice safety cap ${SAFETY_CAP} hit; stopping.`);
        break;
      }
      raw.push(r);
    }
    const next = hasNextPage(env);
    if (next === false) break;
    if (next === null && batch.length < PAGE_SIZE) break;
  }

  // ── Map ──────────────────────────────────────────────────────
  const mapped: MappedInvoice[] = [];
  let rejected = 0;
  for (const r of raw) {
    const id = strOrNull(r['Id'] ?? r['InvoiceId'] ?? r['InvoiceNumber']);
    if (!id) { rejected += 1; continue; }

    const invoiceDate = dateOnly(r['InvoiceDate'] ?? r['Date'] ?? r['CreationDate']);
    const periodStart = dateOnly(r['PeriodStart'] ?? r['PeriodStartDate'] ?? r['StartDate']);
    const periodEnd   = dateOnly(r['PeriodEnd']   ?? r['PeriodEndDate']   ?? r['EndDate']);

    const total = toMinor(r['TotalAmount'] ?? r['Total'] ?? r['Amount']);
    if (total == null) { rejected += 1; continue; }

    const currency = strOrNull(r['Currency'] ?? r['CurrencyCode']) ?? 'GBP';
    const vat = toMinor(r['VatAmount'] ?? r['Vat'] ?? r['Tax'] ?? r['TaxAmount']);
    const recipient = strOrNull(r['Recipient'] ?? r['PayeeName'] ?? r['BillTo']);
    const paymentStatus = strOrNull(r['Status'] ?? r['PaymentStatus'] ?? r['InvoiceStatus']);
    const paidOn = dateOnly(r['PaidDate'] ?? r['PaidOn'] ?? r['PaidAt']);

    mapped.push({
      source_id: defaultSourceId,
      provider_invoice_id: id,
      invoice_date: invoiceDate,
      period_start_on: periodStart,
      period_end_on: periodEnd,
      currency,
      total_minor: total,
      vat_minor: vat,
      recipient,
      payment_status: paymentStatus,
      paid_on: paidOn,
      provider_payload: r,
    });
  }

  // ── Upsert ───────────────────────────────────────────────────
  const result: InvoiceIngestResult = {
    ran_at,
    skipped_reason: null,
    pages_fetched: pages,
    invoices_seen: raw.length,
    invoices_upserted: 0,
    invoices_inserted: 0,
    invoices_updated: 0,
    invoices_rejected: rejected,
    totals_by_currency: {},
    earliest_invoice_date: null,
    latest_invoice_date: null,
    warnings,
    errors,
  };

  if (mapped.length === 0) return result;

  // Pre-read to count insert vs update.
  const providerIds = mapped.map((m) => m.provider_invoice_id);
  const existing = new Set<string>();
  for (let i = 0; i < providerIds.length; i += 200) {
    const slice = providerIds.slice(i, i + 200);
    const { data, error } = await sb
      .from('network_affiliate_invoices')
      .select('provider_invoice_id')
      .in('provider_invoice_id', slice);
    if (error) {
      warnings.push(`pre-read existing invoices chunk ${i} failed: ${error.message}`);
      continue;
    }
    for (const r of (data ?? []) as Array<{ provider_invoice_id: string }>) existing.add(r.provider_invoice_id);
  }

  for (let i = 0; i < mapped.length; i += 200) {
    const slice = mapped.slice(i, i + 200);
    const { data, error } = await sb
      .from('network_affiliate_invoices')
      .upsert(slice as unknown as Record<string, unknown>[], { onConflict: 'source_id,provider_invoice_id', ignoreDuplicates: false })
      .select('provider_invoice_id');
    if (error) {
      errors.push(`invoice upsert chunk ${i} failed: ${error.code ?? 'err'} ${error.message}`);
      continue;
    }
    const returned = (data ?? []) as Array<{ provider_invoice_id: string }>;
    result.invoices_upserted += returned.length;
    for (const r of returned) {
      if (existing.has(r.provider_invoice_id)) result.invoices_updated += 1;
      else result.invoices_inserted += 1;
    }
  }

  for (const m of mapped) {
    const row = result.totals_by_currency[m.currency] ?? { count: 0, total_minor: 0, paid_count: 0 };
    row.count += 1;
    row.total_minor += m.total_minor;
    if (m.payment_status && /paid/i.test(m.payment_status)) row.paid_count += 1;
    result.totals_by_currency[m.currency] = row;

    if (m.invoice_date) {
      if (!result.earliest_invoice_date || m.invoice_date < result.earliest_invoice_date) result.earliest_invoice_date = m.invoice_date;
      if (!result.latest_invoice_date   || m.invoice_date > result.latest_invoice_date)   result.latest_invoice_date   = m.invoice_date;
    }
  }

  return result;
}

function empty(ran_at: string, reason: string): InvoiceIngestResult {
  return {
    ran_at,
    skipped_reason: reason,
    pages_fetched: 0,
    invoices_seen: 0,
    invoices_upserted: 0,
    invoices_inserted: 0,
    invoices_updated: 0,
    invoices_rejected: 0,
    totals_by_currency: {},
    earliest_invoice_date: null,
    latest_invoice_date: null,
    warnings: [reason],
    errors: [reason],
  };
}

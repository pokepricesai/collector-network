'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/server/admin/require-admin';
import {
  buildEpnPreview,
  classifyReconciliation,
  type EpnCampaignMap,
  type EpnPreview,
  type EpnRow,
  type ExistingLedgerRow,
} from './epn-import';

// Build the campaign map from env + the live network_revenue_sources
// table. Env is the source of truth for which campaign ID maps to
// which site (EPN controls campaign IDs, not us). Format:
//   EPN_CAMPAIGN_MAP="5338606910:pokemon:ebay_epn_uk:GBP,5339215010:lorcana:ebay_epn_uk:GBP,..."

async function loadCampaignMap(): Promise<EpnCampaignMap> {
  const { sb } = await requireAdmin('/admin/revenue/import');
  const raw = (process.env['EPN_CAMPAIGN_MAP'] ?? '').trim();
  const map: EpnCampaignMap = { byCampaignId: {} };
  if (!raw) return map;
  const [{ data: sitesData }, { data: sourcesData }] = await Promise.all([
    sb.from('network_sites').select('id, slug'),
    sb.from('network_revenue_sources').select('id, slug, default_currency'),
  ]);
  const siteBySlug = new Map<string, string>();
  for (const s of (sitesData ?? []) as Array<{ id: string; slug: string }>) siteBySlug.set(s.slug, s.id);
  const sourceBySlug = new Map<string, { id: string; currency: string }>();
  for (const s of (sourcesData ?? []) as Array<{ id: string; slug: string; default_currency: string }>) {
    sourceBySlug.set(s.slug, { id: s.id, currency: s.default_currency });
  }
  for (const part of raw.split(',')) {
    const [cid, siteSlug, sourceSlug, ccy] = part.split(':').map((s) => s.trim());
    if (!cid || !siteSlug || !sourceSlug) continue;
    const site = siteBySlug.get(siteSlug);
    const source = sourceBySlug.get(sourceSlug);
    if (!site || !source) continue;
    map.byCampaignId[cid] = {
      siteId: site,
      siteSlug,
      sourceId: source.id,
      currency: (ccy || source.currency || 'GBP').toUpperCase(),
    };
  }
  return map;
}

// Preview blob stashed in network_settings.
function previewKey(adminRowId: string): string {
  return `epn_import_preview.${adminRowId.toLowerCase()}`;
}

async function savePreview(preview: EpnPreview, adminRowId: string): Promise<void> {
  const { sb } = await requireAdmin('/admin/revenue/import');
  const key = previewKey(adminRowId);
  await sb.from('network_settings').delete().eq('key', key);
  const { error } = await sb.from('network_settings').insert({
    key,
    value: preview as unknown as Record<string, unknown>,
    description: `EPN import preview staged by admin ${adminRowId}`,
  });
  if (error) throw new Error(`[epn] savePreview: ${error.message}`);
}

async function loadPreview(adminRowId: string): Promise<EpnPreview | null> {
  const { sb } = await requireAdmin('/admin/revenue/import');
  const { data, error } = await sb.from('network_settings')
    .select('value')
    .eq('key', previewKey(adminRowId))
    .maybeSingle();
  if (error) return null;
  return (data?.value ?? null) as EpnPreview | null;
}

async function clearPreview(adminRowId: string): Promise<void> {
  const { sb } = await requireAdmin('/admin/revenue/import');
  await sb.from('network_settings').delete().eq('key', previewKey(adminRowId));
}

/**
 * Fetch existing network_revenue_events rows that match the
 * (source_id, idempotency_key) pairs we're about to import. Returned
 * rows feed the reconciliation classifier so the UI can preview the
 * diff before committing.
 */
async function fetchExistingLedgerRows(
  sb: SupabaseClient,
  mappedRows: EpnRow[],
): Promise<ExistingLedgerRow[]> {
  if (mappedRows.length === 0) return [];
  // Postgres `IN` can swallow thousands of ids but we chunk to stay
  // under PostgREST's URL length cap on big annual CSVs.
  const CHUNK = 500;
  const seen = new Set<string>();
  const out: ExistingLedgerRow[] = [];
  for (let i = 0; i < mappedRows.length; i += CHUNK) {
    const chunk = mappedRows.slice(i, i + CHUNK);
    const keys = chunk.map((r) => r.idempotency_key);
    const { data, error } = await sb
      .from('network_revenue_events')
      .select('id, source_id, idempotency_key, amount_minor, event_kind, ledger_status, occurred_on, first_seen_at')
      .in('idempotency_key', keys);
    if (error) throw new Error(`[epn] fetchExisting: ${error.message}`);
    for (const row of (data ?? []) as ExistingLedgerRow[]) {
      // Second-level filter: match on BOTH source_id + idempotency_key
      // because the unique constraint is composite.
      const compositeKey = `${row.source_id}:${row.idempotency_key}`;
      if (seen.has(compositeKey)) continue;
      seen.add(compositeKey);
      out.push(row);
    }
  }
  return out;
}

export async function previewEpnImportAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/revenue/import');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('CSV file required');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('file too large (max 10MB)');
  }
  const text = await file.text();
  const map = await loadCampaignMap();
  const preview = buildEpnPreview(file.name, text, map);
  // Attach the reconciliation diff BEFORE committing so Luke sees
  // "281 new / 3,850 unchanged / 74 pending → confirmed / 9 → reversed"
  // in the preview UI, not just a totals summary.
  const mappedRows = preview.accepted.filter((r) => r.mapped_source_id && r.mapped_site_id);
  const existing = await fetchExistingLedgerRows(sb, mappedRows);
  preview.reconciliation = classifyReconciliation(preview, existing);
  await savePreview(preview, admin.adminRowId);
  redirect('/admin/revenue/import?step=preview');
}

/**
 * Build the row payload for a revenue event — the shape we insert
 * or update. Signed amount_minor for reversals; event_kind reflects
 * current status (revenue vs reversal). ledger_status is persisted
 * on the dedicated column so queries don't need to probe jsonb.
 */
function buildRevenueRow(
  row: EpnRow,
  preview: EpnPreview,
  adminId: string,
  nowIso: string,
  isFirstSeen: boolean,
  priorFirstSeenAt: string | null,
): Record<string, unknown> {
  const sourceDetail: Record<string, unknown> = {
    status: row.status,
    campaign_id: row.campaign_id,
    custom_id: row.custom_id,
    item_title: row.item_title,
    row_index: row.row_index,
    file_name: preview.file_name,
  };
  const eventKind: 'revenue' | 'reversal' = row.status === 'reversed' ? 'reversal' : 'revenue';
  return {
    source_id: row.mapped_source_id!,
    site_id: row.mapped_site_id!,
    event_kind: eventKind,
    occurred_on: row.occurred_on,
    amount_minor: row.earnings_minor,
    currency: row.currency,
    description: row.item_title ?? `EPN ${row.status} · ${row.custom_id ?? ''}`,
    source_detail: sourceDetail,
    external_ref: row.transaction_id,
    idempotency_key: row.idempotency_key,
    entered_by: adminId,
    ledger_status: row.status,
    // Preserve first_seen on updates; stamp on first observation.
    first_seen_at: isFirstSeen ? nowIso : (priorFirstSeenAt ?? nowIso),
    status_changed_at: nowIso,
  };
}

export async function commitEpnImportAction(): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/revenue/import');
  const preview = await loadPreview(admin.adminRowId);
  if (!preview) throw new Error('no preview to commit');

  const mapped = preview.accepted.filter((r) => r.mapped_source_id && r.mapped_site_id);
  const skipped = preview.accepted.length - mapped.length;

  // Refresh reconciliation at commit time so the diff is based on
  // the current DB state (the preview could have been staged
  // minutes/hours ago).
  const existing = await fetchExistingLedgerRows(sb, mapped);
  const reconciliation = classifyReconciliation(preview, existing);

  const existingByKey = new Map<string, ExistingLedgerRow>();
  for (const e of existing) existingByKey.set(`${e.source_id}:${e.idempotency_key}`, e);

  const nowIso = new Date().toISOString();

  // Separate inserts (new transactions) from updates (status/amount
  // changes). Unchanged rows are skipped — no DB write at all. This
  // is the critical performance invariant: for an annual re-import
  // where ~90% of rows are unchanged, those rows cost zero write
  // calls after classification.
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ priorRow: ExistingLedgerRow; incoming: EpnRow }> = [];
  const touchedRows: EpnRow[] = [];  // new + changed, for conversion mirror

  for (const row of mapped) {
    const key = `${row.mapped_source_id}:${row.idempotency_key}`;
    const prior = existingByKey.get(key);
    if (!prior) {
      toInsert.push(buildRevenueRow(row, preview, admin.adminRowId, nowIso, true, null));
      touchedRows.push(row);
      continue;
    }
    const statusDiffers = (prior.ledger_status ?? 'unknown') !== row.status;
    const amountDiffers = prior.amount_minor !== row.earnings_minor;
    if (!statusDiffers && !amountDiffers) continue; // untouched — zero writes
    toUpdate.push({ priorRow: prior, incoming: row });
    touchedRows.push(row);
  }

  const CHUNK = 500;
  let insertedRevenue = 0;
  const historyRowsForNew: Record<string, unknown>[] = [];
  const historyRowsForUpdates: Record<string, unknown>[] = [];

  // 1. Bulk-insert the genuinely new rows and capture ids for history.
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from('network_revenue_events')
      .insert(chunk)
      .select('id, idempotency_key, source_id, amount_minor, event_kind, ledger_status');
    if (error) throw new Error(`[epn] revenue insert: ${error.message}`);
    insertedRevenue += (data ?? []).length;
    for (const r of (data ?? []) as Array<{ id: string; idempotency_key: string; source_id: string; amount_minor: number; event_kind: string; ledger_status: string }>) {
      historyRowsForNew.push({
        revenue_event_id: r.id,
        observed_at: nowIso,
        from_status: null,
        to_status: r.ledger_status,
        from_amount_minor: null,
        to_amount_minor: r.amount_minor,
        from_event_kind: null,
        to_event_kind: r.event_kind,
        import_file_name: preview.file_name,
        notes: 'First observation via EPN import.',
      });
    }
  }

  // 2. Chunked UPSERT of changed rows. supabase-js ignoreDuplicates:
  //    false emits `ON CONFLICT (source_id, idempotency_key) DO UPDATE
  //    SET ...`, giving us a single round-trip per 500 rows regardless
  //    of how many of them changed. We preserve each row's prior
  //    first_seen_at so the stamp doesn't flap on repeat imports.
  //
  //    Also builds history rows from the pre-change classification
  //    (we have the prior state in hand — no re-read needed).
  let updatedRevenue = 0;
  const upsertPayload = toUpdate.map((u) => {
    const row = buildRevenueRow(
      u.incoming, preview, admin.adminRowId, nowIso, false,
      u.priorRow.first_seen_at,
    );
    // event_kind flip for status transitions in/out of 'reversed'.
    const newEventKind = u.incoming.status === 'reversed' ? 'reversal' : 'revenue';
    historyRowsForUpdates.push({
      revenue_event_id: u.priorRow.id,
      observed_at: nowIso,
      from_status: u.priorRow.ledger_status,
      to_status: u.incoming.status,
      from_amount_minor: u.priorRow.amount_minor,
      to_amount_minor: u.incoming.earnings_minor,
      from_event_kind: u.priorRow.event_kind,
      to_event_kind: newEventKind,
      import_file_name: preview.file_name,
      notes: null,
    });
    return row;
  });
  for (let i = 0; i < upsertPayload.length; i += CHUNK) {
    const chunk = upsertPayload.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from('network_revenue_events')
      .upsert(chunk, { onConflict: 'source_id,idempotency_key', ignoreDuplicates: false })
      .select('id');
    if (error) throw new Error(`[epn] revenue upsert: ${error.message}`);
    updatedRevenue += (data ?? []).length;
  }

  // 3. Append history rows (one call per 500).
  const allHistory = [...historyRowsForNew, ...historyRowsForUpdates];
  for (let i = 0; i < allHistory.length; i += CHUNK) {
    const chunk = allHistory.slice(i, i + CHUNK);
    const { error } = await sb
      .from('network_affiliate_status_history')
      .insert(chunk);
    if (error) throw new Error(`[epn] history insert: ${error.message}`);
  }

  // 4. Mirror new+changed rows into network_affiliate_conversions.
  //    Unchanged conversions already have correct provider_payload
  //    from the prior import — no reason to re-upsert them.
  const conversionRows = touchedRows.map((row) => ({
    source_id: row.mapped_source_id,
    site_id: row.mapped_site_id,
    provider_order_id: row.transaction_id,
    occurred_on: row.occurred_on,
    amount_minor: Math.abs(row.earnings_minor),
    currency: row.currency,
    provider_payload: {
      status: row.status,
      campaign_id: row.campaign_id,
      custom_id: row.custom_id,
      item_title: row.item_title,
      file_name: preview.file_name,
    },
    ledger_status: row.status,
    idempotency_key: `epn:conv:${row.transaction_id}`,
  }));
  let insertedConversions = 0;
  for (let i = 0; i < conversionRows.length; i += CHUNK) {
    const chunk = conversionRows.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from('network_affiliate_conversions')
      .upsert(chunk, { onConflict: 'source_id,idempotency_key', ignoreDuplicates: false })
      .select('id');
    if (error) throw new Error(`[epn] conv upsert: ${error.message}`);
    insertedConversions += (data ?? []).length;
  }

  await sb.from('network_audit_log').insert({
    actor_type: 'human',
    actor_user_id: admin.authUserId,
    action: 'revenue.epn_import',
    entity_type: 'network_revenue_events',
    new_value: {
      file_name: preview.file_name,
      total_rows: preview.total_rows,
      accepted_rows: preview.accepted.length,
      rejected_rows: preview.rejected.length,
      mapped_rows: mapped.length,
      unchanged: reconciliation.unchanged_count,
      new_revenue: insertedRevenue,
      updated_revenue: updatedRevenue,
      status_transitions: reconciliation.status_transitions.length,
      amount_corrections: reconciliation.amount_corrections.length,
      conversions_touched: insertedConversions,
      skipped,
      unmapped_campaigns: preview.unmapped_campaigns,
    },
  });

  await clearPreview(admin.adminRowId);
  revalidatePath('/admin/revenue');
  revalidatePath('/admin/revenue/entries');
  revalidatePath('/admin/revenue/audit');
  redirect(
    `/admin/revenue?imported=${insertedRevenue}&updated=${updatedRevenue}&unchanged=${reconciliation.unchanged_count}`,
  );
}

export async function cancelEpnPreviewAction(): Promise<void> {
  const { admin } = await requireAdmin('/admin/revenue/import');
  await clearPreview(admin.adminRowId);
  redirect('/admin/revenue/import');
}

export async function readPreviewForUi(): Promise<EpnPreview | null> {
  const { admin } = await requireAdmin('/admin/revenue/import');
  return loadPreview(admin.adminRowId);
}

export interface CampaignMapRow {
  campaign_id: string;
  site_slug: string;
  source_slug: string;
  currency: string;
  resolved: boolean;
  issue?: string;
}

export interface CampaignMapAudit {
  raw_present: boolean;
  raw_length: number;
  parsed_rows: CampaignMapRow[];
  invalid_rows: Array<{ raw_part: string; reason: string }>;
}

export async function readCampaignMapAudit(): Promise<CampaignMapAudit> {
  const { sb } = await requireAdmin('/admin/revenue/import');
  const raw = (process.env['EPN_CAMPAIGN_MAP'] ?? '').trim();
  const audit: CampaignMapAudit = {
    raw_present: raw.length > 0,
    raw_length: raw.length,
    parsed_rows: [],
    invalid_rows: [],
  };
  if (!raw) return audit;

  const [{ data: sitesData }, { data: sourcesData }] = await Promise.all([
    sb.from('network_sites').select('slug'),
    sb.from('network_revenue_sources').select('slug'),
  ]);
  const siteSet = new Set(((sitesData ?? []) as Array<{ slug: string }>).map((s) => s.slug));
  const sourceSet = new Set(((sourcesData ?? []) as Array<{ slug: string }>).map((s) => s.slug));

  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const bits = trimmed.split(':').map((s) => s.trim());
    if (bits.length < 3) {
      audit.invalid_rows.push({ raw_part: trimmed, reason: `expected 3-4 colon-separated fields, got ${bits.length}` });
      continue;
    }
    const [cid, siteSlug, sourceSlug, ccyRaw] = bits;
    if (!cid || !siteSlug || !sourceSlug) {
      audit.invalid_rows.push({ raw_part: trimmed, reason: 'empty field' });
      continue;
    }
    const currency = (ccyRaw || 'GBP').toUpperCase();
    const siteKnown = siteSet.has(siteSlug);
    const sourceKnown = sourceSet.has(sourceSlug);
    const row: CampaignMapRow = {
      campaign_id: cid,
      site_slug: siteSlug,
      source_slug: sourceSlug,
      currency,
      resolved: siteKnown && sourceKnown,
    };
    if (!siteKnown && !sourceKnown) row.issue = 'unknown site slug and source slug';
    else if (!siteKnown) row.issue = `unknown site slug: ${siteSlug}`;
    else if (!sourceKnown) row.issue = `unknown source slug: ${sourceSlug}`;
    audit.parsed_rows.push(row);
  }

  return audit;
}

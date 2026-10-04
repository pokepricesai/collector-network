'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';
import { buildEpnPreview, type EpnCampaignMap, type EpnPreview } from './epn-import';

// Build the campaign map from env + the live network_revenue_sources
// table. Env is the source of truth for which campaign ID maps to
// which site (EPN controls campaign IDs, not us). Format:
//   EPN_CAMPAIGN_MAP="5338606910:pokemon:ebay_epn_uk:GBP,5339215010:lorcana:ebay_epn_uk:GBP,..."
// `source_slug` is the slug of a row in network_revenue_sources.

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

// Preview blob stashed in network_settings. network_settings.key is
// constrained to ^[a-z][a-z0-9_.-]*$ so we lowercase the UUID.
function previewKey(adminRowId: string): string {
  return `epn_import_preview.${adminRowId.toLowerCase()}`;
}

async function savePreview(preview: EpnPreview, adminRowId: string): Promise<void> {
  const { sb } = await requireAdmin('/admin/revenue/import');
  const key = previewKey(adminRowId);
  // delete-then-insert: NULL site_id in unique(site_id, key) doesn't
  // collide, so upsert on key alone wouldn't dedupe.
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

export async function previewEpnImportAction(formData: FormData): Promise<void> {
  const { admin } = await requireAdmin('/admin/revenue/import');
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
  await savePreview(preview, admin.adminRowId);
  redirect('/admin/revenue/import?step=preview');
}

export async function commitEpnImportAction(): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/revenue/import');
  const preview = await loadPreview(admin.adminRowId);
  if (!preview) throw new Error('no preview to commit');

  let insertedRevenue = 0;
  let insertedConversions = 0;
  let skipped = 0;

  for (const row of preview.accepted) {
    if (!row.mapped_source_id) { skipped += 1; continue; }

    const sourceDetail: Record<string, unknown> = {
      status: row.status,
      campaign_id: row.campaign_id,
      custom_id: row.custom_id,
      item_title: row.item_title,
      row_index: row.row_index,
      file_name: preview.file_name,
    };

    // Pending-status rows go into revenue_events marked pending via
    // source_detail.status; reversed rows go in as 'reversal' event
    // kind so SUMs stay honest; confirmed rows are plain 'revenue'.
    const eventKind: 'revenue' | 'reversal' = row.status === 'reversed' ? 'reversal' : 'revenue';

    const { error: eErr } = await sb.from('network_revenue_events').insert({
      source_id: row.mapped_source_id,
      site_id: row.mapped_site_id,
      event_kind: eventKind,
      occurred_on: row.occurred_on,
      amount_minor: row.earnings_minor,
      currency: row.currency,
      description: row.item_title ?? `EPN ${row.status} · ${row.custom_id ?? ''}`,
      source_detail: sourceDetail,
      external_ref: row.transaction_id,
      idempotency_key: row.idempotency_key,
      entered_by: admin.adminRowId,
    });
    if (eErr) {
      if (eErr.code !== '23505') throw new Error(`[epn] revenue insert: ${eErr.message}`);
      skipped += 1;
    } else {
      insertedRevenue += 1;
    }

    // Mirror into network_affiliate_conversions so the reconciled
    // conversions view works. click_id stays null — we never infer.
    const convKey = `epn:conv:${row.transaction_id}`;
    const { error: cErr } = await sb.from('network_affiliate_conversions').insert({
      source_id: row.mapped_source_id,
      site_id: row.mapped_site_id,
      provider_order_id: row.transaction_id,
      occurred_on: row.occurred_on,
      amount_minor: Math.abs(row.earnings_minor),
      currency: row.currency,
      provider_payload: sourceDetail,
      idempotency_key: convKey,
    });
    if (!cErr) insertedConversions += 1;
    else if (cErr.code !== '23505') throw new Error(`[epn] conversion insert: ${cErr.message}`);
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
      revenue_inserted: insertedRevenue,
      conversions_inserted: insertedConversions,
      skipped,
      unmapped_campaigns: preview.unmapped_campaigns,
    },
  });

  await clearPreview(admin.adminRowId);
  revalidatePath('/admin/revenue');
  revalidatePath('/admin/revenue/entries');
  redirect(`/admin/revenue?imported=${insertedRevenue}&conv=${insertedConversions}`);
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
  resolved: boolean;        // true if site + source both found in DB
  issue?: string;
}

export interface CampaignMapAudit {
  raw_present: boolean;
  raw_length: number;
  parsed_rows: CampaignMapRow[];
  invalid_rows: Array<{ raw_part: string; reason: string }>;
}

/**
 * Public read of the parsed EPN_CAMPAIGN_MAP for display on
 * /admin/revenue/import. Campaign IDs are already public (they
 * ride on every outbound eBay link); nothing else is exposed.
 * Validates each row against network_sites + network_revenue_sources
 * so the admin can see which rows will actually attribute.
 */
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

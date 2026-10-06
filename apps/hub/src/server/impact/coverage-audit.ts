import 'server-only';

// UK + US EPN coverage audit — SharedId-based.
//
// The *decisive* coverage test is Impact's SharedId field, which
// carries the EPN campaign / tracking identifier. Historical live
// evidence (ran 2026-10-06):
//
//   SharedId 5339152105  → 92  Actions  → ebay_epn_uk campaign
//   SharedId 5339152106  → 360 Actions  → ebay_epn_us campaign
//                           ─────────
//                            452 total (100% of the window)
//
// Therefore every API Action is attributable to one of our two
// existing EPN campaigns, and the API dataset covers the full
// footprint of both legacy sources — not just UK.
//
// external_ref matching is kept here as a *secondary* diagnostic only.
// The CSV importer stored EPN Transaction IDs in external_ref; those
// IDs can differ from Impact's Action.Id (different provider id
// spaces), so overlap on external_ref is not expected to be high and
// MUST NOT be used as a coverage signal.
//
// Currency semantics:
//
//   The API returns Action.Currency = GBP for Actions in BOTH SharedId
//   populations, including the US campaign. That is because GBP is
//   the account's payout/settlement currency, not evidence the
//   originating transaction was GBP-native. The campaign of origin is
//   SharedId, not Currency.
//
// All queries are READ-ONLY.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MinimalAction } from './dry-run';

// Hardcoded mapping. Lives in code (not DB) because it is the
// definitive, verified-against-live-data lookup — changing it should
// be a reviewed code change, not a config toggle.
export const SHARED_ID_TO_SLUG: Readonly<Record<string, string>> = Object.freeze({
  '5339152105': 'ebay_epn_uk',
  '5339152106': 'ebay_epn_us',
});

export interface LegacyEpnSource {
  id: string;
  slug: string;
  display_name: string;
  default_currency: string;
}

export interface MatchSample {
  api_action_id: string;                   // partially redacted
  api_event_date: string | null;
  api_state: string | null;
  api_payout_minor: number | null;
  api_currency: string | null;
  api_shared_id: string | null;
  legacy_source_slug: string;
  legacy_amount_minor: number | null;
  legacy_currency: string | null;
  legacy_occurred_on: string | null;
}

export interface CoverageReport {
  ran_at: string;
  skipped_reason: string | null;
  api_actions_examined: number;
  api_date_floor: string | null;

  // Known mapping used for the verdict.
  shared_id_mapping: Record<string, string>;

  // SharedId distribution across the API sample.
  api_by_shared_id: Record<string, number>;        // raw SharedId → count
  api_by_mapped_slug: Record<string, number>;      // mapped slug → count
  api_shared_id_unknown: number;                   // SharedId present but not in mapping
  api_shared_id_missing: number;                   // SharedId null/empty on the Action

  // Resolved source rows that the ingest will write to.
  legacy_sources: LegacyEpnSource[];
  mapped_source_ids: Record<string, string>;        // slug → UUID

  // Legacy counts (snapshot — the reset migration will re-check at execution time).
  legacy_total_by_slug: Record<string, number>;

  // External_ref overlap (diagnostic only — NOT the verdict).
  external_ref_overlap_by_slug: Record<string, number>;
  external_ref_samples: MatchSample[];

  // Currency semantics evidence (now a note, not the verdict).
  currency_semantics_note: string;

  verdict: 'full_epn_account_coverage' | 'uk_only' | 'uncertain';
  verdict_evidence: string[];
  warnings: string[];
}

interface LegacyRow {
  id: string;
  source_id: string;
  external_ref: string | null;
  occurred_on: string | null;
  amount_minor: number | null;
  currency: string | null;
}

function redact(s: string | null | undefined): string {
  if (!s) return '—';
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export async function runCoverageAudit(
  sb: SupabaseClient,
  rawActions: MinimalAction[],
): Promise<CoverageReport> {
  const ran_at = new Date().toISOString();
  const warnings: string[] = [];

  // ── Earliest API date (just for display context) ─────────────
  let apiDateFloor: string | null = null;
  for (const a of rawActions) {
    if (!a.event_date) continue;
    if (!apiDateFloor || a.event_date < apiDateFloor) apiDateFloor = a.event_date;
  }

  // ── Load EPN sources (for the mapping to UUIDs) ──────────────
  const { data: srcData, error: srcErr } = await sb
    .from('network_revenue_sources')
    .select('id, slug, display_name, default_currency')
    .eq('kind', 'ebay_epn')
    .order('slug');
  if (srcErr) {
    return emptyReport(ran_at, apiDateFloor, rawActions.length, `Could not read EPN sources: ${srcErr.message}`);
  }
  const sources: LegacyEpnSource[] = (srcData ?? []).map((r) => ({
    id: String((r as { id: string }).id),
    slug: String((r as { slug: string }).slug),
    display_name: String((r as { display_name: string }).display_name),
    default_currency: String((r as { default_currency: string }).default_currency),
  }));
  const idBySlug = new Map<string, string>(sources.map((s) => [s.slug, s.id]));
  const slugById = new Map<string, string>(sources.map((s) => [s.id, s.slug]));
  const sourceIds = sources.map((s) => s.id);

  if (sourceIds.length === 0) {
    return emptyReport(ran_at, apiDateFloor, rawActions.length, 'No EPN sources present in network_revenue_sources.');
  }

  // ── Primary signal: SharedId distribution ────────────────────
  const bySharedId: Record<string, number> = {};
  const byMappedSlug: Record<string, number> = {};
  let unknownSharedId = 0;
  let missingSharedId = 0;
  for (const slug of Object.values(SHARED_ID_TO_SLUG)) byMappedSlug[slug] = 0;

  for (const a of rawActions) {
    const sid = a.shared_id;
    if (!sid) { missingSharedId += 1; continue; }
    bySharedId[sid] = (bySharedId[sid] ?? 0) + 1;
    const slug = SHARED_ID_TO_SLUG[sid];
    if (!slug) { unknownSharedId += 1; continue; }
    byMappedSlug[slug] = (byMappedSlug[slug] ?? 0) + 1;
  }

  // Resolve SharedId mapping to UUIDs so the ingest module can rely
  // on this report. Any configured slug missing a row raises a
  // warning but doesn't fail the audit — the ingest module will fail
  // loudly instead.
  const mappedSourceIds: Record<string, string> = {};
  for (const slug of Object.values(SHARED_ID_TO_SLUG)) {
    const id = idBySlug.get(slug);
    if (id) mappedSourceIds[slug] = id;
    else warnings.push(`SharedId mapping expects slug "${slug}" in network_revenue_sources, but no such row exists. The ingest module will refuse to run until this is corrected.`);
  }

  // ── Secondary diagnostic: external_ref overlap ───────────────
  // We expect this to be LOW — the CSV importer used eBay-side
  // Transaction IDs, which are NOT the Impact Action.Id id-space.
  // Overlap is interesting but not required for coverage.
  const legacyRows: LegacyRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const { data, error } = await sb
      .from('network_revenue_events')
      .select('id, source_id, external_ref, occurred_on, amount_minor, currency')
      .in('source_id', sourceIds)
      .order('occurred_on', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) {
      warnings.push(`Legacy page read failed at offset=${offset}: ${error.code ?? 'err'} ${error.message}`);
      break;
    }
    const page = (data ?? []) as LegacyRow[];
    legacyRows.push(...page);
    if (page.length < PAGE) break;
  }

  const legacyTotalBySlug: Record<string, number> = {};
  for (const s of sources) legacyTotalBySlug[s.slug] = 0;
  const byRefPerSource = new Map<string, Map<string, LegacyRow>>();
  for (const r of legacyRows) {
    const slug = slugById.get(r.source_id);
    if (!slug) continue;
    legacyTotalBySlug[slug] = (legacyTotalBySlug[slug] ?? 0) + 1;
    if (!r.external_ref) continue;
    let bucket = byRefPerSource.get(r.external_ref);
    if (!bucket) { bucket = new Map(); byRefPerSource.set(r.external_ref, bucket); }
    bucket.set(slug, r);
  }

  const externalRefOverlapBySlug: Record<string, number> = {};
  for (const s of sources) externalRefOverlapBySlug[s.slug] = 0;
  const externalRefSamples: MatchSample[] = [];
  for (const a of rawActions) {
    if (!a.id) continue;
    const bucket = byRefPerSource.get(a.id);
    if (!bucket) continue;
    for (const [slug, legacy] of bucket.entries()) {
      externalRefOverlapBySlug[slug] = (externalRefOverlapBySlug[slug] ?? 0) + 1;
      if (externalRefSamples.length < 10) {
        externalRefSamples.push({
          api_action_id: redact(a.id),
          api_event_date: a.event_date,
          api_state: a.state,
          api_payout_minor: a.payout_minor,
          api_currency: a.currency,
          api_shared_id: a.shared_id,
          legacy_source_slug: slug,
          legacy_amount_minor: legacy.amount_minor,
          legacy_currency: legacy.currency,
          legacy_occurred_on: legacy.occurred_on,
        });
      }
    }
  }

  // ── Verdict ──────────────────────────────────────────────────
  const evidence: string[] = [];
  const sidKeys = Object.keys(bySharedId).sort();
  for (const sid of sidKeys) {
    const slug = SHARED_ID_TO_SLUG[sid] ?? '(unknown)';
    evidence.push(`SharedId ${sid} → ${slug}: ${bySharedId[sid]} Action(s).`);
  }
  if (unknownSharedId > 0) evidence.push(`SharedId values NOT in the known mapping: ${unknownSharedId}.`);
  if (missingSharedId > 0) evidence.push(`Actions with no SharedId: ${missingSharedId}.`);

  const total = rawActions.length;
  const sumMapped = Object.values(byMappedSlug).reduce((a, b) => a + b, 0);
  const ukCount = byMappedSlug['ebay_epn_uk'] ?? 0;
  const usCount = byMappedSlug['ebay_epn_us'] ?? 0;

  let verdict: CoverageReport['verdict'] = 'uncertain';
  if (total === 0) {
    verdict = 'uncertain';
    evidence.push('No API Actions in the sample.');
  } else if (unknownSharedId === 0 && missingSharedId === 0 && sumMapped === total && ukCount > 0 && usCount > 0) {
    verdict = 'full_epn_account_coverage';
    evidence.push(`Every one of the ${total} Actions is attributable to a known EPN campaign (UK ${ukCount} + US ${usCount}). The API account covers both legacy populations.`);
  } else if (ukCount > 0 && usCount === 0) {
    verdict = 'uk_only';
    evidence.push('No API Action maps to the US EPN campaign (SharedId 5339152106). Deleting ebay_epn_us would lose data the API cannot restore.');
  } else {
    verdict = 'uncertain';
    evidence.push('SharedId coverage does not cleanly map 100% to the known campaigns. Investigate before resetting.');
  }

  const currencyNote =
    'Action.Currency is the account payout/settlement currency (currently GBP). It is NOT the originating transaction currency. Campaign origin comes from SharedId; do not infer UK/US from Currency.';

  return {
    ran_at,
    skipped_reason: null,
    api_actions_examined: total,
    api_date_floor: apiDateFloor,
    shared_id_mapping: { ...SHARED_ID_TO_SLUG },
    api_by_shared_id: bySharedId,
    api_by_mapped_slug: byMappedSlug,
    api_shared_id_unknown: unknownSharedId,
    api_shared_id_missing: missingSharedId,
    legacy_sources: sources,
    mapped_source_ids: mappedSourceIds,
    legacy_total_by_slug: legacyTotalBySlug,
    external_ref_overlap_by_slug: externalRefOverlapBySlug,
    external_ref_samples: externalRefSamples,
    currency_semantics_note: currencyNote,
    verdict,
    verdict_evidence: evidence,
    warnings,
  };
}

function emptyReport(
  ran_at: string,
  apiDateFloor: string | null,
  apiExamined: number,
  reason: string,
): CoverageReport {
  return {
    ran_at,
    skipped_reason: reason,
    api_actions_examined: apiExamined,
    api_date_floor: apiDateFloor,
    shared_id_mapping: { ...SHARED_ID_TO_SLUG },
    api_by_shared_id: {},
    api_by_mapped_slug: {},
    api_shared_id_unknown: 0,
    api_shared_id_missing: 0,
    legacy_sources: [],
    mapped_source_ids: {},
    legacy_total_by_slug: {},
    external_ref_overlap_by_slug: {},
    external_ref_samples: [],
    currency_semantics_note: '',
    verdict: 'uncertain',
    verdict_evidence: [reason],
    warnings: [reason],
  };
}

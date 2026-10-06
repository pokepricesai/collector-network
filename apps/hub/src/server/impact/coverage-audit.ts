import 'server-only';

// UK + US EPN coverage audit.
//
// Does the Impact API dataset encompass the economic activity that
// was historically imported under BOTH legacy sources (ebay_epn_uk +
// ebay_epn_us), or just one? This is the gating question before
// deleting both legacy populations.
//
// Method: match every live API Action against the legacy ledger by
// external_ref = Impact Action.Id. The EPN CSV importer stores the
// bare EPN Transaction ID in network_revenue_events.external_ref
// (verified in server/revenue/epn-import-actions.ts) and the Impact
// API returns the same identifier as Action.Id. Only transactions on
// or after the API's earliest EventDate can be matched — anything
// older predates the API history exposure. We report both:
//
//   * API-side coverage — of X Actions, how many map to legacy UK vs
//     legacy US? If zero map to legacy US, the API account probably
//     doesn't contain US activity at all.
//
//   * Legacy-side coverage — of the N legacy UK events in-range, how
//     many are visible in the API? Likewise for US.
//
// Currency-semantics evidence:
//
//   * If matched UK rows have api.payout_minor == legacy.amount_minor
//     (same ccy, same minor units), API is quoting GBP natively.
//   * If matched US rows have api.payout_minor != legacy.amount_minor
//     but roughly equal to legacy.amount_minor × FX, Impact is
//     normalising payouts into the account settlement currency (GBP).
//   * If no US rows match at all, we can't disambiguate — the US side
//     may simply not exist in this Impact account.
//
// All queries are READ-ONLY.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MinimalAction } from './dry-run';

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
  legacy_source_slug: string;
  legacy_amount_minor: number | null;
  legacy_currency: string | null;
  legacy_occurred_on: string | null;
  implied_fx: number | null;               // api_payout / legacy_amount, when both > 0
}

export interface CurrencyEvidence {
  slug: string;
  currency: string;
  matched: number;
  exact_minor_match: number;               // api_payout_minor === legacy_amount_minor
  diff_minor_match: number;                // |api - legacy| > tolerance
  mean_implied_fx: number | null;          // avg(api_payout / legacy_amount) across diffs
}

export interface CoverageReport {
  ran_at: string;
  skipped_reason: string | null;
  api_actions_examined: number;
  api_date_floor: string | null;           // earliest date in the API sample
  legacy_sources: LegacyEpnSource[];
  // Per-source counts (ONLY counting legacy rows in-range of API history)
  legacy_in_range_by_slug: Record<string, number>;
  legacy_total_by_slug: Record<string, number>;
  // Match counts
  api_matched_to_slug: Record<string, number>;        // slug → N API Actions matched there
  api_matched_to_multiple: number;                     // collision — same external_ref under multiple sources
  api_unmatched: number;
  // Legacy-side match coverage
  legacy_matched_by_slug: Record<string, number>;      // slug → N legacy events found in API
  legacy_unmatched_in_range_by_slug: Record<string, number>; // in-range legacy events NOT in API
  // Currency semantics evidence
  currency_evidence_by_slug: CurrencyEvidence[];
  // Representative samples (partially redacted)
  samples_matched_uk: MatchSample[];
  samples_matched_us: MatchSample[];
  samples_api_unmatched: MatchSample[];
  // Verdict
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
  ledger_status: string | null;
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

  // Earliest date in the API sample — legacy rows before this are not
  // expected to be in the API and shouldn't count as "unmatched".
  let apiDateFloor: string | null = null;
  for (const a of rawActions) {
    if (!a.event_date) continue;
    if (!apiDateFloor || a.event_date < apiDateFloor) apiDateFloor = a.event_date;
  }

  // Load EPN sources.
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
  const slugById = new Map<string, string>(sources.map((s) => [s.id, s.slug]));
  const sourceIds = sources.map((s) => s.id);

  if (sourceIds.length === 0) {
    return emptyReport(ran_at, apiDateFloor, rawActions.length, 'No EPN sources present in network_revenue_sources.');
  }

  // Load legacy events — bounded, paged.
  const legacyRows: LegacyRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const { data, error } = await sb
      .from('network_revenue_events')
      .select('id, source_id, external_ref, occurred_on, amount_minor, currency, ledger_status')
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

  // Build totals (all time + in-range).
  const legacyTotalBySlug: Record<string, number> = {};
  const legacyInRangeBySlug: Record<string, number> = {};
  for (const s of sources) {
    legacyTotalBySlug[s.slug] = 0;
    legacyInRangeBySlug[s.slug] = 0;
  }
  for (const r of legacyRows) {
    const slug = slugById.get(r.source_id);
    if (!slug) continue;
    legacyTotalBySlug[slug] = (legacyTotalBySlug[slug] ?? 0) + 1;
    if (apiDateFloor && r.occurred_on && r.occurred_on >= apiDateFloor) {
      legacyInRangeBySlug[slug] = (legacyInRangeBySlug[slug] ?? 0) + 1;
    }
  }

  // Build an index of legacy rows by external_ref, keyed per source,
  // so a cross-source collision on the same transaction ID is visible.
  const byRefPerSource = new Map<string, Map<string, LegacyRow>>();
  for (const r of legacyRows) {
    if (!r.external_ref) continue;
    const slug = slugById.get(r.source_id);
    if (!slug) continue;
    let bucket = byRefPerSource.get(r.external_ref);
    if (!bucket) { bucket = new Map(); byRefPerSource.set(r.external_ref, bucket); }
    bucket.set(slug, r);
  }

  // Match API Actions to legacy. An API Action matches a slug iff
  // its Id appears as external_ref under that slug.
  const matchedApiBySlug: Record<string, number> = {};
  for (const s of sources) matchedApiBySlug[s.slug] = 0;
  let apiMatchedMultiple = 0;
  let apiUnmatched = 0;

  const matchedApiRefsBySlug = new Map<string, Set<string>>();
  for (const s of sources) matchedApiRefsBySlug.set(s.slug, new Set());

  const samplesMatchedUk: MatchSample[] = [];
  const samplesMatchedUs: MatchSample[] = [];
  const samplesUnmatched: MatchSample[] = [];

  const currencyEvidenceAccum = new Map<string, { ccy: string; matched: number; exact: number; diff: number; fxSum: number; fxN: number }>();

  for (const a of rawActions) {
    if (!a.id) { apiUnmatched += 1; continue; }
    const bucket = byRefPerSource.get(a.id);
    if (!bucket || bucket.size === 0) {
      apiUnmatched += 1;
      if (samplesUnmatched.length < 5) {
        samplesUnmatched.push({
          api_action_id: redact(a.id),
          api_event_date: a.event_date,
          api_state: a.state,
          api_payout_minor: a.payout_minor,
          api_currency: a.currency,
          legacy_source_slug: '—',
          legacy_amount_minor: null,
          legacy_currency: null,
          legacy_occurred_on: null,
          implied_fx: null,
        });
      }
      continue;
    }
    if (bucket.size > 1) apiMatchedMultiple += 1;
    for (const [slug, legacy] of bucket.entries()) {
      matchedApiBySlug[slug] = (matchedApiBySlug[slug] ?? 0) + 1;
      matchedApiRefsBySlug.get(slug)?.add(a.id);

      // Currency evidence
      const key = `${slug}::${legacy.currency ?? '(none)'}`;
      const acc = currencyEvidenceAccum.get(key) ?? { ccy: legacy.currency ?? '(none)', matched: 0, exact: 0, diff: 0, fxSum: 0, fxN: 0 };
      acc.matched += 1;
      if (a.payout_minor != null && legacy.amount_minor != null) {
        if (a.payout_minor === legacy.amount_minor) acc.exact += 1;
        else {
          acc.diff += 1;
          if (legacy.amount_minor !== 0) {
            acc.fxSum += a.payout_minor / legacy.amount_minor;
            acc.fxN += 1;
          }
        }
      }
      currencyEvidenceAccum.set(key, acc);

      const sample: MatchSample = {
        api_action_id: redact(a.id),
        api_event_date: a.event_date,
        api_state: a.state,
        api_payout_minor: a.payout_minor,
        api_currency: a.currency,
        legacy_source_slug: slug,
        legacy_amount_minor: legacy.amount_minor,
        legacy_currency: legacy.currency,
        legacy_occurred_on: legacy.occurred_on,
        implied_fx:
          a.payout_minor != null && legacy.amount_minor && legacy.amount_minor > 0
            ? a.payout_minor / legacy.amount_minor
            : null,
      };
      if (slug.endsWith('_uk') && samplesMatchedUk.length < 5) samplesMatchedUk.push(sample);
      if (slug.endsWith('_us') && samplesMatchedUs.length < 5) samplesMatchedUs.push(sample);
    }
  }

  // Legacy-side coverage: how many in-range legacy events did we see?
  const legacyMatchedBySlug: Record<string, number> = {};
  for (const s of sources) legacyMatchedBySlug[s.slug] = matchedApiRefsBySlug.get(s.slug)?.size ?? 0;
  const legacyUnmatchedBySlug: Record<string, number> = {};
  for (const s of sources) {
    const inRange = legacyInRangeBySlug[s.slug] ?? 0;
    const matched = legacyMatchedBySlug[s.slug] ?? 0;
    legacyUnmatchedBySlug[s.slug] = Math.max(0, inRange - matched);
  }

  // Currency evidence rollup
  const currencyEvidenceBySlug: CurrencyEvidence[] = Array.from(currencyEvidenceAccum.entries()).map(([key, v]) => {
    const slug = key.split('::')[0] ?? '';
    return {
      slug,
      currency: v.ccy,
      matched: v.matched,
      exact_minor_match: v.exact,
      diff_minor_match: v.diff,
      mean_implied_fx: v.fxN > 0 ? v.fxSum / v.fxN : null,
    };
  }).sort((a, b) => a.slug.localeCompare(b.slug));

  // ── Verdict ──────────────────────────────────────────────────
  const evidence: string[] = [];
  const ukMatched = Object.entries(matchedApiBySlug).filter(([slug]) => slug.endsWith('_uk')).reduce((a, [, n]) => a + n, 0);
  const usMatched = Object.entries(matchedApiBySlug).filter(([slug]) => slug.endsWith('_us')).reduce((a, [, n]) => a + n, 0);
  const ukLegacyInRange = Object.entries(legacyInRangeBySlug).filter(([slug]) => slug.endsWith('_uk')).reduce((a, [, n]) => a + n, 0);
  const usLegacyInRange = Object.entries(legacyInRangeBySlug).filter(([slug]) => slug.endsWith('_us')).reduce((a, [, n]) => a + n, 0);

  evidence.push(`UK legacy events in API date range (≥ ${apiDateFloor ?? '?'}): ${ukLegacyInRange}, of which the API matched ${legacyMatchedBySlug['ebay_epn_uk'] ?? 0}.`);
  evidence.push(`US legacy events in API date range (≥ ${apiDateFloor ?? '?'}): ${usLegacyInRange}, of which the API matched ${legacyMatchedBySlug['ebay_epn_us'] ?? 0}.`);
  evidence.push(`API Actions mapped to UK: ${ukMatched}; mapped to US: ${usMatched}; mapped to neither: ${apiUnmatched}; collisions (both sources): ${apiMatchedMultiple}.`);

  let verdict: CoverageReport['verdict'] = 'uncertain';
  if (usMatched === 0 && ukMatched > 0) {
    verdict = 'uk_only';
    evidence.push('No API Action matched a legacy US transaction. The Impact account exposes UK activity only. Deleting ebay_epn_us would lose data the API cannot restore.');
  } else if (usMatched > 0 && ukMatched > 0) {
    verdict = 'full_epn_account_coverage';
    evidence.push('API matches to BOTH legacy UK and US populations. The Impact account covers the full EPN footprint.');
  } else if (ukMatched === 0 && usMatched === 0) {
    verdict = 'uncertain';
    evidence.push('No API Action matched any legacy EPN row. Either the API account is unrelated to the legacy CSV population, or the external_ref encoding differs. Investigate before deleting.');
  }

  // Also surface the mean implied FX on US matches: if it's close to a
  // known GBP/USD ratio (~0.75 ± 0.05), that's strong evidence of
  // settlement-currency normalisation.
  const usEvidence = currencyEvidenceBySlug.find((e) => e.slug.endsWith('_us'));
  if (usEvidence && usEvidence.mean_implied_fx != null) {
    const fx = usEvidence.mean_implied_fx;
    const inGbpRange = fx > 0.6 && fx < 0.9;
    evidence.push(`Mean implied FX across matched US rows: ${fx.toFixed(4)} (api_payout / legacy_amount). ${inGbpRange ? 'Consistent with GBP settlement-currency normalisation.' : 'Not consistent with a plausible GBP/USD rate — treat with care.'}`);
  }

  return {
    ran_at,
    skipped_reason: null,
    api_actions_examined: rawActions.length,
    api_date_floor: apiDateFloor,
    legacy_sources: sources,
    legacy_in_range_by_slug: legacyInRangeBySlug,
    legacy_total_by_slug: legacyTotalBySlug,
    api_matched_to_slug: matchedApiBySlug,
    api_matched_to_multiple: apiMatchedMultiple,
    api_unmatched: apiUnmatched,
    legacy_matched_by_slug: legacyMatchedBySlug,
    legacy_unmatched_in_range_by_slug: legacyUnmatchedBySlug,
    currency_evidence_by_slug: currencyEvidenceBySlug,
    samples_matched_uk: samplesMatchedUk,
    samples_matched_us: samplesMatchedUs,
    samples_api_unmatched: samplesUnmatched,
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
    legacy_sources: [],
    legacy_in_range_by_slug: {},
    legacy_total_by_slug: {},
    api_matched_to_slug: {},
    api_matched_to_multiple: 0,
    api_unmatched: apiExamined,
    legacy_matched_by_slug: {},
    legacy_unmatched_in_range_by_slug: {},
    currency_evidence_by_slug: [],
    samples_matched_uk: [],
    samples_matched_us: [],
    samples_api_unmatched: [],
    verdict: 'uncertain',
    verdict_evidence: [reason],
    warnings: [reason],
  };
}

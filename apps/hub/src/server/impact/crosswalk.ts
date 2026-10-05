import 'server-only';

// API ↔ CSV crosswalk. Fetches a sample of live Impact Actions and
// tries to match each against existing CSV-imported EPN rows in
// `network_revenue_events`. The point of this diagnostic is to
// discover the CANONICAL identity key — Action.Id, Oid, OrderId, or
// a composite — so the eventual API ingest does NOT duplicate
// transactions already in the ledger.
//
// Zero writes. Zero mutation. The function only reads.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createImpactClient } from './client';

export interface SampleAction {
  action_id: string | null;
  oid: string | null;
  order_id: string | null;
  action_date: string | null;        // YYYY-MM-DD (date portion of EventDate)
  action_datetime_raw: string | null;
  state: string | null;
  payout_minor: number | null;
  amount_minor: number | null;
  currency: string | null;
  campaign_id: string | null;
  sub_id_1: string | null;
}

export interface MatchResult {
  action: SampleAction;
  match_by: 'external_ref=Id' | 'external_ref=Oid' | 'external_ref=OrderId' | 'date+amount+currency' | null;
  matched_event_id: string | null;
  matched_external_ref: string | null;
  matched_ledger_status: string | null;
  matched_amount_minor: number | null;
  matched_currency: string | null;
  matched_source_slug: string | null;
  ambiguous: boolean;                   // >1 candidate for date+amount match
}

export interface ReversalSemantics {
  states_sampled: Record<string, number>;
  reversed_payout_signs: {
    positive: number;
    zero: number;
    negative: number;
  };
  verdict:
    | 'no_reversed_in_sample'
    | 'reversed_payouts_all_positive'  // Payout stays positive, status flips
    | 'reversed_payouts_all_negative'  // Payout is already negated
    | 'reversed_payouts_all_zero'      // Payout zeroed out
    | 'reversed_payouts_mixed';
  evidence: string;
}

export interface CrosswalkReport {
  ran_at: string;
  skipped_reason: string | null;
  actions_examined: number;                 // what we actually matched against
  actions_total_in_window: number | null;   // from Impact's @total envelope field, when present
  actions_pages_fetched: number;
  actions_page_size: number;
  safety_cap: number;
  safety_cap_hit: boolean;
  actions_window_days: number;
  csv_rows_in_same_window: number;
  match_counts: {
    by_external_ref_eq_id: number;
    by_external_ref_eq_oid: number;
    by_external_ref_eq_order_id: number;
    by_date_amount_currency: number;
    unmatched: number;
    ambiguous_date_amount: number;    // multiple CSV rows share (date, amount, currency)
  };
  overall_match_rate: number;              // (sum of matches) / actions_examined, 0..1
  canonical_identity:
    | 'external_ref=Id'
    | 'external_ref=Oid'
    | 'external_ref=OrderId'
    | 'date+amount+currency_fragile'
    | 'ambiguous'
    | 'no_overlap'
    | 'insufficient_sample';
  canonical_evidence: string;
  duplication_risk:
    | 'low'       // ≥90% unambiguous match on one deterministic key
    | 'medium'    // >50% match but requires composite
    | 'high'      // no reliable match — API backfill would create duplicates
    | 'unknown';
  csv_vs_api_verdict:
    | 'yes'
    | 'partial'
    | 'no'
    | 'unknown';
  csv_vs_api_reasons: string[];
  reversal_semantics: ReversalSemantics;
  example_matches: MatchResult[];        // first 10, with partial redaction
  warnings: string[];
}

function dateOnly(iso: string | null): string | null {
  if (!iso) return null;
  // Accept ISO-8601 with or without time.
  return iso.slice(0, 10);
}

function toMinor(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const minor = Math.round(n * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function redactTxId(id: string | null): string | null {
  if (!id) return null;
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function pickRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of ['Actions', 'Records', 'Items']) {
      const v = d[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function extractAction(raw: Record<string, unknown>): SampleAction {
  const payoutMinor = toMinor(raw['Payout']);
  const amountMinor = toMinor(raw['Amount']);
  // Impact ships EventDate as ISO-8601; ActionDate occasionally
  // overlaps. Prefer EventDate.
  const dt = (raw['EventDate'] ?? raw['ActionDate']) as string | null;
  return {
    action_id: raw['Id'] != null ? String(raw['Id']) : null,
    oid: raw['Oid'] != null ? String(raw['Oid']) : null,
    order_id: raw['OrderId'] != null ? String(raw['OrderId']) : null,
    action_date: dateOnly(dt),
    action_datetime_raw: dt,
    state: raw['State'] != null ? String(raw['State']) : null,
    payout_minor: payoutMinor,
    amount_minor: amountMinor,
    currency: raw['Currency'] != null ? String(raw['Currency']) : null,
    campaign_id: raw['CampaignId'] != null ? String(raw['CampaignId']) : null,
    sub_id_1: raw['SubId1'] != null ? String(raw['SubId1']) : null,
  };
}

interface ExistingEpnRow {
  id: string;
  external_ref: string | null;
  occurred_on: string | null;
  amount_minor: number | null;
  currency: string | null;
  ledger_status: string | null;
  source_slug: string | null;
}

// Pagination of /Actions:
//
// Impact returns a JSON envelope on every list endpoint with
// metadata fields `@page`, `@pagesize`, `@total`, `@numpages`, and
// `@nextpageuri`. Absence (or empty) of `@nextpageuri` is the
// authoritative signal that there are no more pages. We follow that
// signal, fall back to a records-count stop condition if the envelope
// doesn't include it, and cap the total examined Actions at
// SAFETY_CAP so an unexpected response can never produce an unbounded
// loop.
const PAGE_SIZE = 500;
const SAFETY_CAP = 5000;
const MAX_PAGES_HARD = Math.ceil(SAFETY_CAP / PAGE_SIZE) + 2;  // belt-and-suspenders

function parseTotal(envelope: Record<string, unknown>): number | null {
  for (const k of ['@total', 'Total', 'TotalResults', '@numrecords']) {
    const v = envelope[k];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasNextPage(envelope: Record<string, unknown>): boolean | null {
  // Returns true/false if the envelope tells us, else null (unknown).
  for (const k of ['@nextpageuri', 'NextPageUri', '@nextpage']) {
    if (k in envelope) {
      const v = envelope[k];
      return !(v == null || v === '');
    }
  }
  return null;
}

export async function runCrosswalk(sb: SupabaseClient): Promise<CrosswalkReport> {
  const ran_at = new Date().toISOString();
  const warnings: string[] = [];
  const WINDOW_DAYS = 30;

  // ── Live Actions sample ─────────────────────────────────────
  let client: ReturnType<typeof createImpactClient>;
  try {
    client = createImpactClient();
  } catch (err) {
    return emptyReport(ran_at, 'Impact credentials missing in env — crosswalk did not run.');
  }

  const now = new Date();
  const start = new Date(now.getTime() - WINDOW_DAYS * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 19) + 'Z';
  const date = (d: Date) => d.toISOString().slice(0, 10);

  const actionsRaw: Array<Record<string, unknown>> = [];
  let totalInWindow: number | null = null;
  let pagesFetched = 0;
  let safetyCapHit = false;

  for (let page = 1; page <= MAX_PAGES_HARD; page++) {
    const resp = await client.get('/Actions', {
      PageSize: String(PAGE_SIZE),
      Page: String(page),
      ActionDateStart: iso(start),
      ActionDateEnd: iso(now),
    });
    if (!resp.ok) {
      if (page === 1) {
        warnings.push(`/Actions returned ${resp.status}: ${resp.errorMessage ?? 'error'}. Crosswalk cannot run without a live sample.`);
        return emptyReport(ran_at, `Live /Actions call failed (${resp.status}).`);
      }
      warnings.push(`/Actions page ${page} returned ${resp.status}: ${resp.errorMessage ?? 'error'}. Stopping pagination at ${actionsRaw.length} rows.`);
      break;
    }
    pagesFetched += 1;

    const envelope =
      resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)
        ? (resp.data as Record<string, unknown>)
        : {};
    if (page === 1) totalInWindow = parseTotal(envelope);

    const pageRecords = pickRecords(resp.data) as Array<Record<string, unknown>>;
    if (pageRecords.length === 0) break;

    for (const r of pageRecords) {
      if (actionsRaw.length >= SAFETY_CAP) {
        safetyCapHit = true;
        break;
      }
      actionsRaw.push(r);
    }
    if (safetyCapHit) break;

    // Prefer Impact's own stop signal; fall back to count-based.
    const next = hasNextPage(envelope);
    if (next === false) break;
    if (next === null && pageRecords.length < PAGE_SIZE) break;
    if (totalInWindow != null && actionsRaw.length >= totalInWindow) break;
  }

  if (safetyCapHit) {
    warnings.push(`Hit the ${SAFETY_CAP.toLocaleString()}-Action safety cap. Pagination stopped early; verdict reflects only the first ${SAFETY_CAP.toLocaleString()} Actions in the window.`);
  }

  const actions = actionsRaw.map(extractAction);

  // ── Existing EPN rows in overlapping window ────────────────
  // Pull EPN sources explicitly so we don't accidentally match
  // against sponsorship or display_ads rows.
  const { data: sources } = await sb
    .from('network_revenue_sources')
    .select('id, slug, kind')
    .eq('kind', 'ebay_epn');
  const epnSources = (sources ?? []) as Array<{ id: string; slug: string; kind: string }>;
  const epnSourceIds = epnSources.map((s) => s.id);
  const slugById = new Map<string, string>(epnSources.map((s) => [s.id, s.slug]));

  const csvRows: ExistingEpnRow[] = [];
  if (epnSourceIds.length > 0) {
    const since = date(start);
    const PAGE = 1000;
    for (let offset = 0; offset < 20_000; offset += PAGE) {
      const { data, error } = await sb
        .from('network_revenue_events')
        .select('id, external_ref, occurred_on, amount_minor, currency, ledger_status, source_id')
        .in('source_id', epnSourceIds)
        .gte('occurred_on', since)
        .order('occurred_on', { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) {
        warnings.push(`Error reading EPN ledger: ${error.message}`);
        break;
      }
      const page = (data ?? []) as Array<{
        id: string; external_ref: string | null; occurred_on: string | null;
        amount_minor: number | null; currency: string | null;
        ledger_status: string | null; source_id: string;
      }>;
      for (const r of page) {
        csvRows.push({
          id: r.id,
          external_ref: r.external_ref,
          occurred_on: r.occurred_on,
          amount_minor: r.amount_minor,
          currency: r.currency,
          ledger_status: r.ledger_status,
          source_slug: slugById.get(r.source_id) ?? null,
        });
      }
      if (page.length < PAGE) break;
    }
  } else {
    warnings.push('No EPN sources present in network_revenue_sources. Nothing to compare against.');
  }

  // ── Build match indices on the CSV side ─────────────────────
  const byExternalRef = new Map<string, ExistingEpnRow>();
  for (const r of csvRows) {
    if (r.external_ref) {
      // Multiple sources may collide on external_ref; prefer the
      // first one seen (most recent via order desc).
      if (!byExternalRef.has(r.external_ref)) byExternalRef.set(r.external_ref, r);
    }
  }
  const byDateAmount = new Map<string, ExistingEpnRow[]>();
  for (const r of csvRows) {
    if (!r.occurred_on || r.amount_minor == null || !r.currency) continue;
    const key = `${r.occurred_on}:${r.amount_minor}:${r.currency}`;
    const arr = byDateAmount.get(key) ?? [];
    arr.push(r);
    byDateAmount.set(key, arr);
  }

  // ── Match every live Action against the CSV side ────────────
  const matches: MatchResult[] = [];
  const counts = {
    by_external_ref_eq_id: 0,
    by_external_ref_eq_oid: 0,
    by_external_ref_eq_order_id: 0,
    by_date_amount_currency: 0,
    unmatched: 0,
    ambiguous_date_amount: 0,
  };

  for (const a of actions) {
    const result: MatchResult = {
      action: a,
      match_by: null,
      matched_event_id: null,
      matched_external_ref: null,
      matched_ledger_status: null,
      matched_amount_minor: null,
      matched_currency: null,
      matched_source_slug: null,
      ambiguous: false,
    };
    // Try keys in priority order. Impact Action.Id is the strongest
    // candidate; fall through to Oid, then OrderId, then composite.
    let hit: ExistingEpnRow | undefined;
    if (a.action_id && (hit = byExternalRef.get(a.action_id))) {
      result.match_by = 'external_ref=Id';
      counts.by_external_ref_eq_id += 1;
    } else if (a.oid && (hit = byExternalRef.get(a.oid))) {
      result.match_by = 'external_ref=Oid';
      counts.by_external_ref_eq_oid += 1;
    } else if (a.order_id && (hit = byExternalRef.get(a.order_id))) {
      result.match_by = 'external_ref=OrderId';
      counts.by_external_ref_eq_order_id += 1;
    } else if (a.action_date && a.payout_minor != null && a.currency) {
      const key = `${a.action_date}:${a.payout_minor}:${a.currency}`;
      const candidates = byDateAmount.get(key) ?? [];
      if (candidates.length === 1) {
        hit = candidates[0];
        result.match_by = 'date+amount+currency';
        counts.by_date_amount_currency += 1;
      } else if (candidates.length > 1) {
        result.ambiguous = true;
        counts.ambiguous_date_amount += 1;
      }
    }
    if (hit) {
      result.matched_event_id = hit.id;
      result.matched_external_ref = hit.external_ref;
      result.matched_ledger_status = hit.ledger_status;
      result.matched_amount_minor = hit.amount_minor;
      result.matched_currency = hit.currency;
      result.matched_source_slug = hit.source_slug;
    } else if (result.match_by === null && !result.ambiguous) {
      counts.unmatched += 1;
    }
    matches.push(result);
  }

  // ── Reversal + payout semantics ─────────────────────────────
  const statesSampled = new Map<string, number>();
  let revPos = 0, revZero = 0, revNeg = 0;
  for (const a of actions) {
    const s = a.state ?? '(none)';
    statesSampled.set(s, (statesSampled.get(s) ?? 0) + 1);
    if (s.toUpperCase().startsWith('REVERS')) {
      const p = a.payout_minor;
      if (p == null) continue;
      if (p > 0) revPos += 1;
      else if (p < 0) revNeg += 1;
      else revZero += 1;
    }
  }
  let revVerdict: ReversalSemantics['verdict'] = 'no_reversed_in_sample';
  let revEvidence = 'No REVERSED actions observed in the sampled window.';
  const revTotal = revPos + revZero + revNeg;
  if (revTotal > 0) {
    if (revPos === revTotal) {
      revVerdict = 'reversed_payouts_all_positive';
      revEvidence = `All ${revTotal} sampled REVERSED actions carry a positive Payout. Ledger rule: amount_minor = -abs(Payout) when state=REVERSED (we negate on import).`;
    } else if (revNeg === revTotal) {
      revVerdict = 'reversed_payouts_all_negative';
      revEvidence = `All ${revTotal} sampled REVERSED actions carry a negative Payout. Ledger rule: amount_minor = Payout directly (do NOT re-negate — would double-invert).`;
    } else if (revZero === revTotal) {
      revVerdict = 'reversed_payouts_all_zero';
      revEvidence = `All ${revTotal} sampled REVERSED actions have Payout = 0. Ledger rule: amount_minor = 0, event_kind='reversal'. The prior approved amount lives in ActionUpdates OldPayout.`;
    } else {
      revVerdict = 'reversed_payouts_mixed';
      revEvidence = `Sampled REVERSED actions have inconsistent payout signs (${revPos} positive / ${revZero} zero / ${revNeg} negative). DO NOT backfill until this is explained — likely needs ActionUpdates OldPayout to recover the economic truth.`;
    }
  }

  // ── Canonical identity decision ─────────────────────────────
  const sample = actions.length;
  let canonical: CrosswalkReport['canonical_identity'] = 'insufficient_sample';
  let canonicalEvidence = '';
  if (sample === 0) {
    canonical = 'insufficient_sample';
    canonicalEvidence = 'No live Actions returned in the 30-day window.';
  } else if (csvRows.length === 0) {
    canonical = 'no_overlap';
    canonicalEvidence = 'No CSV-imported EPN rows exist in the same 30-day window — cannot verify API/CSV identity empirically.';
  } else {
    const idRate = counts.by_external_ref_eq_id / sample;
    const oidRate = counts.by_external_ref_eq_oid / sample;
    const orderRate = counts.by_external_ref_eq_order_id / sample;
    const compositeRate = counts.by_date_amount_currency / sample;
    if (idRate >= 0.8) {
      canonical = 'external_ref=Id';
      canonicalEvidence = `${(idRate * 100).toFixed(0)}% of sampled live Actions match CSV rows on external_ref = Action.Id. Reuse the EPN source + Action.Id-based idempotency.`;
    } else if (oidRate >= 0.8) {
      canonical = 'external_ref=Oid';
      canonicalEvidence = `${(oidRate * 100).toFixed(0)}% match on external_ref = Oid. CSV "Transaction ID" column was the eBay checkout id, not the EPN action id. Idempotency should use Oid.`;
    } else if (orderRate >= 0.8) {
      canonical = 'external_ref=OrderId';
      canonicalEvidence = `${(orderRate * 100).toFixed(0)}% match on external_ref = OrderId.`;
    } else if (idRate + oidRate + orderRate >= 0.8) {
      canonical = 'ambiguous';
      canonicalEvidence = `Matches split across Id/Oid/OrderId (${(idRate * 100).toFixed(0)}% / ${(oidRate * 100).toFixed(0)}% / ${(orderRate * 100).toFixed(0)}%). CSV may contain mixed historical identity schemes. Resolve manually before backfill.`;
    } else if (compositeRate >= 0.8 && counts.ambiguous_date_amount === 0) {
      canonical = 'date+amount+currency_fragile';
      canonicalEvidence = `${(compositeRate * 100).toFixed(0)}% match on (date + amount + currency) with no ambiguous collisions. This works but is fragile; prefer a deterministic key before trusting it long-term.`;
    } else if (compositeRate < 0.3 && idRate < 0.3 && oidRate < 0.3) {
      canonical = 'no_overlap';
      canonicalEvidence = `Low match rate on all keys. Either the CSV and API cover different populations or the CSV external_ref encoding is unknown.`;
    } else {
      canonical = 'ambiguous';
      canonicalEvidence = `No single key hits 80%. Breakdown: Id=${(idRate*100).toFixed(0)}%, Oid=${(oidRate*100).toFixed(0)}%, OrderId=${(orderRate*100).toFixed(0)}%, composite=${(compositeRate*100).toFixed(0)}%, ambiguous_composite=${counts.ambiguous_date_amount}.`;
    }
  }

  // ── Duplication risk ────────────────────────────────────────
  let duplication_risk: CrosswalkReport['duplication_risk'] = 'unknown';
  if (canonical === 'external_ref=Id' || canonical === 'external_ref=Oid' || canonical === 'external_ref=OrderId') {
    duplication_risk = 'low';
  } else if (canonical === 'date+amount+currency_fragile') {
    duplication_risk = 'medium';
  } else if (canonical === 'ambiguous' || canonical === 'no_overlap') {
    duplication_risk = 'high';
  } else {
    duplication_risk = 'unknown';
  }

  // ── Final verdict ───────────────────────────────────────────
  const reasons: string[] = [];
  let verdict: CrosswalkReport['csv_vs_api_verdict'] = 'unknown';
  if (duplication_risk === 'low' && revVerdict !== 'reversed_payouts_mixed') {
    verdict = 'yes';
    reasons.push(canonicalEvidence);
    reasons.push(revEvidence);
    reasons.push('API becomes the preferred upstream; CSV importer remains a fallback. Backfill reconciles into existing rows using the canonical key.');
  } else if (duplication_risk === 'medium') {
    verdict = 'partial';
    reasons.push(canonicalEvidence);
    reasons.push(revEvidence);
    reasons.push('A deterministic identity is not available. API can supplement CSV but should not replace it as the primary feed until outbound links or CSV identity are reconciled.');
  } else if (duplication_risk === 'high') {
    verdict = 'no';
    reasons.push(canonicalEvidence);
    reasons.push(revEvidence);
    reasons.push('Backfilling against the live API would create duplicate transactions. Do NOT ingest until the canonical key is proven.');
  } else {
    verdict = 'unknown';
    reasons.push(canonicalEvidence);
  }

  const example_matches: MatchResult[] = matches.slice(0, 10).map((m) => ({
    ...m,
    action: {
      ...m.action,
      action_id: redactTxId(m.action.action_id),
      oid: redactTxId(m.action.oid),
      order_id: redactTxId(m.action.order_id),
    },
    matched_external_ref: redactTxId(m.matched_external_ref),
    matched_event_id: m.matched_event_id ? m.matched_event_id.slice(0, 8) + '…' : null,
  }));

  const totalMatched =
    counts.by_external_ref_eq_id +
    counts.by_external_ref_eq_oid +
    counts.by_external_ref_eq_order_id +
    counts.by_date_amount_currency;
  const overallMatchRate = sample > 0 ? totalMatched / sample : 0;

  return {
    ran_at,
    skipped_reason: null,
    actions_examined: sample,
    actions_total_in_window: totalInWindow,
    actions_pages_fetched: pagesFetched,
    actions_page_size: PAGE_SIZE,
    safety_cap: SAFETY_CAP,
    safety_cap_hit: safetyCapHit,
    actions_window_days: WINDOW_DAYS,
    csv_rows_in_same_window: csvRows.length,
    match_counts: counts,
    overall_match_rate: overallMatchRate,
    canonical_identity: canonical,
    canonical_evidence: canonicalEvidence,
    duplication_risk,
    csv_vs_api_verdict: verdict,
    csv_vs_api_reasons: reasons,
    reversal_semantics: {
      states_sampled: Object.fromEntries(statesSampled),
      reversed_payout_signs: { positive: revPos, zero: revZero, negative: revNeg },
      verdict: revVerdict,
      evidence: revEvidence,
    },
    example_matches,
    warnings,
  };
}

function emptyReport(ran_at: string, reason: string): CrosswalkReport {
  return {
    ran_at,
    skipped_reason: reason,
    actions_examined: 0,
    actions_total_in_window: null,
    actions_pages_fetched: 0,
    actions_page_size: PAGE_SIZE,
    safety_cap: SAFETY_CAP,
    safety_cap_hit: false,
    actions_window_days: 30,
    csv_rows_in_same_window: 0,
    match_counts: {
      by_external_ref_eq_id: 0,
      by_external_ref_eq_oid: 0,
      by_external_ref_eq_order_id: 0,
      by_date_amount_currency: 0,
      unmatched: 0,
      ambiguous_date_amount: 0,
    },
    overall_match_rate: 0,
    canonical_identity: 'insufficient_sample',
    canonical_evidence: reason,
    duplication_risk: 'unknown',
    csv_vs_api_verdict: 'unknown',
    csv_vs_api_reasons: [reason],
    reversal_semantics: {
      states_sampled: {},
      reversed_payout_signs: { positive: 0, zero: 0, negative: 0 },
      verdict: 'no_reversed_in_sample',
      evidence: 'Crosswalk did not run.',
    },
    example_matches: [],
    warnings: [reason],
  };
}

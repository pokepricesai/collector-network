import 'server-only';

// SEO rules — ride on network_opportunities (deterministic GSC
// engine, already generates kind='striking_distance'|'low_ctr'|
// 'declining'|'gaining'|'zero_click'|'new_query'). The intelligence
// layer wraps that output with cross-domain priority scoring and
// expected-upside estimates.
//
// Phase 1.1 — Signal quality gates:
//   • Position is read from `position_28d` (the key the opportunity
//     engine actually writes) with legacy fallbacks for safety.
//   • Rows without a valid finite position > 0 are DROPPED, not
//     coerced to zero. Position-less data cannot support a
//     "position-anchored" signal.
//   • Striking distance requires position ∈ [4, 15].
//   • Low CTR requires position ∈ [1, 15] AND an expected CTR from
//     the band model below AND an actual CTR materially below it.
//   • Both rules require a minimum impressions sample.
//
// Expected-CTR position band model (deterministic, documented):
//   pos 1    → 0.30
//   pos 2    → 0.18
//   pos 3    → 0.12
//   pos 4-5  → 0.08
//   pos 6-7  → 0.05
//   pos 8-10 → 0.03
//   pos 11-15 → 0.015
//   pos 16+  → not evaluated (handled upstream)
// Values are conservative industry anchors, not learned. We flag
// low_ctr when actual < expected × 0.5 AND absolute gap ≥ 0.015.

import type {
  IntelligenceRule, RuleContext, RuleOutput, RuleRunResult, RuleScopeDiagnostic, SiteSlug,
} from '../types';

const SEO_KINDS = ['striking_distance', 'low_ctr', 'declining', 'gaining'] as const;
type SeoKind = typeof SEO_KINDS[number];

type OppRow = {
  id: string;
  site_id: string;
  kind: SeoKind;
  severity: 'critical' | 'high' | 'normal' | 'low';
  page: string;
  query: string;
  title: string;
  description: string | null;
  evidence: Record<string, unknown>;
  metrics: Record<string, unknown>;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
};

const STRIKING_MIN_POS = 4;
const STRIKING_MAX_POS = 15;
const LOW_CTR_MIN_POS  = 1;
const LOW_CTR_MAX_POS  = 15;
const MIN_IMPRESSIONS_STRIKING = 50;
const MIN_IMPRESSIONS_LOW_CTR  = 200;

// Each rule shares the fetch to minimise round-trips; we memoise on
// the RuleContext so the first rule triggers the query and
// subsequent rules read the cached rows.
async function fetchOpenOpps(ctx: RuleContext): Promise<OppRow[]> {
  const cached = (ctx as unknown as { __seoOpps?: OppRow[] }).__seoOpps;
  if (cached) return cached;
  const { data, error } = await ctx.sb
    .from('network_opportunities')
    .select('id, site_id, kind, severity, page, query, title, description, evidence, metrics, status, first_seen_at, last_seen_at')
    .eq('status', 'open')
    .in('kind', SEO_KINDS as unknown as string[]);
  if (error) throw new Error(`[rules/seo] fetch opps: ${error.message}`);
  const rows = (data ?? []) as OppRow[];
  (ctx as unknown as { __seoOpps?: OppRow[] }).__seoOpps = rows;
  return rows;
}

function expectedCtrForPosition(position: number): number {
  if (position < 1) return 0;
  if (position < 1.5) return 0.30;
  if (position < 2.5) return 0.18;
  if (position < 3.5) return 0.12;
  if (position < 5.5) return 0.08;
  if (position < 7.5) return 0.05;
  if (position <= 10) return 0.03;
  if (position <= 15) return 0.015;
  return 0;
}

// Extract position from the opportunity metrics object. Returns null
// when the value is missing / not a finite number / not positive.
// NEVER coerces missing values to zero.
function readPosition(metrics: Record<string, unknown>): number | null {
  const raw =
    metrics['position_28d'] ??
    metrics['position_avg'] ??
    metrics['avg_position'];
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return n;
}

function readNum(v: unknown, fallback: number | null = 0): number | null {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

// Build per-site diagnostics across all registered sites so an
// absent site is NO_DATA rather than silently missing.
function emptyPerSiteDiags(
  ctx: RuleContext,
  initial: RuleOutcomeStatusForDiag = 'no_data',
  reason?: string,
): Map<SiteSlug | 'network', RuleScopeDiagnostic> {
  const m = new Map<SiteSlug | 'network', RuleScopeDiagnostic>();
  for (const s of ctx.sites) {
    m.set(s.slug, { scope: s.slug, status: initial, items_emitted: 0, reason });
  }
  return m;
}
type RuleOutcomeStatusForDiag = import('../types').RuleOutcomeStatus;

// ─── A. Striking distance ─────────────────────────────────────
export const strikingDistanceRule: IntelligenceRule = {
  id: 'seo.striking_distance',
  description: `Pages at position [${STRIKING_MIN_POS}, ${STRIKING_MAX_POS}] with ≥${MIN_IMPRESSIONS_STRIKING} impressions over 28d.`,
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const diags = emptyPerSiteDiags(ctx, 'no_data', 'no striking_distance rows in network_opportunities');
    const outputs: RuleOutput[] = [];
    const perSite = new Map<string, { examined: number; skipped: number; emitted: number }>();
    const allOpps = await fetchOpenOpps(ctx);
    const opps = allOpps.filter((o) => o.kind === 'striking_distance');
    for (const o of opps) {
      const site_slug = findSiteSlug(ctx, o.site_id);
      const key = site_slug ?? 'network';
      const bucket = perSite.get(o.site_id) ?? { examined: 0, skipped: 0, emitted: 0 };
      bucket.examined += 1;

      const impressions = readNum(o.metrics['impressions_28d'] ?? o.metrics['impressions'], 0) ?? 0;
      const clicks      = readNum(o.metrics['clicks_28d'] ?? o.metrics['clicks'], 0) ?? 0;
      const position    = readPosition(o.metrics);

      // Gate 1: position must be a real finite positive number.
      if (position == null) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }
      // Gate 2: position must sit in the striking band.
      if (position < STRIKING_MIN_POS || position > STRIKING_MAX_POS) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }
      // Gate 3: minimum impressions sample.
      if (impressions < MIN_IMPRESSIONS_STRIKING) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }

      const ctr        = impressions > 0 ? clicks / impressions : 0;
      const impact     = clamp(10 + 20 * Math.log10(Math.max(1, impressions / 100)));
      const confidence = clamp(40 + 15 * Math.log10(Math.max(1, impressions / 100)));
      const urgency    = clamp(80 - Math.abs(position - 8) * 6);
      const effort     = 25;

      const targetCtrLow  = Math.max(0.03, expectedCtrForPosition(position) * 0.7);
      const targetCtrHigh = Math.max(0.05, expectedCtrForPosition(position));
      const extraLow      = Math.max(0, Math.round((targetCtrLow  - ctr) * impressions));
      const extraHigh     = Math.max(0, Math.round((targetCtrHigh - ctr) * impressions));

      outputs.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:striking_distance:${key}:${o.page || o.query || o.id}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'striking_distance',
        signal_kind: 'opportunity',
        title: `Striking distance · ${key} · pos ${position.toFixed(1)}`,
        summary: `${fmtImp(impressions)} impressions at avg position ${position.toFixed(1)} with CTR ${(ctr * 100).toFixed(2)}%. Page: ${trim(o.page, 70)}${o.query ? ` · query "${trim(o.query, 60)}"` : ''}.`,
        recommended_action: 'Rewrite title + meta description to match query intent, strengthen top-of-page content and relevant internal links.',
        evidence: {
          impressions_28d: impressions,
          clicks_28d: clicks,
          ctr,
          avg_position: position,
          page: o.page,
          query: o.query,
          opportunity_id: o.id,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: extraHigh >= 5 ? {
          label: `+${extraLow} to +${extraHigh} clicks/month`,
          metric: 'clicks_per_month',
          low: extraLow,
          high: extraHigh,
          rationale: `Raising CTR from ${(ctr * 100).toFixed(1)}% to ${(targetCtrLow * 100).toFixed(1)}-${(targetCtrHigh * 100).toFixed(1)}% at current impressions.`,
        } : null,
      });
      bucket.emitted += 1;
      perSite.set(o.site_id, bucket);
    }

    // Resolve per-site diagnostics from the bucket we built.
    for (const site of ctx.sites) {
      const b = perSite.get(site.id);
      const d = diags.get(site.slug)!;
      if (!b) continue;
      d.rows_examined = b.examined;
      d.rows_skipped_invalid = b.skipped;
      d.items_emitted = b.emitted;
      if (b.emitted > 0) {
        d.status = 'signals_found'; d.reason = undefined;
      } else if (b.examined === 0) {
        d.status = 'no_data'; d.reason = 'no striking_distance rows for this site';
      } else if (b.skipped === b.examined) {
        d.status = 'no_signal'; d.reason = `all ${b.examined} rows failed gates (position [${STRIKING_MIN_POS},${STRIKING_MAX_POS}] + impressions ≥${MIN_IMPRESSIONS_STRIKING})`;
      } else {
        d.status = 'no_signal'; d.reason = `${b.skipped}/${b.examined} failed gates and no survivors emitted`;
      }
    }

    return { outputs, diagnostics: Array.from(diags.values()) };
  },
};

// ─── B. High impressions, low CTR ─────────────────────────────
export const lowCtrRule: IntelligenceRule = {
  id: 'seo.low_ctr',
  description: `Position [${LOW_CTR_MIN_POS}, ${LOW_CTR_MAX_POS}] with CTR materially below the position-band expected CTR.`,
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const diags = emptyPerSiteDiags(ctx, 'no_data', 'no low_ctr rows in network_opportunities');
    const outputs: RuleOutput[] = [];
    const perSite = new Map<string, { examined: number; skipped: number; emitted: number }>();
    const allOpps = await fetchOpenOpps(ctx);
    const opps = allOpps.filter((o) => o.kind === 'low_ctr');
    for (const o of opps) {
      const site_slug = findSiteSlug(ctx, o.site_id);
      const key = site_slug ?? 'network';
      const bucket = perSite.get(o.site_id) ?? { examined: 0, skipped: 0, emitted: 0 };
      bucket.examined += 1;

      const impressions = readNum(o.metrics['impressions_28d'] ?? o.metrics['impressions'], 0) ?? 0;
      const clicks      = readNum(o.metrics['clicks_28d'] ?? o.metrics['clicks'], 0) ?? 0;
      const position    = readPosition(o.metrics);

      if (position == null) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }
      if (position < LOW_CTR_MIN_POS || position > LOW_CTR_MAX_POS) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }
      if (impressions < MIN_IMPRESSIONS_LOW_CTR) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }

      const ctr      = impressions > 0 ? clicks / impressions : 0;
      const expected = expectedCtrForPosition(position);
      // Low-CTR trigger: actual < 50% of expected AND absolute gap ≥ 1.5pp.
      const absoluteGap = expected - ctr;
      if (expected <= 0) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }
      if (ctr >= expected * 0.5) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }
      if (absoluteGap < 0.015) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }

      const impact     = clamp(10 + 22 * Math.log10(Math.max(1, impressions / 100)));
      const confidence = clamp(45 + 15 * Math.log10(Math.max(1, impressions / 100)));
      const urgency    = clamp(55 + (ctr < expected * 0.25 ? 15 : 0));
      const effort     = 20;
      const targetCtr  = Math.max(expected * 0.9, 0.04);
      const uplift     = Math.max(0, Math.round((targetCtr - ctr) * impressions));

      outputs.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:low_ctr:${key}:${o.page || o.query || o.id}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'low_ctr',
        signal_kind: 'opportunity',
        title: `High impressions, weak CTR · ${key} · pos ${position.toFixed(1)}`,
        summary: `${fmtImp(impressions)} impressions, CTR ${(ctr * 100).toFixed(2)}% vs expected ~${(expected * 100).toFixed(1)}% at avg position ${position.toFixed(1)}. Page: ${trim(o.page, 70)}.`,
        recommended_action: 'Tighten title and meta description for the primary query; strengthen the on-page snippet / schema. Avoid rewriting if the page is already serving different intent.',
        evidence: {
          impressions_28d: impressions,
          clicks_28d: clicks,
          ctr,
          expected_ctr: expected,
          ctr_gap_pp: Number((absoluteGap * 100).toFixed(2)),
          avg_position: position,
          page: o.page,
          query: o.query,
          opportunity_id: o.id,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: uplift >= 5 ? {
          label: `+${Math.round(uplift * 0.6)} to +${uplift} clicks/month`,
          metric: 'clicks_per_month',
          low: Math.round(uplift * 0.6),
          high: uplift,
          rationale: `Raising CTR from ${(ctr * 100).toFixed(2)}% to ~${(targetCtr * 100).toFixed(1)}%.`,
        } : null,
      });
      bucket.emitted += 1;
      perSite.set(o.site_id, bucket);
    }

    for (const site of ctx.sites) {
      const b = perSite.get(site.id);
      const d = diags.get(site.slug)!;
      if (!b) continue;
      d.rows_examined = b.examined;
      d.rows_skipped_invalid = b.skipped;
      d.items_emitted = b.emitted;
      if (b.emitted > 0) {
        d.status = 'signals_found'; d.reason = undefined;
      } else if (b.examined === 0) {
        d.status = 'no_data'; d.reason = 'no low_ctr rows for this site';
      } else {
        d.status = 'no_signal'; d.reason = `${b.skipped}/${b.examined} rows failed gates (position + impressions ≥${MIN_IMPRESSIONS_LOW_CTR} + CTR < half of band expected with ≥1.5pp absolute gap)`;
      }
    }

    return { outputs, diagnostics: Array.from(diags.values()) };
  },
};

// ─── C. Declining page ────────────────────────────────────────
export const decliningRule: IntelligenceRule = {
  id: 'seo.declining',
  description: 'Page where clicks dropped materially vs prior period. Requires ≥10 prior clicks to avoid tiny-denominator noise.',
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const diags = emptyPerSiteDiags(ctx, 'no_data', 'no declining rows in network_opportunities');
    const outputs: RuleOutput[] = [];
    const perSite = new Map<string, { examined: number; skipped: number; emitted: number }>();
    const allOpps = await fetchOpenOpps(ctx);
    const opps = allOpps.filter((o) => o.kind === 'declining');
    for (const o of opps) {
      const site_slug = findSiteSlug(ctx, o.site_id);
      const key = site_slug ?? 'network';
      const bucket = perSite.get(o.site_id) ?? { examined: 0, skipped: 0, emitted: 0 };
      bucket.examined += 1;

      const clicks       = readNum(o.metrics['clicks_28d'], 0) ?? 0;
      const priorClicks  = readNum(o.metrics['clicks_prior_28d'], 0) ?? 0;
      // Sanity gate: a decline against zero prior is meaningless.
      if (priorClicks < 10) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }
      if (clicks < 0) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }

      const changePct    = ((clicks - priorClicks) / priorClicks) * 100;
      // Only emit real declines (don't let the base rule emit when
      // clicks are flat or rose).
      if (changePct > -20) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }

      const impressions  = readNum(o.metrics['impressions_28d'], null);
      const dropMag      = Math.min(100, Math.abs(changePct));
      const impact       = clamp(30 + dropMag * 0.5 + 10 * Math.log10(Math.max(1, (impressions ?? 100) / 100)));
      const confidence   = clamp(50 + 10 * Math.log10(Math.max(1, priorClicks / 10)));
      const urgency      = clamp(50 + dropMag * 0.4);
      const effort       = 45;

      outputs.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:declining:${key}:${o.page || o.id}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'declining',
        signal_kind: 'risk',
        title: `Declining page · ${key} (${changePct.toFixed(0)}%)`,
        summary: `Clicks dropped from ${priorClicks} to ${clicks} vs prior 28d (${changePct.toFixed(0)}%). Page: ${trim(o.page, 70)}.`,
        recommended_action: 'Audit for ranking loss, content freshness, SERP volatility, and index coverage. Refresh content, update dates, verify crawl + inspect in GSC.',
        evidence: {
          clicks_28d: clicks,
          clicks_prior_28d: priorClicks,
          change_pct: changePct,
          ...(impressions != null ? { impressions_28d: impressions } : {}),
          page: o.page,
          opportunity_id: o.id,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: {
          label: `recovering ~${Math.round(priorClicks - clicks)} lost clicks/28d`,
          metric: 'clicks_per_month',
          low: Math.round((priorClicks - clicks) * 0.5),
          high: Math.round(priorClicks - clicks),
          rationale: 'Full recovery would restore prior-period click volume.',
        },
      });
      bucket.emitted += 1;
      perSite.set(o.site_id, bucket);
    }

    for (const site of ctx.sites) {
      const b = perSite.get(site.id);
      const d = diags.get(site.slug)!;
      if (!b) continue;
      d.rows_examined = b.examined;
      d.rows_skipped_invalid = b.skipped;
      d.items_emitted = b.emitted;
      if (b.emitted > 0) { d.status = 'signals_found'; d.reason = undefined; }
      else if (b.examined === 0) { d.status = 'no_data'; d.reason = 'no declining rows for this site'; }
      else { d.status = 'no_signal'; d.reason = `${b.skipped}/${b.examined} declining rows failed gates (prior ≥10 clicks + change ≤ -20%)`; }
    }

    return { outputs, diagnostics: Array.from(diags.values()) };
  },
};

// ─── D. Gaining page ──────────────────────────────────────────
// Opportunity generator stores `clicks_28d`, `clicks_prior_28d`,
// `change` on gaining rows but NOT impressions. We must not fake
// `impressions_28d: 0` on the intelligence card — that mis-reads as
// "zero impressions, 74 clicks" which is nonsense. Omit impressions
// entirely when the upstream didn't provide them.
export const gainingRule: IntelligenceRule = {
  id: 'seo.gaining',
  description: 'Page where clicks grew materially vs prior period. Requires ≥10 prior clicks and ≥20 current clicks to avoid tiny-denominator noise.',
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const diags = emptyPerSiteDiags(ctx, 'no_data', 'no gaining rows in network_opportunities');
    const outputs: RuleOutput[] = [];
    const perSite = new Map<string, { examined: number; skipped: number; emitted: number }>();
    const allOpps = await fetchOpenOpps(ctx);
    const opps = allOpps.filter((o) => o.kind === 'gaining');
    for (const o of opps) {
      const site_slug = findSiteSlug(ctx, o.site_id);
      const key = site_slug ?? 'network';
      const bucket = perSite.get(o.site_id) ?? { examined: 0, skipped: 0, emitted: 0 };
      bucket.examined += 1;

      const clicks       = readNum(o.metrics['clicks_28d'], 0) ?? 0;
      const priorClicks  = readNum(o.metrics['clicks_prior_28d'], 0) ?? 0;
      if (priorClicks < 10) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }
      if (clicks < 20) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }
      if (clicks <= priorClicks) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }

      const changePct    = ((clicks - priorClicks) / priorClicks) * 100;
      if (changePct < 20) { bucket.skipped += 1; perSite.set(o.site_id, bucket); continue; }

      // Impressions may legitimately be absent on gaining rows — the
      // opportunity engine computes gain from clicks only. Only
      // include it in evidence when the upstream recorded it as a
      // real positive number.
      const impressionsRaw = o.metrics['impressions_28d'];
      const impressions    = typeof impressionsRaw === 'number' && impressionsRaw > 0 ? impressionsRaw : null;

      const impact       = clamp(25 + Math.min(50, changePct * 0.3) + 10 * Math.log10(Math.max(1, (impressions ?? 100) / 100)));
      const confidence   = clamp(50 + 10 * Math.log10(Math.max(1, clicks / 10)));
      const urgency      = clamp(30 + Math.min(30, changePct * 0.2));
      const effort       = 30;

      outputs.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:gaining:${key}:${o.page || o.id}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'gaining',
        signal_kind: 'positive',
        title: `Gaining page · ${key} (+${changePct.toFixed(0)}%)`,
        summary: `Clicks grew from ${priorClicks} to ${clicks} vs prior 28d (+${changePct.toFixed(0)}%). Reinforce while momentum lasts.`,
        recommended_action: 'Reinforce with related internal links, surface the page in prominent hub positions, and watch for related long-tail queries worth capturing.',
        evidence: {
          clicks_28d: clicks,
          clicks_prior_28d: priorClicks,
          change_pct: changePct,
          ...(impressions != null ? { impressions_28d: impressions } : { impressions_28d: 'not_tracked_for_gaining' }),
          page: o.page,
          opportunity_id: o.id,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: null,
      });
      bucket.emitted += 1;
      perSite.set(o.site_id, bucket);
    }

    for (const site of ctx.sites) {
      const b = perSite.get(site.id);
      const d = diags.get(site.slug)!;
      if (!b) continue;
      d.rows_examined = b.examined;
      d.rows_skipped_invalid = b.skipped;
      d.items_emitted = b.emitted;
      if (b.emitted > 0) { d.status = 'signals_found'; d.reason = undefined; }
      else if (b.examined === 0) { d.status = 'no_data'; d.reason = 'no gaining rows for this site'; }
      else { d.status = 'no_signal'; d.reason = `${b.skipped}/${b.examined} gaining rows failed gates (prior ≥10 + current ≥20 + change ≥20%)`; }
    }

    return { outputs, diagnostics: Array.from(diags.values()) };
  },
};

// ─── Helpers ──────────────────────────────────────────────────
function clamp(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }
function trim(s: string | null | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function fmtImp(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString();
}
function findSiteSlug(ctx: RuleContext, site_id: string | null): SiteSlug | null {
  if (!site_id) return null;
  for (const s of ctx.sites) if (s.id === site_id) return s.slug;
  return null;
}

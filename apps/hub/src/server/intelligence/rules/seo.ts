import 'server-only';

// SEO rules — ride on network_opportunities (deterministic GSC
// engine, already generates kind='striking_distance'|'low_ctr'|
// 'declining'|'gaining'|'zero_click'|'new_query') and the GSC URL
// data layer. The intelligence layer wraps that output with cross-
// domain priority scoring, expected-upside estimates, and
// PAGE-LEVEL aggregation for query-oriented kinds.
//
// Phase 1.2 — PAGE AGGREGATION:
//   • striking_distance and low_ctr emit at most ONE intelligence
//     item per (site, page), aggregating all qualifying
//     per-query opportunities into one card. The card carries a
//     top_queries[] list, impression-weighted position, summed
//     impressions, summed clicks.
//   • gaining and declining remain naturally page-level — the
//     opportunity engine already emits one row per page with
//     query=''.
//   • Downstream recommendation layers want to reason about one
//     coherent page change, not N parallel per-query cards.
//
// Phase 1.2 — INSUFFICIENT_DATA diagnostic:
//   • If a site has NO opportunity rows for a given kind, probe
//     network_gsc_url_query_daily for recent coverage. If the GSC
//     table has rows for that site, mark the scope
//     'insufficient_data' (coverage exists but no query clears
//     the upstream opportunity thresholds). If GSC itself is
//     empty, keep 'no_data'. This distinguishes "we track the
//     site but it has small traffic" from "we don't track the
//     site at all".
//
// Expected-CTR position band model (unchanged from Phase 1.1):
//   pos 1    → 0.30 · pos 2 → 0.18 · pos 3 → 0.12
//   pos 4-5  → 0.08 · pos 6-7 → 0.05 · pos 8-10 → 0.03
//   pos 11-15 → 0.015 · pos 16+ → not evaluated
// Values are conservative industry anchors, not learned.

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
const TOP_QUERIES_LIMIT        = 5;

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

// Probe GSC coverage for a site so we can distinguish "no upstream
// data" from "upstream data too thin to generate opportunities".
// Cached on the context so repeated SEO rules share the lookup.
async function fetchSiteGscCoverage(
  ctx: RuleContext,
): Promise<Set<string>> {
  const cached = (ctx as unknown as { __gscSiteCoverage?: Set<string> }).__gscSiteCoverage;
  if (cached) return cached;
  // Pull one row per site_id that has ANY query-level GSC data in
  // the last 35 days. Group in-memory to avoid an RPC function.
  const since = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data } = await ctx.sb
    .from('network_gsc_url_query_daily')
    .select('site_id')
    .gte('date', since)
    .limit(50000);
  const set = new Set<string>();
  for (const r of ((data ?? []) as Array<{ site_id: string }>)) set.add(r.site_id);
  (ctx as unknown as { __gscSiteCoverage?: Set<string> }).__gscSiteCoverage = set;
  return set;
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

interface QueryContribution {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  opportunity_id: string;
}

// Pure helper: aggregate a list of per-query contributions on the
// same page into a page-level view. Impression-weighted position.
// Picks the top N queries by impressions for the evidence payload.
interface PageAggregate {
  page: string;
  site_id: string;
  total_impressions: number;
  total_clicks: number;
  weighted_position: number;
  query_count: number;
  top_queries: QueryContribution[];
  contributions: QueryContribution[];           // full list (used for CTR gap maths)
  primary: QueryContribution;                   // the single top query
  opportunity_ids: string[];
}

function aggregateByPage(contribs: QueryContribution[], site_id: string, page: string): PageAggregate {
  const totalImpr = contribs.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = contribs.reduce((s, c) => s + c.clicks, 0);
  const posSum = contribs.reduce((s, c) => s + c.position * c.impressions, 0);
  const weightedPos = totalImpr > 0 ? posSum / totalImpr : 0;
  const sorted = [...contribs].sort((a, b) => b.impressions - a.impressions);
  const top = sorted.slice(0, TOP_QUERIES_LIMIT);
  return {
    page, site_id,
    total_impressions: totalImpr,
    total_clicks: totalClicks,
    weighted_position: weightedPos,
    query_count: contribs.length,
    top_queries: top,
    contributions: sorted,
    primary: sorted[0]!,
    opportunity_ids: contribs.map((c) => c.opportunity_id),
  };
}

// Each per-site rule state tracker.
interface SiteState {
  examined_queries: number;
  skipped_invalid: number;
  pages: Map<string, QueryContribution[]>;
}
function emptySiteState(): SiteState { return { examined_queries: 0, skipped_invalid: 0, pages: new Map() }; }

// Build final per-site diagnostic for an SEO rule after
// aggregation. Expresses no_data vs insufficient_data vs
// no_signal using the GSC coverage probe.
function resolveSiteDiag(
  ctx: RuleContext,
  gscCoverage: Set<string>,
  site: { id: string; slug: SiteSlug },
  state: SiteState | undefined,
  pagesEmitted: number,
  kindLabel: string,
  gates: string,
): RuleScopeDiagnostic {
  const d: RuleScopeDiagnostic = {
    scope: site.slug,
    status: 'no_data',
    items_emitted: pagesEmitted,
  };
  if (!state || state.examined_queries === 0) {
    if (gscCoverage.has(site.id)) {
      d.status = 'insufficient_data';
      d.reason = `GSC coverage present but no ${kindLabel} opportunity rows for this site — upstream thresholds not met`;
    } else {
      d.status = 'no_data';
      d.reason = `no GSC url+query coverage for this site in the last 35d`;
    }
    void ctx;
    return d;
  }
  d.rows_examined = state.examined_queries;
  d.rows_skipped_invalid = state.skipped_invalid;
  if (pagesEmitted > 0) {
    d.status = 'signals_found';
    d.reason = `${state.pages.size} page(s) aggregated from ${state.examined_queries} query-level opportunity rows`;
  } else {
    d.status = 'no_signal';
    d.reason = `all ${state.examined_queries} opportunity rows failed gates (${gates})`;
  }
  return d;
}

// ─── A. Striking distance (page-aggregated) ───────────────────
export const strikingDistanceRule: IntelligenceRule = {
  id: 'seo.striking_distance',
  description: `Pages with ≥1 query at position [${STRIKING_MIN_POS}, ${STRIKING_MAX_POS}] and ≥${MIN_IMPRESSIONS_STRIKING} impressions over 28d. Aggregated per page.`,
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const outputs: RuleOutput[] = [];
    const allOpps = await fetchOpenOpps(ctx);
    const gscCoverage = await fetchSiteGscCoverage(ctx);
    const perSite = new Map<string, SiteState>();

    // Phase A: filter query-level opportunities through the gates,
    // group surviving ones by page.
    for (const o of allOpps.filter((x) => x.kind === 'striking_distance')) {
      const state = perSite.get(o.site_id) ?? emptySiteState();
      state.examined_queries += 1;
      const impressions = readNum(o.metrics['impressions_28d'] ?? o.metrics['impressions'], 0) ?? 0;
      const clicks      = readNum(o.metrics['clicks_28d']      ?? o.metrics['clicks'],      0) ?? 0;
      const position    = readPosition(o.metrics);
      if (position == null) { state.skipped_invalid += 1; perSite.set(o.site_id, state); continue; }
      if (position < STRIKING_MIN_POS || position > STRIKING_MAX_POS) { state.skipped_invalid += 1; perSite.set(o.site_id, state); continue; }
      if (impressions < MIN_IMPRESSIONS_STRIKING) { state.skipped_invalid += 1; perSite.set(o.site_id, state); continue; }
      const contrib: QueryContribution = {
        query: o.query,
        impressions, clicks,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position,
        opportunity_id: o.id,
      };
      const bucket = state.pages.get(o.page) ?? [];
      bucket.push(contrib);
      state.pages.set(o.page, bucket);
      perSite.set(o.site_id, state);
    }

    // Phase B: emit one card per page.
    for (const site of ctx.sites) {
      const state = perSite.get(site.id);
      if (!state) continue;
      for (const [page, contribs] of state.pages) {
        const agg = aggregateByPage(contribs, site.id, page);
        const impressions = agg.total_impressions;
        const clicks      = agg.total_clicks;
        const position    = agg.weighted_position;
        const ctr         = impressions > 0 ? clicks / impressions : 0;

        // Scoring: based on AGGREGATED volume. Not inflated —
        // impressions are the real search demand for this page's
        // striking-distance queries.
        const impact     = clamp(10 + 20 * Math.log10(Math.max(1, impressions / 100)));
        const confidence = clamp(40 + 15 * Math.log10(Math.max(1, impressions / 100)));
        const urgency    = clamp(80 - Math.abs(position - 8) * 6);
        const effort     = 25;

        // Expected upside: based on AGGREGATED impressions. Do not
        // sum per-query upsides (would double-count the shared page
        // fix). Target CTR comes from the band of the weighted
        // position.
        const targetCtrLow  = Math.max(0.03, expectedCtrForPosition(position) * 0.7);
        const targetCtrHigh = Math.max(0.05, expectedCtrForPosition(position));
        const extraLow      = Math.max(0, Math.round((targetCtrLow  - ctr) * impressions));
        const extraHigh     = Math.max(0, Math.round((targetCtrHigh - ctr) * impressions));

        const summary = agg.query_count === 1
          ? `${fmtImp(impressions)} impressions at avg position ${position.toFixed(1)} with CTR ${(ctr * 100).toFixed(2)}%. Query: "${trim(agg.primary.query, 60)}".`
          : `${agg.query_count} queries, ${fmtImp(impressions)} combined impressions at weighted position ${position.toFixed(1)}, CTR ${(ctr * 100).toFixed(2)}%. Top query: "${trim(agg.primary.query, 50)}".`;

        outputs.push({
          source_type: 'seo',
          source_id: agg.primary.opportunity_id,
          source_key: `seo:striking_distance:${site.slug}:${page}`,
          site_id: site.id,
          site_slug: site.slug,
          category: 'seo',
          type: 'striking_distance',
          signal_kind: 'opportunity',
          title: `Striking distance · ${site.slug} · pos ${position.toFixed(1)}${agg.query_count > 1 ? ` · ${agg.query_count} queries` : ''}`,
          summary,
          recommended_action: 'Rewrite title + meta description to match the top-ranked query intent, strengthen top-of-page content, and reinforce with internal links. The listed queries all live on the same page, so one coherent edit targets them all.',
          evidence: {
            page,
            query_count: agg.query_count,
            total_impressions_28d: impressions,
            total_clicks_28d: clicks,
            weighted_position: position,
            ctr,
            top_queries: agg.top_queries.map((q) => ({
              query: q.query,
              impressions: q.impressions,
              clicks: q.clicks,
              ctr: Number(q.ctr.toFixed(4)),
              position: Number(q.position.toFixed(2)),
            })),
            opportunity_ids: agg.opportunity_ids,
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
            rationale: `Raising CTR from ${(ctr * 100).toFixed(1)}% to ${(targetCtrLow * 100).toFixed(1)}-${(targetCtrHigh * 100).toFixed(1)}% at current combined impressions.`,
          } : null,
        });
      }
    }

    // Diagnostics.
    const diags: RuleScopeDiagnostic[] = [];
    for (const site of ctx.sites) {
      const state = perSite.get(site.id);
      const pagesEmitted = state ? state.pages.size : 0;
      diags.push(resolveSiteDiag(
        ctx, gscCoverage, site, state, pagesEmitted,
        'striking_distance',
        `position [${STRIKING_MIN_POS},${STRIKING_MAX_POS}] + impressions ≥${MIN_IMPRESSIONS_STRIKING}`,
      ));
    }
    return { outputs, diagnostics: diags };
  },
};

// ─── B. Low CTR (page-aggregated) ─────────────────────────────
export const lowCtrRule: IntelligenceRule = {
  id: 'seo.low_ctr',
  description: `Position [${LOW_CTR_MIN_POS}, ${LOW_CTR_MAX_POS}] with CTR materially below band expectation. Aggregated per page.`,
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const outputs: RuleOutput[] = [];
    const allOpps = await fetchOpenOpps(ctx);
    const gscCoverage = await fetchSiteGscCoverage(ctx);
    const perSite = new Map<string, SiteState>();

    for (const o of allOpps.filter((x) => x.kind === 'low_ctr')) {
      const state = perSite.get(o.site_id) ?? emptySiteState();
      state.examined_queries += 1;
      const impressions = readNum(o.metrics['impressions_28d'] ?? o.metrics['impressions'], 0) ?? 0;
      const clicks      = readNum(o.metrics['clicks_28d']      ?? o.metrics['clicks'],      0) ?? 0;
      const position    = readPosition(o.metrics);
      if (position == null) { state.skipped_invalid += 1; perSite.set(o.site_id, state); continue; }
      if (position < LOW_CTR_MIN_POS || position > LOW_CTR_MAX_POS) { state.skipped_invalid += 1; perSite.set(o.site_id, state); continue; }
      if (impressions < MIN_IMPRESSIONS_LOW_CTR) { state.skipped_invalid += 1; perSite.set(o.site_id, state); continue; }
      const expected = expectedCtrForPosition(position);
      if (expected <= 0) { state.skipped_invalid += 1; perSite.set(o.site_id, state); continue; }
      const ctr      = impressions > 0 ? clicks / impressions : 0;
      // Per-query qualifier: must be meaningfully below band.
      const gap      = expected - ctr;
      if (ctr >= expected * 0.5) { state.skipped_invalid += 1; perSite.set(o.site_id, state); continue; }
      if (gap < 0.015)           { state.skipped_invalid += 1; perSite.set(o.site_id, state); continue; }
      const contrib: QueryContribution = {
        query: o.query,
        impressions, clicks, ctr, position,
        opportunity_id: o.id,
      };
      const bucket = state.pages.get(o.page) ?? [];
      bucket.push(contrib);
      state.pages.set(o.page, bucket);
      perSite.set(o.site_id, state);
    }

    for (const site of ctx.sites) {
      const state = perSite.get(site.id);
      if (!state) continue;
      for (const [page, contribs] of state.pages) {
        const agg = aggregateByPage(contribs, site.id, page);
        const impressions = agg.total_impressions;
        const clicks      = agg.total_clicks;
        const position    = agg.weighted_position;
        const ctr         = impressions > 0 ? clicks / impressions : 0;
        const expected    = expectedCtrForPosition(position);

        const impact     = clamp(10 + 22 * Math.log10(Math.max(1, impressions / 100)));
        const confidence = clamp(45 + 15 * Math.log10(Math.max(1, impressions / 100)));
        const urgency    = clamp(55 + (ctr < expected * 0.25 ? 15 : 0));
        const effort     = 20;
        const targetCtr  = Math.max(expected * 0.9, 0.04);
        const uplift     = Math.max(0, Math.round((targetCtr - ctr) * impressions));

        const summary = agg.query_count === 1
          ? `${fmtImp(impressions)} impressions, CTR ${(ctr * 100).toFixed(2)}% vs expected ~${(expected * 100).toFixed(1)}% at avg position ${position.toFixed(1)}. Query: "${trim(agg.primary.query, 60)}".`
          : `${agg.query_count} queries on this page, ${fmtImp(impressions)} combined impressions, CTR ${(ctr * 100).toFixed(2)}% vs band expectation ~${(expected * 100).toFixed(1)}% at weighted position ${position.toFixed(1)}.`;

        outputs.push({
          source_type: 'seo',
          source_id: agg.primary.opportunity_id,
          source_key: `seo:low_ctr:${site.slug}:${page}`,
          site_id: site.id,
          site_slug: site.slug,
          category: 'seo',
          type: 'low_ctr',
          signal_kind: 'opportunity',
          title: `High impressions, weak CTR · ${site.slug} · pos ${position.toFixed(1)}${agg.query_count > 1 ? ` · ${agg.query_count} queries` : ''}`,
          summary,
          recommended_action: 'Tighten title and meta description for the primary query; strengthen the on-page snippet / schema. If multiple queries share this page, prioritise title language that matches the highest-impression query first.',
          evidence: {
            page,
            query_count: agg.query_count,
            total_impressions_28d: impressions,
            total_clicks_28d: clicks,
            weighted_position: position,
            ctr,
            expected_ctr: expected,
            ctr_gap_pp: Number(((expected - ctr) * 100).toFixed(2)),
            top_queries: agg.top_queries.map((q) => ({
              query: q.query,
              impressions: q.impressions,
              clicks: q.clicks,
              ctr: Number(q.ctr.toFixed(4)),
              position: Number(q.position.toFixed(2)),
            })),
            opportunity_ids: agg.opportunity_ids,
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
      }
    }

    const diags: RuleScopeDiagnostic[] = [];
    for (const site of ctx.sites) {
      const state = perSite.get(site.id);
      const pagesEmitted = state ? state.pages.size : 0;
      diags.push(resolveSiteDiag(
        ctx, gscCoverage, site, state, pagesEmitted,
        'low_ctr',
        `position + impressions ≥${MIN_IMPRESSIONS_LOW_CTR} + CTR < half of band expected with ≥1.5pp gap`,
      ));
    }
    return { outputs, diagnostics: diags };
  },
};

// ─── C. Declining page ────────────────────────────────────────
// Upstream already emits one row per declining page (query='').
// We just wrap it; the "aggregation" is identity.
export const decliningRule: IntelligenceRule = {
  id: 'seo.declining',
  description: 'Page where clicks dropped materially vs prior period. Requires ≥10 prior clicks to avoid tiny-denominator noise.',
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const outputs: RuleOutput[] = [];
    const allOpps = await fetchOpenOpps(ctx);
    const gscCoverage = await fetchSiteGscCoverage(ctx);
    const perSite = new Map<string, { examined: number; skipped: number; emitted: number }>();

    for (const o of allOpps.filter((x) => x.kind === 'declining')) {
      const site_slug = findSiteSlug(ctx, o.site_id);
      const b = perSite.get(o.site_id) ?? { examined: 0, skipped: 0, emitted: 0 };
      b.examined += 1;
      const clicks       = readNum(o.metrics['clicks_28d'], 0) ?? 0;
      const priorClicks  = readNum(o.metrics['clicks_prior_28d'], 0) ?? 0;
      if (priorClicks < 10) { b.skipped += 1; perSite.set(o.site_id, b); continue; }
      if (clicks < 0)       { b.skipped += 1; perSite.set(o.site_id, b); continue; }
      const changePct    = ((clicks - priorClicks) / priorClicks) * 100;
      if (changePct > -20) { b.skipped += 1; perSite.set(o.site_id, b); continue; }
      const impressions  = readNum(o.metrics['impressions_28d'], null);
      const dropMag      = Math.min(100, Math.abs(changePct));
      const impact       = clamp(30 + dropMag * 0.5 + 10 * Math.log10(Math.max(1, (impressions ?? 100) / 100)));
      const confidence   = clamp(50 + 10 * Math.log10(Math.max(1, priorClicks / 10)));
      const urgency      = clamp(50 + dropMag * 0.4);
      const effort       = 45;
      outputs.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:declining:${site_slug ?? 'network'}:${o.page}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'declining',
        signal_kind: 'risk',
        title: `Declining page · ${site_slug ?? 'network'} (${changePct.toFixed(0)}%)`,
        summary: `Clicks dropped from ${priorClicks} to ${clicks} vs prior 28d (${changePct.toFixed(0)}%). Page: ${trim(o.page, 70)}.`,
        recommended_action: 'Audit for ranking loss, content freshness, SERP volatility, and index coverage. Refresh content, update dates, verify crawl + inspect in GSC.',
        evidence: {
          page: o.page,
          clicks_28d: clicks,
          clicks_prior_28d: priorClicks,
          change_pct: changePct,
          ...(impressions != null ? { impressions_28d: impressions } : {}),
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
      b.emitted += 1;
      perSite.set(o.site_id, b);
    }

    const diags: RuleScopeDiagnostic[] = [];
    for (const site of ctx.sites) {
      const b = perSite.get(site.id);
      const d: RuleScopeDiagnostic = { scope: site.slug, status: 'no_data', items_emitted: 0 };
      if (!b) {
        if (gscCoverage.has(site.id)) {
          d.status = 'insufficient_data';
          d.reason = 'GSC coverage present but no declining opportunity rows for this site';
        } else {
          d.status = 'no_data';
          d.reason = 'no GSC url+query coverage for this site in the last 35d';
        }
      } else {
        d.rows_examined = b.examined;
        d.rows_skipped_invalid = b.skipped;
        d.items_emitted = b.emitted;
        d.status = b.emitted > 0 ? 'signals_found' : 'no_signal';
        if (b.emitted === 0) d.reason = `${b.skipped}/${b.examined} declining rows failed gates (prior ≥10 + change ≤ -20%)`;
      }
      diags.push(d);
    }
    return { outputs, diagnostics: diags };
  },
};

// ─── D. Gaining page ──────────────────────────────────────────
export const gainingRule: IntelligenceRule = {
  id: 'seo.gaining',
  description: 'Page where clicks grew materially vs prior period. Requires ≥10 prior clicks and ≥20 current clicks.',
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const outputs: RuleOutput[] = [];
    const allOpps = await fetchOpenOpps(ctx);
    const gscCoverage = await fetchSiteGscCoverage(ctx);
    const perSite = new Map<string, { examined: number; skipped: number; emitted: number }>();

    for (const o of allOpps.filter((x) => x.kind === 'gaining')) {
      const site_slug = findSiteSlug(ctx, o.site_id);
      const b = perSite.get(o.site_id) ?? { examined: 0, skipped: 0, emitted: 0 };
      b.examined += 1;

      const clicks       = readNum(o.metrics['clicks_28d'], 0) ?? 0;
      const priorClicks  = readNum(o.metrics['clicks_prior_28d'], 0) ?? 0;
      if (priorClicks < 10)       { b.skipped += 1; perSite.set(o.site_id, b); continue; }
      if (clicks < 20)            { b.skipped += 1; perSite.set(o.site_id, b); continue; }
      if (clicks <= priorClicks)  { b.skipped += 1; perSite.set(o.site_id, b); continue; }

      const changePct    = ((clicks - priorClicks) / priorClicks) * 100;
      if (changePct < 20) { b.skipped += 1; perSite.set(o.site_id, b); continue; }

      const impressionsRaw = o.metrics['impressions_28d'];
      const impressions    = typeof impressionsRaw === 'number' && impressionsRaw > 0 ? impressionsRaw : null;

      const impact       = clamp(25 + Math.min(50, changePct * 0.3) + 10 * Math.log10(Math.max(1, (impressions ?? 100) / 100)));
      const confidence   = clamp(50 + 10 * Math.log10(Math.max(1, clicks / 10)));
      const urgency      = clamp(30 + Math.min(30, changePct * 0.2));
      const effort       = 30;

      outputs.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:gaining:${site_slug ?? 'network'}:${o.page}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'gaining',
        signal_kind: 'positive',
        title: `Gaining page · ${site_slug ?? 'network'} (+${changePct.toFixed(0)}%)`,
        summary: `Clicks grew from ${priorClicks} to ${clicks} vs prior 28d (+${changePct.toFixed(0)}%). Reinforce while momentum lasts.`,
        recommended_action: 'Reinforce with related internal links, surface the page in prominent hub positions, and watch for related long-tail queries worth capturing.',
        evidence: {
          page: o.page,
          clicks_28d: clicks,
          clicks_prior_28d: priorClicks,
          change_pct: changePct,
          ...(impressions != null ? { impressions_28d: impressions } : { impressions_28d: 'not_tracked_for_gaining' }),
          opportunity_id: o.id,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: null,
      });
      b.emitted += 1;
      perSite.set(o.site_id, b);
    }

    const diags: RuleScopeDiagnostic[] = [];
    for (const site of ctx.sites) {
      const b = perSite.get(site.id);
      const d: RuleScopeDiagnostic = { scope: site.slug, status: 'no_data', items_emitted: 0 };
      if (!b) {
        if (gscCoverage.has(site.id)) {
          d.status = 'insufficient_data';
          d.reason = 'GSC coverage present but no gaining opportunity rows for this site';
        } else {
          d.status = 'no_data';
          d.reason = 'no GSC url+query coverage for this site in the last 35d';
        }
      } else {
        d.rows_examined = b.examined;
        d.rows_skipped_invalid = b.skipped;
        d.items_emitted = b.emitted;
        d.status = b.emitted > 0 ? 'signals_found' : 'no_signal';
        if (b.emitted === 0) d.reason = `${b.skipped}/${b.examined} gaining rows failed gates (prior ≥10 + current ≥20 + change ≥20%)`;
      }
      diags.push(d);
    }
    return { outputs, diagnostics: diags };
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

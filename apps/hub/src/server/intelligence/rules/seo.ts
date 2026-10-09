import 'server-only';

// SEO rules — ride on network_opportunities (deterministic GSC
// engine, already generates kind='striking_distance'|'low_ctr'|
// 'declining'|'gaining'|'zero_click'|'new_query'). The intelligence
// layer wraps that output with cross-domain priority scoring and
// expected-upside estimates.

import type { IntelligenceRule, RuleContext, RuleOutput } from '../types';

type OppRow = {
  id: string;
  site_id: string;
  kind: 'low_ctr' | 'striking_distance' | 'zero_click' | 'declining' | 'gaining' | 'new_query';
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

async function fetchOpenOpps(ctx: RuleContext): Promise<OppRow[]> {
  const { data, error } = await ctx.sb
    .from('network_opportunities')
    .select('id, site_id, kind, severity, page, query, title, description, evidence, metrics, status, first_seen_at, last_seen_at')
    .eq('status', 'open')
    .in('kind', ['striking_distance', 'low_ctr', 'declining', 'gaining']);
  if (error) throw new Error(`[rules/seo] fetch opps: ${error.message}`);
  return (data ?? []) as OppRow[];
}

// ─── A. Striking distance ─────────────────────────────────────
export const strikingDistanceRule: IntelligenceRule = {
  id: 'seo.striking_distance',
  description: 'Pages at position ~4-15 with meaningful impressions.',
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const opps = (await fetchOpenOpps(ctx)).filter((o) => o.kind === 'striking_distance');
    const out: RuleOutput[] = [];
    for (const o of opps) {
      const impressions = toNum(o.metrics['impressions_28d'] ?? o.metrics['impressions']);
      const clicks      = toNum(o.metrics['clicks_28d'] ?? o.metrics['clicks']);
      const position    = toNum(o.metrics['position_avg'] ?? o.metrics['avg_position']);
      const ctr         = impressions > 0 ? (clicks / impressions) : 0;

      // Impact scales with impressions (log-ish): 100 impressions → ~10,
      // 1k → ~45, 5k → ~75, 20k → ~95.
      const impact     = clamp(10 + 20 * Math.log10(Math.max(1, impressions / 100)));
      // Confidence rises with sample size.
      const confidence = clamp(40 + 15 * Math.log10(Math.max(1, impressions / 100)));
      // Urgency rises when position is on the brink of page 1.
      const urgency    = clamp(80 - Math.abs(position - 8) * 6);
      // Effort: metadata/internal links is relatively cheap.
      const effort     = 25;

      // Expected upside: moving the page from current CTR to a
      // conservative "band CTR" for the target position. Assume
      // 3-5% CTR floor for pos 4-10.
      const targetCtrLow  = 0.03;
      const targetCtrHigh = 0.05;
      const extraLow      = Math.max(0, Math.round((targetCtrLow  - ctr) * impressions));
      const extraHigh     = Math.max(0, Math.round((targetCtrHigh - ctr) * impressions));
      const site_slug = findSiteSlug(ctx, o.site_id);
      out.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:striking_distance:${site_slug ?? 'network'}:${o.page || o.query || o.id}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'striking_distance',
        signal_kind: 'opportunity',
        title: `Striking distance · ${site_slug ?? 'network'} · pos ${position.toFixed(1)}`,
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
          rationale: `Raising CTR from ${(ctr * 100).toFixed(1)}% to ${targetCtrLow * 100}-${targetCtrHigh * 100}% at current impressions.`,
        } : null,
      });
    }
    return out;
  },
};

// ─── B. High impressions, low CTR ─────────────────────────────
export const lowCtrRule: IntelligenceRule = {
  id: 'seo.low_ctr',
  description: 'High impressions, weak CTR for the page\'s position band.',
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const opps = (await fetchOpenOpps(ctx)).filter((o) => o.kind === 'low_ctr');
    const out: RuleOutput[] = [];
    for (const o of opps) {
      const impressions = toNum(o.metrics['impressions_28d'] ?? o.metrics['impressions']);
      const clicks      = toNum(o.metrics['clicks_28d'] ?? o.metrics['clicks']);
      const position    = toNum(o.metrics['position_avg'] ?? o.metrics['avg_position']);
      const expected    = toNum(o.metrics['expected_ctr'] ?? 0);
      const ctr         = impressions > 0 ? clicks / impressions : 0;
      // Only flag if the position itself is page-1-ish; low CTR at
      // pos 50 is irrelevant (handled by the underlying engine already).
      if (position > 15) continue;
      const impact     = clamp(10 + 22 * Math.log10(Math.max(1, impressions / 100)));
      const confidence = clamp(45 + 15 * Math.log10(Math.max(1, impressions / 100)));
      const urgency    = clamp(55 + (expected > 0 && ctr < expected * 0.5 ? 15 : 0));
      const effort     = 20;
      const targetCtr  = Math.max(expected * 0.9, 0.04);
      const uplift     = Math.max(0, Math.round((targetCtr - ctr) * impressions));
      const site_slug = findSiteSlug(ctx, o.site_id);
      out.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:low_ctr:${site_slug ?? 'network'}:${o.page || o.query || o.id}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'low_ctr',
        signal_kind: 'opportunity',
        title: `High impressions, weak CTR · ${site_slug ?? 'network'}`,
        summary: `${fmtImp(impressions)} impressions, CTR ${(ctr * 100).toFixed(2)}% at avg position ${position.toFixed(1)}. Page: ${trim(o.page, 70)}.`,
        recommended_action: 'Tighten title and meta description for the primary query; strengthen the on-page snippet / schema. Avoid rewriting if the page is already serving different intent.',
        evidence: {
          impressions_28d: impressions,
          clicks_28d: clicks,
          ctr,
          expected_ctr: expected,
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
    }
    return out;
  },
};

// ─── C. Declining page ────────────────────────────────────────
export const decliningRule: IntelligenceRule = {
  id: 'seo.declining',
  description: 'Page where clicks dropped materially vs prior period.',
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const opps = (await fetchOpenOpps(ctx)).filter((o) => o.kind === 'declining');
    const out: RuleOutput[] = [];
    for (const o of opps) {
      const clicks       = toNum(o.metrics['clicks_28d']);
      const priorClicks  = toNum(o.metrics['clicks_prior_28d']);
      const changePct    = priorClicks > 0 ? ((clicks - priorClicks) / priorClicks) * 100 : -100;
      const impressions  = toNum(o.metrics['impressions_28d']);
      const site_slug    = findSiteSlug(ctx, o.site_id);
      const dropMag      = Math.min(100, Math.abs(changePct));
      const impact       = clamp(30 + dropMag * 0.5 + 10 * Math.log10(Math.max(1, impressions / 100)));
      const confidence   = clamp(50 + 10 * Math.log10(Math.max(1, priorClicks / 10)));
      const urgency      = clamp(50 + dropMag * 0.4);
      const effort       = 45;
      out.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:declining:${site_slug ?? 'network'}:${o.page || o.id}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'declining',
        signal_kind: 'risk',
        title: `Declining page · ${site_slug ?? 'network'} (${changePct.toFixed(0)}%)`,
        summary: `Clicks dropped from ${priorClicks} to ${clicks} vs prior 28d (${changePct.toFixed(0)}%). Page: ${trim(o.page, 70)}.`,
        recommended_action: 'Audit for ranking loss, content freshness, SERP volatility, and index coverage. Refresh content, update dates, verify crawl + inspect in GSC.',
        evidence: {
          clicks_28d: clicks,
          clicks_prior_28d: priorClicks,
          change_pct: changePct,
          impressions_28d: impressions,
          page: o.page,
          opportunity_id: o.id,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: priorClicks > 10 ? {
          label: `recovering ~${Math.round(priorClicks - clicks)} lost clicks/28d`,
          metric: 'clicks_per_month',
          low: Math.round((priorClicks - clicks) * 0.5),
          high: Math.round(priorClicks - clicks),
          rationale: 'Full recovery would restore prior-period click volume.',
        } : null,
      });
    }
    return out;
  },
};

// ─── D. Gaining page ──────────────────────────────────────────
export const gainingRule: IntelligenceRule = {
  id: 'seo.gaining',
  description: 'Page where clicks grew materially vs prior period.',
  categoriesScanned: ['seo'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const opps = (await fetchOpenOpps(ctx)).filter((o) => o.kind === 'gaining');
    const out: RuleOutput[] = [];
    for (const o of opps) {
      const clicks       = toNum(o.metrics['clicks_28d']);
      const priorClicks  = toNum(o.metrics['clicks_prior_28d']);
      const changePct    = priorClicks > 0 ? ((clicks - priorClicks) / priorClicks) * 100 : 100;
      const impressions  = toNum(o.metrics['impressions_28d']);
      const site_slug    = findSiteSlug(ctx, o.site_id);
      const impact       = clamp(25 + Math.min(50, changePct * 0.3) + 10 * Math.log10(Math.max(1, impressions / 100)));
      const confidence   = clamp(50 + 10 * Math.log10(Math.max(1, clicks / 10)));
      const urgency      = clamp(30 + Math.min(30, changePct * 0.2));
      const effort       = 30;
      out.push({
        source_type: 'seo',
        source_id: o.id,
        source_key: `seo:gaining:${site_slug ?? 'network'}:${o.page || o.id}`,
        site_id: o.site_id,
        site_slug,
        category: 'seo',
        type: 'gaining',
        signal_kind: 'positive',
        title: `Gaining page · ${site_slug ?? 'network'} (+${changePct.toFixed(0)}%)`,
        summary: `Clicks grew from ${priorClicks} to ${clicks} vs prior 28d (+${changePct.toFixed(0)}%). Reinforce while momentum lasts.`,
        recommended_action: 'Reinforce with related internal links, surface the page in prominent hub positions, and watch for related long-tail queries worth capturing.',
        evidence: {
          clicks_28d: clicks,
          clicks_prior_28d: priorClicks,
          change_pct: changePct,
          impressions_28d: impressions,
          page: o.page,
          opportunity_id: o.id,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: null,
      });
    }
    return out;
  },
};

// ─── Helpers ──────────────────────────────────────────────────
function clamp(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }
function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}
function trim(s: string | null | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function fmtImp(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString();
}
function findSiteSlug(ctx: RuleContext, site_id: string | null): import('../types').SiteSlug | null {
  if (!site_id) return null;
  for (const s of ctx.sites) if (s.id === site_id) return s.slug;
  return null;
}

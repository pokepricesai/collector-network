import 'server-only';

// GROWTH rules — compare per-site 28d GSC clicks vs prior 28d.
// Positive AND negative movement counts. Requires enough sample
// (>= 200 clicks across the recent window) to avoid noise.

import type { IntelligenceRule, RuleContext, RuleOutput } from '../types';
import { getReportingTrafficWindow } from '@/server/reporting/traffic';

interface GscRow { site_id: string; date: string; clicks: number }

export const siteGrowthRule: IntelligenceRule = {
  id: 'growth.site_clicks',
  description: 'Per-site organic clicks moved materially vs prior 28d.',
  categoriesScanned: ['growth'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const dayMs = 24 * 60 * 60 * 1000;
    const now   = new Date(ctx.runAt);
    const endA  = new Date(now.getTime() - 1 * dayMs);
    const startA= new Date(endA.getTime() - 28 * dayMs);
    const endB  = new Date(startA.getTime() - 1 * dayMs);
    const startB= new Date(endB.getTime() - 28 * dayMs);
    const since = startB.toISOString().slice(0, 10);
    const until = endA.toISOString().slice(0, 10);

    const { data, error } = await ctx.sb
      .from('network_gsc_url_daily')
      .select('site_id, date, clicks')
      .gte('date', since)
      .lte('date', until)
      .limit(200000);
    if (error) throw new Error(`[rules/growth] fetch gsc: ${error.message}`);
    const rows = ((data ?? []) as GscRow[]);

    const bySite = new Map<string, { a: number; b: number }>();
    for (const r of rows) {
      const t = new Date(r.date).getTime();
      const bucket = bySite.get(r.site_id) ?? { a: 0, b: 0 };
      if (t >= startA.getTime() && t <= endA.getTime()) bucket.a += Number(r.clicks ?? 0);
      if (t >= startB.getTime() && t <= endB.getTime()) bucket.b += Number(r.clicks ?? 0);
      bySite.set(r.site_id, bucket);
    }

    const out: RuleOutput[] = [];
    for (const site of ctx.sites) {
      const b = bySite.get(site.id);
      if (!b) continue;
      if (b.a < 200) continue;                                       // sample floor
      const changeAbs = b.a - b.b;
      const changePct = b.b > 0 ? (changeAbs / b.b) * 100 : (b.a > 0 ? 100 : 0);
      if (Math.abs(changePct) < 20) continue;
      const up = changeAbs > 0;
      const impact     = clamp(35 + Math.min(45, Math.abs(changePct) * 0.4));
      const confidence = clamp(60 + Math.min(25, Math.log10(Math.max(1, b.a / 100)) * 10));
      const urgency    = up ? 25 : clamp(45 + Math.min(30, Math.abs(changePct) / 2));
      const effort     = up ? 20 : 55;
      out.push({
        source_type: 'traffic',
        source_id: null,
        source_key: `growth:site_clicks:${site.slug}`,
        site_id: site.id,
        site_slug: site.slug,
        category: 'growth',
        type: up ? 'site_growth_up' : 'site_growth_down',
        signal_kind: up ? 'positive' : 'risk',
        title: `${up ? '📈' : '📉'} ${site.slug} organic clicks ${up ? 'up' : 'down'} ${Math.abs(changePct).toFixed(0)}% vs prior 28d`,
        summary: `${b.b.toLocaleString()} → ${b.a.toLocaleString()} organic clicks across the full site.`,
        recommended_action: up
          ? 'Identify the pages driving growth; reinforce with internal links, surface the pages in prominent hub positions.'
          : 'Run a GSC coverage + ranking audit. Check for sitemap/indexing changes, SERP volatility, and content freshness.',
        evidence: {
          clicks_28d: b.a,
          clicks_prior_28d: b.b,
          change_abs: changeAbs,
          change_pct: changePct,
          window_recent: { from: startA.toISOString().slice(0, 10), to: endA.toISOString().slice(0, 10) },
          window_prior:  { from: startB.toISOString().slice(0, 10), to: endB.toISOString().slice(0, 10) },
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

// L (GA4 variant) — site traffic growth using Singapore-excluded
// reporting active-user-days. Parallel to siteGrowthRule which uses
// GSC clicks; both are legitimate signals and surface independently
// (different source_key prefixes). Honest about "active-user-days"
// not "unique users".
export const siteGrowthReportingRule: IntelligenceRule = {
  id: 'growth.site_reporting_traffic',
  description: 'Per-site reporting active-user-days (Singapore-excluded) moved materially vs prior 28d.',
  categoriesScanned: ['growth'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const dayMs = 24 * 60 * 60 * 1000;
    const now   = new Date(ctx.runAt);
    const endA  = new Date(now.getTime() - 1 * dayMs);
    const startA= new Date(endA.getTime() - 28 * dayMs);
    const endB  = new Date(startA.getTime() - 1 * dayMs);
    const startB= new Date(endB.getTime() - 28 * dayMs);
    const sinceA = startA.toISOString().slice(0, 10);
    const untilA = endA.toISOString().slice(0, 10);
    const sinceB = startB.toISOString().slice(0, 10);
    const untilB = endB.toISOString().slice(0, 10);

    const out: RuleOutput[] = [];
    for (const site of ctx.sites) {
      const [winA, winB] = await Promise.all([
        getReportingTrafficWindow(ctx.sb, { site_id: site.id, from: sinceA, to: untilA }),
        getReportingTrafficWindow(ctx.sb, { site_id: site.id, from: sinceB, to: untilB }),
      ]);
      // Sample floor.
      if (winA.active_users < 300) continue;
      // Only surface when BOTH windows have country-dimensioned
      // coverage. Fallback-only comparisons are already handled by
      // the GSC-based rule and would double-count noise.
      if (winA.days_filtered === 0 || winB.days_filtered === 0) continue;

      const changeAbs = winA.active_users - winB.active_users;
      const changePct = winB.active_users > 0 ? (changeAbs / winB.active_users) * 100 : 0;
      if (Math.abs(changePct) < 20) continue;

      const up = changeAbs > 0;
      const impact     = clamp(35 + Math.min(45, Math.abs(changePct) * 0.4));
      const confidence = clamp(60 + Math.min(25, Math.log10(Math.max(1, winA.active_users / 100)) * 10));
      const urgency    = up ? 25 : clamp(45 + Math.min(30, Math.abs(changePct) / 2));
      const effort     = up ? 20 : 55;

      out.push({
        source_type: 'traffic',
        source_id: null,
        source_key: `growth:site_reporting_traffic:${site.slug}`,
        site_id: site.id,
        site_slug: site.slug,
        category: 'growth',
        type: up ? 'site_reporting_traffic_up' : 'site_reporting_traffic_down',
        signal_kind: up ? 'positive' : 'risk',
        title: `${up ? '📈' : '📉'} ${site.slug} reporting active-user-days ${up ? 'up' : 'down'} ${Math.abs(changePct).toFixed(0)}% vs prior 28d`,
        summary: `${winB.active_users.toLocaleString()} → ${winA.active_users.toLocaleString()} reporting active-user-days (Singapore-excluded).`,
        recommended_action: up
          ? 'Investigate the sources of growth: new ranking terms, campaign effects, or a quality improvement. Reinforce by content/internal-links.'
          : 'Cross-check with GSC: is this a traffic drop or a tracking issue? Audit GA4 ingestion, country breakdown coverage, and recent deploys.',
        evidence: {
          reporting_active_user_days_recent: winA.active_users,
          reporting_active_user_days_prior:  winB.active_users,
          raw_active_user_days_recent: winA.raw_active_users,
          excluded_user_days_recent:   winA.excluded_users,
          change_abs: changeAbs,
          change_pct: changePct,
          window_recent: { from: sinceA, to: untilA },
          window_prior:  { from: sinceB, to: untilB },
          traffic_denominator: 'Singapore-excluded',
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

function clamp(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }

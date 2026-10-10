import 'server-only';

// REVENUE + MONETISATION rules.
//
// Reads network_revenue_daily — the canonical post-EPN-reset ledger
// of gross/refunds/net minor-unit amounts per (date, site, source,
// currency). Avoids pending vs confirmed accounting mistakes by
// operating on net_minor only.
//
// Phase 1.1: per-site diagnostics so operators can see whether a
// site has NO_DATA (ledger empty for the window) vs NO_SIGNAL
// (ledger has data, movement below material threshold).

import type {
  IntelligenceRule, RuleContext, RuleOutput, RuleRunResult, RuleScopeDiagnostic, SiteSlug,
} from '../types';
import { getReportingTrafficWindow } from '@/server/reporting/traffic';

interface DailyRow {
  for_date: string;
  site_id: string | null;
  source_id: string;
  currency: string;
  gross_minor: number;
  refunds_minor: number;
  net_minor: number;
  event_count: number;
}

interface GscRow {
  site_id: string;
  date: string;
  clicks: number;
}

export const revenueMovementRule: IntelligenceRule = {
  id: 'revenue.material_movement',
  description: 'Site revenue up or down materially vs prior 28d.',
  categoriesScanned: ['revenue'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const now = new Date(ctx.runAt);
    const dayMs   = 24 * 60 * 60 * 1000;
    const endA    = new Date(now.getTime() - 1 * dayMs);
    const startA  = new Date(endA.getTime() - 28 * dayMs);
    const endB    = new Date(startA.getTime() - 1 * dayMs);
    const startB  = new Date(endB.getTime() - 28 * dayMs);

    const since   = startB.toISOString().slice(0, 10);
    const until   = endA.toISOString().slice(0, 10);

    const { data, error } = await ctx.sb
      .from('network_revenue_daily')
      .select('for_date, site_id, source_id, currency, gross_minor, refunds_minor, net_minor, event_count')
      .gte('for_date', since)
      .lte('for_date', until)
      .limit(10000);
    if (error) {
      return { outputs: [], diagnostics: [{ scope: 'network', status: 'error', items_emitted: 0, error: error.message }] };
    }
    const rows = ((data ?? []) as DailyRow[]);

    interface Totals { a: number; b: number; a_days: number; b_days: number }
    const buckets = new Map<string, Totals>();
    const sitesSeen = new Set<string>();
    for (const r of rows) {
      if (r.site_id == null) continue;
      sitesSeen.add(r.site_id);
      const d = new Date(r.for_date).getTime();
      const inA = d >= startA.getTime() && d <= endA.getTime();
      const inB = d >= startB.getTime() && d <= endB.getTime();
      if (!inA && !inB) continue;
      const key = `${r.site_id}|${r.currency}`;
      const t = buckets.get(key) ?? { a: 0, b: 0, a_days: 0, b_days: 0 };
      if (inA) { t.a += r.net_minor; t.a_days += 1; }
      if (inB) { t.b += r.net_minor; t.b_days += 1; }
      buckets.set(key, t);
    }

    const outputs: RuleOutput[] = [];
    const emittedForSite = new Set<string>();
    const noSignalForSite = new Set<string>();
    for (const [key, t] of buckets) {
      const [site_id, currency] = key.split('|') as [string, string];
      const site_slug = findSiteSlug(ctx, site_id);
      if (t.a_days < 5 || t.b_days < 5) { noSignalForSite.add(site_id); continue; }
      const changeMinor = t.a - t.b;
      const changePct   = t.b > 0 ? (changeMinor / t.b) * 100 : (t.a > 0 ? 100 : 0);
      const absMinor    = Math.abs(changeMinor);
      if (changePct < 25 && changePct > -25) { noSignalForSite.add(site_id); continue; }
      if (absMinor < 1000) { noSignalForSite.add(site_id); continue; }
      if (t.a < 500 && t.b < 500) { noSignalForSite.add(site_id); continue; }

      const up = changeMinor > 0;
      const impact     = clamp(30 + Math.min(50, absMinor / 1000));
      const confidence = clamp(50 + Math.min(30, (t.a_days + t.b_days) / 2));
      const urgency    = clamp(up ? 30 : 55 + Math.min(30, Math.abs(changePct) / 2));
      const effort     = up ? 40 : 55;

      outputs.push({
        source_type: 'revenue',
        source_id: null,
        source_key: `revenue:movement:${site_slug ?? site_id}:${currency}`,
        site_id,
        site_slug,
        category: 'revenue',
        type: up ? 'revenue_up' : 'revenue_down',
        signal_kind: up ? 'positive' : 'risk',
        title: `${up ? '📈' : '📉'} ${currency} revenue ${up ? 'up' : 'down'} ${Math.abs(changePct).toFixed(0)}% · ${site_slug ?? 'site'}`,
        summary: `${currency} net revenue ${up ? 'rose' : 'fell'} from ${fmtMoney(t.b, currency)} to ${fmtMoney(t.a, currency)} comparing 28d-recent vs prior 28d.`,
        recommended_action: up
          ? 'Confirm this is sustainable (not a reversal reversal / backfill artefact). Reinforce whichever channel drove the gain.'
          : 'Check the canonical ledger per source. Rule out ingestion lag, policy reversals, or seasonal effects before acting.',
        evidence: {
          currency,
          net_minor_recent: t.a,
          net_minor_prior: t.b,
          change_minor: changeMinor,
          change_pct: changePct,
          window_recent: { from: startA.toISOString().slice(0, 10), to: endA.toISOString().slice(0, 10), days_observed: t.a_days },
          window_prior:  { from: startB.toISOString().slice(0, 10), to: endB.toISOString().slice(0, 10), days_observed: t.b_days },
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: null,
      });
      emittedForSite.add(site_id);
    }

    const diags: RuleScopeDiagnostic[] = [];
    for (const site of ctx.sites) {
      if (emittedForSite.has(site.id)) {
        diags.push({ scope: site.slug, status: 'signals_found', items_emitted: 1 });
      } else if (sitesSeen.has(site.id)) {
        diags.push({ scope: site.slug, status: 'no_signal', items_emitted: 0, reason: 'ledger has data; movement below ±25% / £10 / 5-day material thresholds' });
      } else {
        diags.push({ scope: site.slug, status: 'no_data', items_emitted: 0, reason: 'no network_revenue_daily rows for this site in the comparison window' });
      }
    }
    return { outputs, diagnostics: diags };
  },
};

export const trafficWithoutRevenueRule: IntelligenceRule = {
  id: 'monetisation.traffic_without_revenue',
  description: 'Site has traffic but minimal revenue in the canonical ledger (excludes pokemon which runs a separate pipeline).',
  categoriesScanned: ['monetisation'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const dayMs = 24 * 60 * 60 * 1000;
    const now   = new Date(ctx.runAt);
    const endA  = new Date(now.getTime() - 1 * dayMs);
    const startA= new Date(endA.getTime() - 28 * dayMs);
    const since = startA.toISOString().slice(0, 10);
    const until = endA.toISOString().slice(0, 10);

    const { data: clickRows } = await ctx.sb
      .from('network_gsc_url_daily')
      .select('site_id, date, clicks')
      .gte('date', since)
      .lte('date', until)
      .limit(100000);
    const clicksBySite = new Map<string, number>();
    for (const r of ((clickRows ?? []) as GscRow[])) {
      clicksBySite.set(r.site_id, (clicksBySite.get(r.site_id) ?? 0) + Number(r.clicks ?? 0));
    }

    const { data: revRows } = await ctx.sb
      .from('network_revenue_daily')
      .select('site_id, net_minor')
      .gte('for_date', since)
      .lte('for_date', until);
    const revBySite = new Map<string, number>();
    for (const r of ((revRows ?? []) as Pick<DailyRow, 'site_id' | 'net_minor'>[])) {
      if (!r.site_id) continue;
      revBySite.set(r.site_id, (revBySite.get(r.site_id) ?? 0) + Number(r.net_minor ?? 0));
    }

    const outputs: RuleOutput[] = [];
    const diags: RuleScopeDiagnostic[] = [];
    for (const site of ctx.sites) {
      const d: RuleScopeDiagnostic = { scope: site.slug, status: 'no_data', items_emitted: 0 };
      if (site.slug === 'pokemon') {
        d.status = 'skipped'; d.reason = 'pokemon runs a separate affiliate pipeline not yet in network_revenue_daily';
        diags.push(d); continue;
      }
      const clicks = clicksBySite.get(site.id) ?? 0;
      const rev    = revBySite.get(site.id) ?? 0;
      if (clicks === 0) {
        d.status = 'no_data'; d.reason = 'no GSC clicks in last 28d for this site';
        diags.push(d); continue;
      }
      if (clicks < 400) {
        d.status = 'no_signal'; d.reason = `clicks ${clicks} below sample floor 400`;
        diags.push(d); continue;
      }
      if (rev >= 10_000) {
        d.status = 'no_signal'; d.reason = `revenue ${rev} minor already non-trivial`;
        diags.push(d); continue;
      }
      const rpcInMinor = clicks > 0 ? rev / clicks : 0;
      const impact     = clamp(30 + Math.min(50, Math.log10(clicks) * 12));
      const confidence = clamp(55 + Math.min(25, Math.log10(clicks) * 6));
      const urgency    = 40;
      const effort     = 60;
      outputs.push({
        source_type: 'traffic',
        source_id: null,
        source_key: `monetisation:traffic_without_revenue:${site.slug}`,
        site_id: site.id,
        site_slug: site.slug,
        category: 'monetisation',
        type: 'traffic_without_revenue',
        signal_kind: 'opportunity',
        title: `Traffic without revenue · ${site.slug}`,
        summary: `${clicks.toLocaleString()} organic clicks in the last 28d but only ${fmtMoney(rev, 'minor')} tracked in network_revenue_daily. Revenue per click is near zero.`,
        recommended_action: 'Audit affiliate wiring + conversion flow. Verify EPN SharedId mapping, check click-tracking is live, review placements, confirm the ledger has not fallen behind.',
        evidence: {
          clicks_28d: clicks,
          revenue_net_minor_28d: rev,
          rpc_minor: rpcInMinor,
          currency: 'unmixed_minor',
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: null,
      });
      d.status = 'signals_found'; d.items_emitted = 1; diags.push(d);
    }
    return { outputs, diagnostics: diags };
  },
};

export const revenueEfficiencyRule: IntelligenceRule = {
  id: 'revenue.efficiency_movement',
  description: 'Revenue per 1,000 reporting active-user-days moved materially vs prior 28d.',
  categoriesScanned: ['revenue', 'monetisation'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const dayMs  = 24 * 60 * 60 * 1000;
    const now    = new Date(ctx.runAt);
    const endA   = new Date(now.getTime() - 1 * dayMs);
    const startA = new Date(endA.getTime() - 28 * dayMs);
    const endB   = new Date(startA.getTime() - 1 * dayMs);
    const startB = new Date(endB.getTime() - 28 * dayMs);
    const sinceA = startA.toISOString().slice(0, 10);
    const untilA = endA.toISOString().slice(0, 10);
    const sinceB = startB.toISOString().slice(0, 10);
    const untilB = endB.toISOString().slice(0, 10);

    const { data } = await ctx.sb
      .from('network_revenue_daily')
      .select('for_date, site_id, currency, net_minor')
      .gte('for_date', sinceB)
      .lte('for_date', untilA)
      .limit(10000);
    const rows = ((data ?? []) as Array<{ for_date: string; site_id: string | null; currency: string; net_minor: number }>);
    const bucket = new Map<string, { a: number; b: number }>();
    const sitesSeen = new Set<string>();
    for (const r of rows) {
      if (!r.site_id) continue;
      sitesSeen.add(r.site_id);
      const d = new Date(r.for_date).getTime();
      const inA = d >= startA.getTime() && d <= endA.getTime();
      const inB = d >= startB.getTime() && d <= endB.getTime();
      if (!inA && !inB) continue;
      const key = `${r.site_id}|${r.currency}`;
      const b = bucket.get(key) ?? { a: 0, b: 0 };
      if (inA) b.a += Number(r.net_minor ?? 0);
      if (inB) b.b += Number(r.net_minor ?? 0);
      bucket.set(key, b);
    }

    const outputs: RuleOutput[] = [];
    const emittedForSite = new Set<string>();
    const siteUserCache = new Map<string, { a: number; b: number }>();
    for (const [key, rev] of bucket) {
      const [site_id, currency] = key.split('|') as [string, string];
      if (!siteUserCache.has(site_id)) {
        const [winA, winB] = await Promise.all([
          getReportingTrafficWindow(ctx.sb, { site_id, from: sinceA, to: untilA }),
          getReportingTrafficWindow(ctx.sb, { site_id, from: sinceB, to: untilB }),
        ]);
        siteUserCache.set(site_id, { a: winA.active_users, b: winB.active_users });
      }
      const users = siteUserCache.get(site_id)!;
      if (users.a < 200 || users.b < 200) continue;
      if (rev.a < 100 && rev.b < 100) continue;
      const rpkuA = users.a > 0 ? (rev.a / users.a) * 1000 : 0;
      const rpkuB = users.b > 0 ? (rev.b / users.b) * 1000 : 0;
      if (rpkuB <= 0 && rpkuA <= 0) continue;
      const changePct = rpkuB > 0 ? ((rpkuA - rpkuB) / rpkuB) * 100 : 100;
      if (Math.abs(changePct) < 20) continue;

      const up = rpkuA > rpkuB;
      const site_slug = findSiteSlug(ctx, site_id);
      const impact     = clamp(30 + Math.min(50, Math.abs(changePct) * 0.4));
      const confidence = clamp(60 + Math.min(25, Math.log10(Math.max(1, users.a / 100)) * 10));
      const urgency    = up ? 30 : clamp(45 + Math.min(30, Math.abs(changePct) / 2));
      const effort     = up ? 40 : 55;

      outputs.push({
        source_type: 'revenue',
        source_id: null,
        source_key: `revenue:efficiency:${site_slug ?? site_id}:${currency}`,
        site_id,
        site_slug,
        category: 'monetisation',
        type: up ? 'rpku_up' : 'rpku_down',
        signal_kind: up ? 'positive' : 'risk',
        title: `${up ? '📈' : '📉'} RPKU ${up ? 'up' : 'down'} ${Math.abs(changePct).toFixed(0)}% · ${site_slug ?? 'site'} · ${currency}`,
        summary: `${currency} revenue per 1,000 reporting active-user-days ${up ? 'rose' : 'fell'} from ${fmtMoney(Math.round(rpkuB), currency)} to ${fmtMoney(Math.round(rpkuA), currency)} vs prior 28d. Denominator excludes Singapore bot/spam traffic.`,
        recommended_action: up
          ? 'Identify what changed in placement/intent-match/offer mix. Reinforce the winning path.'
          : 'Audit affiliate placements, offer freshness, click-tracking integrity, and traffic quality. Rule out revenue-ingest lag first (operates on net_minor).',
        evidence: {
          currency,
          rpku_recent_minor: Math.round(rpkuA),
          rpku_prior_minor: Math.round(rpkuB),
          change_pct: changePct,
          net_minor_recent: rev.a,
          net_minor_prior:  rev.b,
          reporting_active_user_days_recent: users.a,
          reporting_active_user_days_prior:  users.b,
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
      emittedForSite.add(site_id);
    }

    const diags: RuleScopeDiagnostic[] = [];
    for (const site of ctx.sites) {
      if (emittedForSite.has(site.id)) diags.push({ scope: site.slug, status: 'signals_found', items_emitted: 1 });
      else if (sitesSeen.has(site.id)) diags.push({ scope: site.slug, status: 'no_signal', items_emitted: 0, reason: 'ledger has data but either user sample or RPKU movement below threshold' });
      else diags.push({ scope: site.slug, status: 'no_data', items_emitted: 0, reason: 'no revenue + traffic data available for both windows' });
    }
    return { outputs, diagnostics: diags };
  },
};

function clamp(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }
function fmtMoney(minor: number, currency: string): string {
  const whole = minor / 100;
  if (currency === 'minor') return `${minor.toLocaleString()} minor units`;
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
  return `${symbol}${whole.toFixed(2)}`;
}
function findSiteSlug(ctx: RuleContext, site_id: string): SiteSlug | null {
  for (const s of ctx.sites) if (s.id === site_id) return s.slug;
  return null;
}

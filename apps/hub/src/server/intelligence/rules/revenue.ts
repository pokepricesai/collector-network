import 'server-only';

// REVENUE + MONETISATION rules.
//
// Reads network_revenue_daily — the canonical post-EPN-reset ledger
// of gross/refunds/net minor-unit amounts per (date, site, source,
// currency). Avoids pending vs confirmed accounting mistakes by
// operating on net_minor only.

import type { IntelligenceRule, RuleContext, RuleOutput, SiteSlug } from '../types';

interface DailyRow {
  for_date: string;      // ISO
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

// Compare net revenue in the most recent complete 28d window against
// the prior 28d. Flag material movement per site + currency. A
// movement needs ≥ a minimum absolute amount AND ≥ a minimum % to
// avoid noise.
export const revenueMovementRule: IntelligenceRule = {
  id: 'revenue.material_movement',
  description: 'Site revenue up or down materially vs prior 28d.',
  categoriesScanned: ['revenue'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const now = new Date(ctx.runAt);
    // Prior 28d ends 1 day before the recent window starts to avoid
    // overlap. Both windows close at today - 1 (so immature today's
    // partial data doesn't bias the comparison).
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
    if (error) throw new Error(`[rules/revenue] fetch daily: ${error.message}`);
    const rows = ((data ?? []) as DailyRow[]);

    // Group by (site_id, currency). Compare A vs B.
    interface Totals { a: number; b: number; a_days: number; b_days: number }
    const buckets = new Map<string, Totals>();
    for (const r of rows) {
      if (r.site_id == null) continue;                      // ignore unassigned
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

    const out: RuleOutput[] = [];
    for (const [key, t] of buckets) {
      const [site_id, currency] = key.split('|') as [string, string];
      const site_slug = findSiteSlug(ctx, site_id);
      // Need at least some observations in both windows to compare.
      if (t.a_days < 5 || t.b_days < 5) continue;
      const changeMinor = t.a - t.b;
      const changePct   = t.b > 0 ? (changeMinor / t.b) * 100 : (t.a > 0 ? 100 : 0);
      const absMinor    = Math.abs(changeMinor);
      // Threshold: materially different means >= 25% change AND >=
      // 10 (minor units × 100 = whole currency units; here 10 is 10
      // GBP/USD/EUR). Both windows need to have made at least ~5
      // currency units each to avoid dividing by near-zero.
      if (changePct < 25 && changePct > -25) continue;
      if (absMinor < 1000) continue;
      if (t.a < 500 && t.b < 500) continue;

      const up = changeMinor > 0;
      const impact     = clamp(30 + Math.min(50, absMinor / 1000));
      const confidence = clamp(50 + Math.min(30, (t.a_days + t.b_days) / 2));
      const urgency    = clamp(up ? 30 : 55 + Math.min(30, Math.abs(changePct) / 2));
      const effort     = up ? 40 : 55;

      out.push({
        source_type: 'revenue',
        source_id: null,
        source_key: `revenue:movement:${site_slug ?? site_id}:${currency}`,
        site_id,
        site_slug,
        category: 'revenue',
        type: up ? 'revenue_up' : 'revenue_down',
        tone: up ? 'positive' : 'risk',
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
    }
    return out;
  },
};

// H. Traffic without revenue. Flag sites with meaningful GSC clicks
// but very low revenue in the same 28d window. Conservative: skip
// when GSC clicks aren't > 400 for the window; skip for Pokemon
// (external monetisation, revenue not in this ledger).
export const trafficWithoutRevenueRule: IntelligenceRule = {
  id: 'monetisation.traffic_without_revenue',
  description: 'Site has traffic but minimal revenue in the canonical ledger.',
  categoriesScanned: ['monetisation'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const dayMs = 24 * 60 * 60 * 1000;
    const now   = new Date(ctx.runAt);
    const endA  = new Date(now.getTime() - 1 * dayMs);
    const startA= new Date(endA.getTime() - 28 * dayMs);
    const since = startA.toISOString().slice(0, 10);
    const until = endA.toISOString().slice(0, 10);

    // Fetch clicks by site.
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

    // Fetch revenue by site (any currency).
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

    const out: RuleOutput[] = [];
    for (const site of ctx.sites) {
      // Pokemon runs its own affiliate pipeline that is NOT yet in
      // network_revenue_daily. Skip to avoid false positives.
      if (site.slug === 'pokemon') continue;
      const clicks = clicksBySite.get(site.id) ?? 0;
      const rev    = revBySite.get(site.id) ?? 0;
      if (clicks < 400) continue;                         // low sample
      if (rev >= 10_000) continue;                        // non-trivial revenue
      const rpcInMinor = clicks > 0 ? rev / clicks : 0;    // revenue per click (minor)
      const impact     = clamp(30 + Math.min(50, Math.log10(clicks) * 12));
      const confidence = clamp(55 + Math.min(25, Math.log10(clicks) * 6));
      const urgency    = 40;
      const effort     = 60;
      out.push({
        source_type: 'traffic',
        source_id: null,
        source_key: `monetisation:traffic_without_revenue:${site.slug}`,
        site_id: site.id,
        site_slug: site.slug,
        category: 'monetisation',
        type: 'traffic_without_revenue',
        tone: 'opportunity',
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
    }
    return out;
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

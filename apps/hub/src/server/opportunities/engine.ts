import 'server-only';

// Deterministic SEO Opportunity Engine v1.
//
// Reads 28-day rollups out of network_gsc_url_query_daily (plus a
// 7-day window for the gain/decline rules) and generates up to six
// classes of opportunity:
//
//   • low_ctr            — high impressions, low CTR for the page's
//                          position band
//   • striking_distance  — position 4–20 with ≥50 impressions over 28d
//   • zero_click         — >= 500 impressions on a page/query combo
//                          with zero clicks over 28d
//   • declining          — clicks on a page down ≥ 30% vs prior 28d
//   • gaining            — clicks on a page up ≥ 30% vs prior 28d
//                          AND >= 50 clicks in current 28d
//   • new_query          — a query first appeared in the trailing 7d
//                          with ≥ 20 impressions
//
// Thresholds are intentionally conservative. The combo-table rowcap
// (25k rows per day per site at the GSC rowLimit) means the 28d set
// stays bounded.

import type { SupabaseClient } from '@supabase/supabase-js';

export type OpportunityKind =
  | 'low_ctr'
  | 'striking_distance'
  | 'zero_click'
  | 'declining'
  | 'gaining'
  | 'new_query';

const KIND_LABEL: Record<OpportunityKind, string> = {
  low_ctr: 'Low CTR for position',
  striking_distance: 'Striking distance',
  zero_click: 'Impressions, no clicks',
  declining: 'Declining',
  gaining: 'Gaining',
  new_query: 'New query',
};

const LOW_CTR_EXPECTED: Record<string, number> = {
  // Position band → expected CTR (loose industry anchor). We flag
  // when actual CTR is < 50% of expected.
  '1-3':  0.25,
  '4-10': 0.08,
};

type Priority = 'critical' | 'high' | 'normal' | 'low';

interface UrlQueryAgg {
  site_id: string;
  page: string;
  query: string;
  clicks: number;
  impressions: number;
  position_avg: number;
}

interface PageAgg {
  site_id: string;
  page: string;
  clicks: number;
  impressions: number;
}

async function fetchAggregates(
  sb: SupabaseClient,
  windowStart: string,
  windowEnd: string,
  priorStart?: string,
  priorEnd?: string,
  pageSize = 1000,
): Promise<{ urlQuery: UrlQueryAgg[]; priorUrlQuery: UrlQueryAgg[]; page: PageAgg[]; priorPage: PageAgg[] }> {
  // We rely on Postgres aggregation via rpc for performance. Use
  // simple SELECTs with group-by expressed through filters/head.
  // Pull paginated raw rows and aggregate in memory to avoid an
  // extra SQL function. 28d x urls x queries is bounded (max ~
  // 700k rows for pokeprices; much less for the other four).

  async function fetchAll(from: string, to: string): Promise<UrlQueryAgg[]> {
    const out: UrlQueryAgg[] = [];
    let start = 0;
    for (;;) {
      const { data, error } = await sb
        .from('network_gsc_url_query_daily')
        .select('site_id,page,query,clicks,impressions,position_avg')
        .gte('date', from).lte('date', to)
        .range(start, start + pageSize - 1);
      if (error) throw new Error(`[opp] fetch aggs: ${error.message}`);
      const rows = (data ?? []) as unknown as UrlQueryAgg[];
      out.push(...rows);
      if (rows.length < pageSize) break;
      start += pageSize;
      if (start > 2_000_000) break; // sanity cap
    }
    return out;
  }

  const urlQueryRaw = await fetchAll(windowStart, windowEnd);
  const priorRaw = priorStart && priorEnd ? await fetchAll(priorStart, priorEnd) : [];

  function aggregateUrlQuery(rows: UrlQueryAgg[]): UrlQueryAgg[] {
    const key = (r: UrlQueryAgg) => `${r.site_id}|${r.page}|${r.query}`;
    const acc = new Map<string, UrlQueryAgg & { posWeight: number }>();
    for (const r of rows) {
      const k = key(r);
      const prev = acc.get(k);
      if (!prev) {
        acc.set(k, {
          site_id: r.site_id, page: r.page, query: r.query,
          clicks: r.clicks, impressions: r.impressions,
          position_avg: (r.position_avg ?? 0) * r.impressions,
          posWeight: r.impressions,
        });
      } else {
        prev.clicks += r.clicks;
        prev.impressions += r.impressions;
        prev.position_avg += (r.position_avg ?? 0) * r.impressions;
        prev.posWeight += r.impressions;
      }
    }
    return [...acc.values()].map((r) => ({
      site_id: r.site_id, page: r.page, query: r.query,
      clicks: r.clicks, impressions: r.impressions,
      position_avg: r.posWeight > 0 ? r.position_avg / r.posWeight : 0,
    }));
  }

  function aggregatePage(rows: UrlQueryAgg[]): PageAgg[] {
    const acc = new Map<string, PageAgg>();
    for (const r of rows) {
      const k = `${r.site_id}|${r.page}`;
      const prev = acc.get(k);
      if (!prev) {
        acc.set(k, {
          site_id: r.site_id, page: r.page,
          clicks: r.clicks, impressions: r.impressions,
        });
      } else {
        prev.clicks += r.clicks;
        prev.impressions += r.impressions;
      }
    }
    return [...acc.values()];
  }

  return {
    urlQuery: aggregateUrlQuery(urlQueryRaw),
    priorUrlQuery: aggregateUrlQuery(priorRaw),
    page: aggregatePage(urlQueryRaw),
    priorPage: aggregatePage(priorRaw),
  };
}

interface GeneratedOpp {
  site_id: string;
  kind: OpportunityKind;
  page: string;
  query: string;
  severity: Priority;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  metrics: Record<string, unknown>;
}

function positionBand(p: number): '1-3' | '4-10' | '11+' {
  if (p < 3.5) return '1-3';
  if (p < 10.5) return '4-10';
  return '11+';
}

function priorityForImpressions(imp: number): Priority {
  if (imp >= 10_000) return 'high';
  if (imp >= 2_000) return 'normal';
  return 'low';
}

export async function generateOpportunities(
  sb: SupabaseClient,
  today: Date,
): Promise<{ generated: number; updated: number; dismissedStale: number }> {
  const end28 = new Date(today);
  end28.setUTCDate(end28.getUTCDate() - 1);
  const start28 = new Date(end28);
  start28.setUTCDate(start28.getUTCDate() - 27);
  const priorEnd = new Date(start28);
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorStart.getUTCDate() - 27);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const { urlQuery, priorUrlQuery, page, priorPage } = await fetchAggregates(
    sb, iso(start28), iso(end28), iso(priorStart), iso(priorEnd),
  );

  const opps: GeneratedOpp[] = [];

  // 1. Low CTR for position
  for (const r of urlQuery) {
    if (r.impressions < 500) continue;
    const band = positionBand(r.position_avg);
    const expected = LOW_CTR_EXPECTED[band];
    if (!expected) continue;
    const ctr = r.clicks / r.impressions;
    if (ctr < expected * 0.5) {
      opps.push({
        site_id: r.site_id, kind: 'low_ctr',
        page: r.page, query: r.query,
        severity: priorityForImpressions(r.impressions),
        title: `Low CTR on "${r.query}" at position ${r.position_avg.toFixed(1)}`,
        description: `Over the last 28 days this page attracted ${r.impressions.toLocaleString()} impressions for "${r.query}" at avg position ${r.position_avg.toFixed(1)}, but only ${r.clicks.toLocaleString()} clicks (CTR ${(ctr * 100).toFixed(2)}%). Expected CTR for this position band is ~${(expected * 100).toFixed(0)}%. Rewriting the title/meta is likely to lift CTR substantially.`,
        evidence: { position_band: band, expected_ctr: expected, observed_ctr: ctr },
        metrics: { impressions_28d: r.impressions, clicks_28d: r.clicks, position_28d: r.position_avg },
      });
    }
  }

  // 2. Striking distance (position 4–20 with ≥50 impressions)
  for (const r of urlQuery) {
    if (r.impressions < 50) continue;
    if (r.position_avg < 4 || r.position_avg > 20) continue;
    opps.push({
      site_id: r.site_id, kind: 'striking_distance',
      page: r.page, query: r.query,
      severity: priorityForImpressions(r.impressions * 2),
      title: `Striking distance: "${r.query}" at position ${r.position_avg.toFixed(1)}`,
      description: `"${r.query}" sits at avg position ${r.position_avg.toFixed(1)} with ${r.impressions.toLocaleString()} impressions over the last 28 days (${r.clicks} clicks). A small ranking lift could land this on page 1.`,
      evidence: { position_28d: r.position_avg },
      metrics: { impressions_28d: r.impressions, clicks_28d: r.clicks, position_28d: r.position_avg },
    });
  }

  // 3. Zero-click (≥500 impressions, zero clicks)
  for (const r of urlQuery) {
    if (r.impressions < 500) continue;
    if (r.clicks !== 0) continue;
    opps.push({
      site_id: r.site_id, kind: 'zero_click',
      page: r.page, query: r.query,
      severity: r.impressions >= 2000 ? 'high' : 'normal',
      title: `${r.impressions.toLocaleString()} impressions, zero clicks for "${r.query}"`,
      description: `This page/query combo accumulated ${r.impressions.toLocaleString()} impressions over the last 28 days without a single click. The title/meta is almost certainly not matching user intent.`,
      evidence: { position_28d: r.position_avg },
      metrics: { impressions_28d: r.impressions, clicks_28d: 0, position_28d: r.position_avg },
    });
  }

  // 4+5. Declining / gaining pages (page-level)
  const priorByPage = new Map<string, PageAgg>();
  for (const p of priorPage) priorByPage.set(`${p.site_id}|${p.page}`, p);
  for (const p of page) {
    const prior = priorByPage.get(`${p.site_id}|${p.page}`);
    if (!prior) continue;
    if (prior.clicks < 20) continue; // ignore tiny baselines
    const delta = (p.clicks - prior.clicks) / prior.clicks;
    if (delta <= -0.3) {
      opps.push({
        site_id: p.site_id, kind: 'declining',
        page: p.page, query: '',
        severity: priorityForImpressions(prior.clicks * 20),
        title: `Declining: clicks down ${Math.round(Math.abs(delta) * 100)}%`,
        description: `This page has lost ${Math.round(Math.abs(delta) * 100)}% of its Google clicks over the last 28 days vs the prior 28 (${prior.clicks} → ${p.clicks}). Investigate ranking losses or content decay.`,
        evidence: { prior_clicks: prior.clicks, current_clicks: p.clicks, delta },
        metrics: { clicks_28d: p.clicks, clicks_prior_28d: prior.clicks, change: delta },
      });
    } else if (delta >= 0.3 && p.clicks >= 50) {
      opps.push({
        site_id: p.site_id, kind: 'gaining',
        page: p.page, query: '',
        severity: 'normal',
        title: `Gaining: clicks up ${Math.round(delta * 100)}%`,
        description: `This page is up ${Math.round(delta * 100)}% in Google clicks over the last 28 days vs the prior 28 (${prior.clicks} → ${p.clicks}). Consider doubling down on this topic (internal links, related content).`,
        evidence: { prior_clicks: prior.clicks, current_clicks: p.clicks, delta },
        metrics: { clicks_28d: p.clicks, clicks_prior_28d: prior.clicks, change: delta },
      });
    }
  }

  // 6. New query (last 7 days, not seen in prior 21)
  const seven = new Date(today);
  seven.setUTCDate(seven.getUTCDate() - 1);
  const start7 = new Date(seven);
  start7.setUTCDate(start7.getUTCDate() - 6);
  const start21 = new Date(start7);
  start21.setUTCDate(start21.getUTCDate() - 1);
  const prior21Start = new Date(start21);
  prior21Start.setUTCDate(prior21Start.getUTCDate() - 20);
  const recentRaw = await (async () => {
    const { data, error } = await sb
      .from('network_gsc_url_query_daily')
      .select('site_id,page,query,clicks,impressions,position_avg')
      .gte('date', iso(start7)).lte('date', iso(seven));
    if (error) throw new Error(`[opp] fetch recent 7d: ${error.message}`);
    return (data ?? []) as unknown as UrlQueryAgg[];
  })();
  const priorKeys = new Set(priorUrlQuery.map((r) => `${r.site_id}|${r.page}|${r.query}`));
  const current28Keys = new Set(urlQuery.filter((r) => r.impressions >= 1).map((r) => `${r.site_id}|${r.page}|${r.query}`));
  // Group recent raw by key
  const recent = new Map<string, { site_id: string; page: string; query: string; impressions: number; clicks: number }>();
  for (const r of recentRaw) {
    const k = `${r.site_id}|${r.page}|${r.query}`;
    const prev = recent.get(k);
    if (!prev) recent.set(k, { site_id: r.site_id, page: r.page, query: r.query, impressions: r.impressions, clicks: r.clicks });
    else { prev.impressions += r.impressions; prev.clicks += r.clicks; }
  }
  for (const [k, r] of recent) {
    if (r.impressions < 20) continue;
    if (priorKeys.has(k)) continue;
    // Also require the key WAS seen in 28d (should be — recent is a subset)
    if (!current28Keys.has(k)) continue;
    opps.push({
      site_id: r.site_id, kind: 'new_query',
      page: r.page, query: r.query,
      severity: 'normal',
      title: `New query: "${r.query}"`,
      description: `"${r.query}" started showing impressions in the last 7 days (${r.impressions} impressions, ${r.clicks} clicks) and did not appear in the prior 28. Consider explicitly targeting this phrase.`,
      evidence: { impressions_7d: r.impressions, clicks_7d: r.clicks },
      metrics: { impressions_7d: r.impressions, clicks_7d: r.clicks },
    });
  }

  // ---- Dedupe within same (site, kind, page, query) ---------------
  const dedup = new Map<string, GeneratedOpp>();
  for (const o of opps) {
    const k = `${o.site_id}|${o.kind}|${o.page}|${o.query}`;
    // Keep the highest-severity occurrence if duplicates (shouldn't happen often)
    const prev = dedup.get(k);
    if (!prev) dedup.set(k, o);
  }
  const final = [...dedup.values()];

  // ---- Upsert into network_opportunities --------------------------
  const now = new Date().toISOString();
  let generated = 0;
  let updated = 0;
  const seenKeys = new Set<string>();
  for (const o of final) {
    seenKeys.add(`${o.site_id}|${o.kind}|${o.page}|${o.query}`);
    const { data: existing } = await sb
      .from('network_opportunities')
      .select('id, status, task_id')
      .eq('site_id', o.site_id).eq('kind', o.kind)
      .eq('page', o.page).eq('query', o.query)
      .maybeSingle();
    if (!existing) {
      const { error } = await sb.from('network_opportunities').insert({
        site_id: o.site_id, kind: o.kind, page: o.page, query: o.query,
        severity: o.severity, title: o.title, description: o.description,
        evidence: o.evidence, metrics: o.metrics,
        first_seen_at: now, last_seen_at: now,
      });
      if (error) throw new Error(`[opp] insert: ${error.message}`);
      generated++;
    } else {
      // Refresh last_seen_at + metrics; preserve status/task_id/dismissed_*.
      const { error } = await sb.from('network_opportunities')
        .update({
          severity: o.severity, title: o.title, description: o.description,
          evidence: o.evidence, metrics: o.metrics, last_seen_at: now,
          // If an opportunity was 'stale' and reappears, revive to 'open'
          // unless it has been actioned or dismissed.
          status: (existing as { status: string }).status === 'stale' ? 'open' : (existing as { status: string }).status,
        })
        .eq('id', (existing as { id: string }).id);
      if (error) throw new Error(`[opp] update: ${error.message}`);
      updated++;
    }
  }

  // Mark currently-open opportunities that we did NOT re-emit this run as 'stale'.
  const { data: openRows } = await sb
    .from('network_opportunities')
    .select('id, site_id, kind, page, query, status')
    .eq('status', 'open');
  let dismissedStale = 0;
  for (const row of (openRows ?? []) as Array<{ id: string; site_id: string; kind: string; page: string; query: string }>) {
    const k = `${row.site_id}|${row.kind}|${row.page}|${row.query}`;
    if (!seenKeys.has(k)) {
      await sb.from('network_opportunities').update({ status: 'stale', last_seen_at: now }).eq('id', row.id);
      dismissedStale++;
    }
  }

  return { generated, updated, dismissedStale };
}

export function kindLabel(k: string): string {
  return KIND_LABEL[k as OpportunityKind] ?? k;
}

import 'server-only';

// Daily operating brief engine.
//
// Deterministic composition of three sections:
//
//   1. NETWORK YESTERDAY   — users, sessions, Google clicks + impressions
//                            (yesterday's day only; GSC may be behind so
//                            we fall back to the latest available date)
//   2. NOTABLE CHANGES     — a bounded list of signal-driven observations:
//                            clicks jump, drop; new high-impression
//                            pages; stale feeds; new SEO opps
//   3. TODAY'S RECOMMENDED ACTIONS — top 5 pulled from:
//                            critical alerts, high-priority SEO opps,
//                            internal-link opps, stale feeds, pending
//                            tasks
//
// No LLM involved. Scoring is transparent; the UI explains why each
// item made the cut.

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchNetworkTotal, fetchSiteLevel, priorWindow, windowDaysAgo, iso } from '../analytics/dashboard';
import type { DashboardTotals, SiteLevel } from '../analytics/dashboard';

export interface BriefMetrics {
  yesterday: DashboardTotals & { date: string | null };
  priorDay: DashboardTotals & { date: string | null };
  windowDaily: DashboardTotals;
  priorWindowDaily: DashboardTotals;
  byDirectSite: SiteLevel[];
}

export interface NotableChange {
  id: string;
  kind: 'traffic_up' | 'traffic_down' | 'new_opportunity' | 'stale_feed'
      | 'sitemap_issue' | 'content_gap' | 'cannibalisation' | 'new_query_surge';
  severity: 'critical' | 'high' | 'normal' | 'low' | 'info';
  title: string;
  description: string;
  siteSlug?: string;
  evidence?: Record<string, unknown>;
  link?: string;
}

export interface RecommendedAction {
  id: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  title: string;
  description: string;
  siteSlug?: string;
  source: 'alert' | 'opportunity' | 'internal_link' | 'page_opportunity' | 'stale_feed' | 'sitemap' | 'inspection' | 'content_gap' | 'cannibalisation' | 'task';
  link: string;
  priorityScore: number; // transparent numeric score for ordering
  reasoning: string;     // one-liner explaining the ranking
}

export interface Brief {
  forDate: string;
  metrics: BriefMetrics;
  notable: NotableChange[];
  actions: RecommendedAction[];
  countsByCategory: Record<string, number>;
}

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 100,
  high: 60,
  normal: 25,
  low: 10,
};

export async function fetchDayTotals(sb: SupabaseClient, date: string): Promise<DashboardTotals & { date: string | null }> {
  const { data: gscRows } = await sb
    .from('network_gsc_site_daily')
    .select('date, clicks, impressions, pages_with_impressions, pages_with_clicks, position_avg')
    .eq('date', date);
  // Reporting-traffic (Singapore-excluded by default). Falls back to
  // raw network_ga4_site_daily if country breakdown is missing for
  // this date.
  const { getReportingTrafficDaily } = await import('@/server/reporting/traffic');
  const gaRows = await getReportingTrafficDaily(sb, { site_id: null, from: date, to: date });
  let clicks = 0, impressions = 0, pwi = 0, pwc = 0;
  let posWeightNum = 0, posWeightDen = 0;
  for (const r of (gscRows ?? []) as Array<{ clicks: number; impressions: number; pages_with_impressions: number; pages_with_clicks: number; position_avg: number | null }>) {
    clicks += r.clicks; impressions += r.impressions;
    pwi += r.pages_with_impressions; pwc += r.pages_with_clicks;
    if (r.position_avg != null) {
      posWeightNum += r.impressions * r.position_avg;
      posWeightDen += r.impressions;
    }
  }
  let users = 0, sessions = 0;
  for (const r of gaRows) {
    users += r.active_users; sessions += r.sessions;
  }
  return {
    date,
    googleClicks: clicks,
    googleImpressions: impressions,
    pagesWithImpressions: pwi,
    pagesWithClicks: pwc,
    avgPosition: posWeightDen > 0 ? posWeightNum / posWeightDen : null,
    activeUsers: users,
    sessions,
  };
}

async function latestDataDate(sb: SupabaseClient, table: 'network_gsc_site_daily' | 'network_ga4_site_daily'): Promise<string | null> {
  const { data } = await sb.from(table).select('date').order('date', { ascending: false }).limit(1).maybeSingle();
  return (data as { date: string } | null)?.date ?? null;
}

async function fetchMetrics(sb: SupabaseClient, today: Date): Promise<BriefMetrics> {
  const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const [latestGsc, latestGa4] = await Promise.all([
    latestDataDate(sb, 'network_gsc_site_daily'),
    latestDataDate(sb, 'network_ga4_site_daily'),
  ]);
  const yesterdayIso = iso(yesterday);
  // Use the latest available GSC date (data lands ~2–3 days behind) as
  // the "yesterday" anchor for Google numbers. For GA4 use its own
  // latest date. If both missing fall back to iso(yesterday).
  const anchor = latestGsc ?? latestGa4 ?? yesterdayIso;
  const anchorDate = new Date(anchor);
  const priorAnchor = new Date(anchorDate); priorAnchor.setUTCDate(priorAnchor.getUTCDate() - 1);

  const [day, prior, win28, prior28, byDirectSite] = await Promise.all([
    fetchDayTotals(sb, anchor),
    fetchDayTotals(sb, iso(priorAnchor)),
    fetchNetworkTotal(sb, windowDaysAgo(today, 28)),
    fetchNetworkTotal(sb, priorWindow(windowDaysAgo(today, 28))),
    fetchSiteLevel(sb, windowDaysAgo(today, 28)),
  ]);
  return {
    yesterday: day,
    priorDay: prior,
    windowDaily: win28,
    priorWindowDaily: prior28,
    byDirectSite,
  };
}

async function findNotable(sb: SupabaseClient, metrics: BriefMetrics): Promise<NotableChange[]> {
  const notable: NotableChange[] = [];

  // 1. Significant day-over-day change in network clicks.
  const curr = metrics.yesterday.googleClicks;
  const prev = metrics.priorDay.googleClicks;
  if (prev > 10) {
    const delta = (curr - prev) / prev;
    if (delta >= 0.3) {
      notable.push({
        id: `traffic_up:${metrics.yesterday.date}`,
        kind: 'traffic_up',
        severity: 'info',
        title: `Google clicks up ${Math.round(delta * 100)}% day-over-day`,
        description: `Yesterday: ${curr.toLocaleString()} clicks (vs ${prev.toLocaleString()} on the prior day).`,
        evidence: { curr, prev, delta },
      });
    } else if (delta <= -0.3) {
      notable.push({
        id: `traffic_down:${metrics.yesterday.date}`,
        kind: 'traffic_down',
        severity: 'high',
        title: `Google clicks down ${Math.round(Math.abs(delta) * 100)}% day-over-day`,
        description: `Yesterday: ${curr.toLocaleString()} clicks (vs ${prev.toLocaleString()} on the prior day). Investigate for ranking drops or outages.`,
        evidence: { curr, prev, delta },
        link: '/admin/seo',
      });
    }
  }

  // 2. New SEO opportunities (first-seen within the last 24h).
  const dayAgo = new Date(); dayAgo.setUTCHours(dayAgo.getUTCHours() - 24);
  const { data: newOpps } = await sb
    .from('network_opportunities')
    .select('id, site_id, kind, title, severity, first_seen_at')
    .eq('status', 'open')
    .gte('first_seen_at', dayAgo.toISOString())
    .order('severity', { ascending: true })
    .limit(5);
  for (const o of (newOpps ?? []) as Array<{ id: string; site_id: string; kind: string; title: string; severity: string }>) {
    notable.push({
      id: `new_opp:${o.id}`,
      kind: 'new_opportunity',
      severity: o.severity as NotableChange['severity'],
      title: `New SEO opportunity: ${o.title}`,
      description: `A deterministic SEO opportunity (${o.kind}) just appeared.`,
      link: '/admin/seo/opportunities',
    });
  }

  // 3. Stale feeds — GSC >5d, GA4 >3d behind yesterday.
  const yesterdayIso = metrics.yesterday.date ?? iso(new Date(Date.now() - 86400000));
  const yDate = new Date(yesterdayIso);
  const { data: props } = await sb
    .from('network_google_properties')
    .select('kind, property_id, last_data_date, network_sites!inner(slug)')
    .eq('status', 'active');
  for (const r of (props ?? []) as unknown as Array<{ kind: 'gsc' | 'ga4'; property_id: string; last_data_date: string | null; network_sites: { slug: string } }>) {
    if (!r.last_data_date) {
      notable.push({
        id: `stale_feed:${r.kind}:${r.network_sites.slug}:nosync`,
        kind: 'stale_feed',
        severity: 'high',
        title: `${r.kind.toUpperCase()} on ${r.network_sites.slug}: never synced`,
        description: `Property ${r.property_id} has no data yet.`,
        siteSlug: r.network_sites.slug,
        link: '/admin/health',
      });
      continue;
    }
    const d = new Date(r.last_data_date);
    const diffDays = Math.round((yDate.getTime() - d.getTime()) / 86400000);
    const threshold = r.kind === 'gsc' ? 5 : 3;
    if (diffDays > threshold) {
      notable.push({
        id: `stale_feed:${r.kind}:${r.network_sites.slug}`,
        kind: 'stale_feed',
        severity: 'high',
        title: `${r.kind.toUpperCase()} on ${r.network_sites.slug} is stale`,
        description: `Data through ${r.last_data_date} (${diffDays}d behind). Investigate the sync job.`,
        siteSlug: r.network_sites.slug,
        link: '/admin/health',
      });
    }
  }

  // 4. Sitemap errors (latest snapshot of each site, status='error').
  const { data: snaps } = await sb
    .from('network_sitemap_snapshots')
    .select('id, site_id, status, issue_count, network_sites!inner(slug)')
    .eq('status', 'error')
    .order('snapshot_at', { ascending: false })
    .limit(10);
  for (const r of (snaps ?? []) as unknown as Array<{ id: string; site_id: string; issue_count: number; network_sites: { slug: string } }>) {
    notable.push({
      id: `sitemap_issue:${r.id}`,
      kind: 'sitemap_issue',
      severity: 'high',
      title: `Sitemap errors on ${r.network_sites.slug}`,
      description: `${r.issue_count} issues from latest sitemap snapshot.`,
      siteSlug: r.network_sites.slug,
      link: '/admin/seo/sitemaps',
    });
  }

  // 5. Content gaps / cannibalisation surfacing counts.
  const { count: gaps } = await sb.from('network_content_gap_findings').select('*', { count: 'exact', head: true }).eq('status', 'open');
  if ((gaps ?? 0) > 0) {
    notable.push({
      id: 'content_gaps',
      kind: 'content_gap',
      severity: 'info',
      title: `${gaps} open content gaps`,
      description: 'Queries with impressions where no dedicated page exists or ranking page is weakly matched.',
      link: '/admin/seo/opportunities',
    });
  }
  const { count: cannibals } = await sb.from('network_cannibalization_findings').select('*', { count: 'exact', head: true }).eq('status', 'open');
  if ((cannibals ?? 0) > 0) {
    notable.push({
      id: 'cannibalisation',
      kind: 'cannibalisation',
      severity: 'info',
      title: `${cannibals} open cannibalisation findings`,
      description: 'Queries where >1 same-site URL materially participates.',
      link: '/admin/seo/opportunities',
    });
  }

  return notable;
}

async function pickTopActions(sb: SupabaseClient, max = 10): Promise<RecommendedAction[]> {
  const actions: RecommendedAction[] = [];

  // Critical alerts.
  const { data: alerts } = await sb
    .from('network_alerts')
    .select('id, level, title, description, site_id, category, network_sites(slug)')
    .in('status', ['open', 'acknowledged'])
    .in('level', ['critical', 'warning'])
    .order('last_detected_at', { ascending: false })
    .limit(10);
  for (const r of (alerts ?? []) as unknown as Array<{ id: string; level: 'critical' | 'warning'; title: string; description: string | null; site_id: string | null; category: string; network_sites?: { slug: string } | null }>) {
    const pri = r.level === 'critical' ? 'critical' : 'high';
    actions.push({
      id: `alert:${r.id}`,
      priority: pri,
      title: r.title,
      description: r.description ?? '',
      source: 'alert',
      siteSlug: r.network_sites?.slug,
      link: '/admin/alerts',
      priorityScore: (PRIORITY_WEIGHT[pri] ?? 0) + 5,
      reasoning: `${r.level.toUpperCase()} alert in category ${r.category}`,
    });
  }

  // High-priority open SEO opportunities.
  const { data: opps } = await sb
    .from('network_opportunities')
    .select('id, kind, title, severity, site_id, metrics, network_sites(slug)')
    .eq('status', 'open')
    .in('severity', ['critical', 'high'])
    .order('severity', { ascending: true })
    .limit(10);
  for (const o of (opps ?? []) as unknown as Array<{ id: string; kind: string; title: string; severity: 'critical' | 'high' | 'normal' | 'low'; site_id: string; metrics: Record<string, number>; network_sites?: { slug: string } | null }>) {
    const impr = o.metrics?.impressions_28d ?? o.metrics?.impressions_7d ?? 0;
    actions.push({
      id: `opp:${o.id}`,
      priority: o.severity,
      title: o.title,
      description: `${o.kind.replace(/_/g, ' ')} · ${impr.toLocaleString()} impressions`,
      source: 'opportunity',
      siteSlug: o.network_sites?.slug,
      link: '/admin/seo/opportunities',
      priorityScore: (PRIORITY_WEIGHT[o.severity] ?? 0) + Math.min(20, Math.log10(Math.max(1, impr))),
      reasoning: `${o.severity.toUpperCase()} opportunity, ${impr.toLocaleString()} 28d impressions`,
    });
  }

  // High-priority internal-link opportunities.
  const { data: ils } = await sb
    .from('network_internal_link_opportunities')
    .select('id, reason, source_url, target_url, priority, site_id, network_sites(slug)')
    .eq('status', 'open')
    .in('priority', ['critical', 'high'])
    .limit(5);
  for (const r of (ils ?? []) as unknown as Array<{ id: string; reason: string; source_url: string; target_url: string; priority: 'critical' | 'high' | 'normal' | 'low'; network_sites?: { slug: string } | null }>) {
    actions.push({
      id: `il:${r.id}`,
      priority: r.priority,
      title: `Internal link opportunity (${r.reason})`,
      description: `Link ${r.source_url} → ${r.target_url}`,
      source: 'internal_link',
      siteSlug: r.network_sites?.slug,
      link: '/admin/seo/internal-links',
      priorityScore: PRIORITY_WEIGHT[r.priority] ?? 0,
      reasoning: `Internal-link opp with priority ${r.priority}`,
    });
  }

  // Stale feeds — mirror notable but as actions.
  const { data: props } = await sb
    .from('network_google_properties')
    .select('kind, property_id, last_data_date, network_sites!inner(slug)')
    .eq('status', 'active');
  const now = Date.now();
  for (const r of (props ?? []) as unknown as Array<{ kind: 'gsc' | 'ga4'; property_id: string; last_data_date: string | null; network_sites: { slug: string } }>) {
    if (!r.last_data_date) {
      actions.push({
        id: `stale:${r.kind}:${r.network_sites.slug}`,
        priority: 'high',
        title: `${r.kind.toUpperCase()} not yet synced on ${r.network_sites.slug}`,
        description: `Property ${r.property_id} is configured but has no data.`,
        source: 'stale_feed',
        siteSlug: r.network_sites.slug,
        link: '/admin/health',
        priorityScore: PRIORITY_WEIGHT['high'] ?? 0,
        reasoning: 'Data source not yet synced',
      });
      continue;
    }
    const diffDays = Math.round((now - new Date(r.last_data_date).getTime()) / 86400000);
    const threshold = r.kind === 'gsc' ? 5 : 3;
    if (diffDays > threshold) {
      actions.push({
        id: `stale:${r.kind}:${r.network_sites.slug}`,
        priority: 'high',
        title: `${r.kind.toUpperCase()} is stale on ${r.network_sites.slug}`,
        description: `Data through ${r.last_data_date} (${diffDays}d behind).`,
        source: 'stale_feed',
        siteSlug: r.network_sites.slug,
        link: '/admin/health',
        priorityScore: PRIORITY_WEIGHT['high'] ?? 0,
        reasoning: `Feed ${diffDays}d behind threshold ${threshold}d`,
      });
    }
  }

  // Open high-priority tasks (manual + derived).
  const { data: tasks } = await sb
    .from('network_tasks')
    .select('id, title, priority, site_id, task_type, network_sites(slug)')
    .in('status', ['open', 'in_progress'])
    .in('priority', ['critical', 'high'])
    .order('priority', { ascending: true })
    .limit(10);
  for (const r of (tasks ?? []) as unknown as Array<{ id: string; title: string; priority: 'critical' | 'high' | 'normal' | 'low'; task_type: string; network_sites?: { slug: string } | null }>) {
    actions.push({
      id: `task:${r.id}`,
      priority: r.priority,
      title: r.title,
      description: `Open ${r.task_type} task`,
      source: 'task',
      siteSlug: r.network_sites?.slug,
      link: '/admin/tasks',
      priorityScore: (PRIORITY_WEIGHT[r.priority] ?? 0) - 2,
      reasoning: `Open task with priority ${r.priority}`,
    });
  }

  // High-impression page opportunities.
  const { data: pageOpps } = await sb
    .from('network_page_opportunities')
    .select('id, kind, template_label, gsc_impressions_28d, priority, site_id, network_sites(slug)')
    .eq('status', 'open')
    .in('priority', ['critical', 'high'])
    .limit(5);
  for (const r of (pageOpps ?? []) as unknown as Array<{ id: string; template_label: string; priority: 'critical' | 'high' | 'normal' | 'low'; gsc_impressions_28d: number; network_sites?: { slug: string } | null }>) {
    actions.push({
      id: `page_opp:${r.id}`,
      priority: r.priority,
      title: `Build template: ${r.template_label}`,
      description: `${Number(r.gsc_impressions_28d).toLocaleString()} impressions over 28d demand`,
      source: 'page_opportunity',
      siteSlug: r.network_sites?.slug,
      link: '/admin/seo/page-opportunities',
      priorityScore: (PRIORITY_WEIGHT[r.priority] ?? 0) - 1 + Math.min(10, Math.log10(Math.max(1, Number(r.gsc_impressions_28d)))),
      reasoning: `Page template with ${Number(r.gsc_impressions_28d).toLocaleString()} impressions`,
    });
  }

  // Sort by priorityScore desc then title.
  actions.sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title));
  // Dedupe by id.
  const seen = new Set<string>();
  const deduped: RecommendedAction[] = [];
  for (const a of actions) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    deduped.push(a);
  }
  return deduped.slice(0, max);
}

export async function buildBrief(sb: SupabaseClient, today: Date): Promise<Brief> {
  const metrics = await fetchMetrics(sb, today);
  const [notable, actions] = await Promise.all([
    findNotable(sb, metrics),
    pickTopActions(sb, 10),
  ]);
  const countsByCategory: Record<string, number> = {};
  for (const a of actions) countsByCategory[a.source] = (countsByCategory[a.source] ?? 0) + 1;
  return {
    forDate: iso(today),
    metrics,
    notable,
    actions,
    countsByCategory,
  };
}

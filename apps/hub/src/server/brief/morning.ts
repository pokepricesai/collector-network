import 'server-only';

// Morning Brief Phase 1 — deterministic operator briefing.
//
// This is NOT a second intelligence engine. The Intelligence Inbox
// (apps/hub/src/server/intelligence) already decides WHAT MATTERS.
// This file reads that output + the task inbox + the existing
// analytics / revenue / content / health helpers, organises them
// into one assembled brief object, and attaches a freshness block.
//
// No LLM. No external action. One SQL round-trip per source (via
// Promise.all) rather than per-section.
//
// Sections:
//   networkStatus      deterministic healthy / needs_attention / action_required
//   attentionItems     top 5-7 open Intelligence items (already ranked)
//   tasks              operator inbox: manual + intelligence; high + rest
//   sites              per-site snapshot with status + 28d reporting traffic
//   growth             best gaining signals (Intelligence + any site-level)
//   revenue            GBP + non-GBP revenue 28d, direct costs if GBP
//   content            publish + review + ideas state
//   seo                top 3-5 page-level SEO cards (Intelligence)
//   health             only not-healthy items; else "all core systems healthy"
//   positives          1-3 evidence-based positive signals
//   freshness          when each important source last refreshed

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NetworkSite } from '@/server/admin/sites';
import { getReportingTrafficWindow } from '@/server/reporting/traffic';
import { listIntelligenceInbox, type IntelligenceRowRead } from '@/server/intelligence/queries';
import { listTasks, OPERATOR_INBOX_SOURCES, type TaskRow } from '@/server/tasks/queries';
import { totalsSince, type TotalsByCurrency } from '@/server/revenue/queries';
import type { SiteSlug } from '@/server/intelligence/types';

// ─── Types ────────────────────────────────────────────────────

export type NetworkStatus = 'healthy' | 'needs_attention' | 'action_required';
export type SiteStatus = 'healthy' | 'watch' | 'action_required' | 'insufficient_data';

export interface AttentionItem {
  id: string;
  site_slug: string;              // 'network' or site slug
  category: string;               // 'seo' | 'data_health' | 'indexing' | 'growth' | ...
  type: string;
  signal_kind: 'opportunity' | 'risk' | 'warning' | 'positive' | 'informational';
  title: string;
  summary: string;
  recommended_action: string;
  priority_score: number;
  priority_band: 'critical' | 'high' | 'normal' | 'low';
  expected_upside_label: string | null;
  intelligence_item_id: string;
}

export interface BriefTaskList {
  high: BriefTask[];
  other: BriefTask[];
  total_open: number;
}
export interface BriefTask {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  task_kind: 'fix' | 'improvement';
  task_source: 'manual' | 'intelligence' | 'system';
  site_slug: string | null;
  created_at: string;
}

export interface SiteSnapshot {
  slug: SiteSlug;
  name: string;
  status: SiteStatus;
  status_reason: string;
  reporting_active_users_28d: number;
  reporting_active_users_prior_28d: number;
  change_abs: number;
  change_pct_label: string;         // '+34%' or 'n/a — low sample'
  gsc_clicks_28d: number;
  gsc_impressions_28d: number;
  revenue_minor_28d: number | null; // null when unknown; 0 is a real reading
  revenue_currency: string | null;
  open_risk_count: number;
  open_warning_count: number;
}

export interface GrowthEntry {
  site_slug: string;
  title: string;
  summary: string;
  signal_kind: AttentionItem['signal_kind'];
}

export interface RevenueBlock {
  availability: 'live' | 'unavailable';
  gbp_net_minor: number;
  gbp_prior_net_minor: number;
  gbp_change_label: string;
  non_gbp: Array<{ currency: string; net_minor: number }>;
  revenue_items: AttentionItem[];       // revenue-category intelligence items (up/down)
  note: string | null;
}

export interface ContentBlock {
  published_last_7d: number;
  scheduled: number;
  review: number;
  high_value_ideas: number;
  blocked_or_held: number;
  recent_titles: string[];
}

export interface HealthBlock {
  all_healthy: boolean;
  items: AttentionItem[];           // data_health + indexing items in attention set
}

export interface PositiveSignal {
  id: string;
  title: string;
  summary: string;
  site_slug: string;
}

export interface FreshnessEntry {
  source: 'GA4' | 'GSC' | 'Revenue' | 'Intelligence' | 'Content';
  through: string | null;
  freshness_label: string;         // "through 2026-10-10" or "synced 2h ago" or "never"
}

export interface MorningBrief {
  generated_at: string;
  for_date: string;               // ISO yyyy-mm-dd
  day_label: string;              // "Sunday 12 October"
  network_status: NetworkStatus;
  network_status_reason: string;
  attention_items: AttentionItem[];
  tasks: BriefTaskList;
  sites: SiteSnapshot[];
  growth: GrowthEntry[];
  revenue: RevenueBlock;
  content: ContentBlock;
  seo: AttentionItem[];
  health: HealthBlock;
  positives: PositiveSignal[];
  freshness: FreshnessEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────

function priorityBand(score: number): 'critical' | 'high' | 'normal' | 'low' {
  if (score >= 85) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 45) return 'normal';
  return 'low';
}

function toAttention(row: IntelligenceRowRead): AttentionItem {
  const upside = (row.expected_upside && typeof row.expected_upside === 'object' && !Array.isArray(row.expected_upside))
    ? (row.expected_upside as { label?: string }).label ?? null
    : null;
  return {
    id: `intel:${row.id}`,
    intelligence_item_id: row.id,
    site_slug: row.network_sites?.slug ?? 'network',
    category: row.category,
    type: row.type,
    signal_kind: row.signal_kind,
    title: row.title,
    summary: row.summary,
    recommended_action: row.recommended_action,
    priority_score: row.priority_score,
    priority_band: priorityBand(row.priority_score),
    expected_upside_label: typeof upside === 'string' ? upside : null,
  };
}

function fmtPct(num: number): string {
  const rounded = Math.round(num);
  return `${rounded >= 0 ? '+' : ''}${rounded}%`;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const SAMPLE_FLOOR_USERS = 300;   // same as Intelligence growth rule — keeps weakness language off tiny samples

// ─── Assembler ────────────────────────────────────────────────

export async function buildMorningBrief(
  sb: SupabaseClient,
  sites: NetworkSite[],
  today: Date = new Date(),
): Promise<MorningBrief> {
  const dayMs  = 24 * 60 * 60 * 1000;
  const endA   = new Date(today.getTime() - 1 * dayMs);
  const startA = new Date(endA.getTime() - 28 * dayMs);
  const endB   = new Date(startA.getTime() - 1 * dayMs);
  const startB = new Date(endB.getTime() - 28 * dayMs);
  const sinceA = startA.toISOString().slice(0, 10);
  const untilA = endA.toISOString().slice(0, 10);
  const sinceB = startB.toISOString().slice(0, 10);
  const untilB = endB.toISOString().slice(0, 10);
  const since7 = new Date(today.getTime() - 7 * dayMs).toISOString().slice(0, 10);

  const [intel, highTasks, otherTasks, revenueTotals, revenuePriorTotals, articles, contentIdeas, latestGsc, latestGa4, latestRevenue, latestIntelRun] = await Promise.all([
    listIntelligenceInbox(sb, { statuses: ['open', 'task_created'], limit: 200 }),
    listTasks(sb, { task_sources: OPERATOR_INBOX_SOURCES, statuses: ['open', 'in_progress', 'waiting'], limit: 50 }),
    (async () => listTasks(sb, { task_sources: OPERATOR_INBOX_SOURCES, statuses: ['open', 'in_progress', 'waiting'], limit: 50 }))(),
    totalsSince(sb, sinceA),
    totalsSince(sb, sinceB).then((rows) =>
      // Approximate prior-28d by subtracting rev from sinceA-today out of rev from sinceB-today.
      // In practice tiny; the subtraction gives us a defensible comparison.
      rows,
    ),
    sb.from('network_articles')
      .select('id, title, status, published_at, hold_reasons, site_id')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(50),
    sb.from('network_content_ideas')
      .select('id, score, status, decision, hold_reasons, site_id')
      .gte('score', 60)
      .in('status', ['new', 'in_brief'])
      .limit(50),
    sb.from('network_gsc_site_daily').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
    sb.from('network_ga4_site_daily').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
    sb.from('network_revenue_events').select('occurred_on').order('occurred_on', { ascending: false }).limit(1).maybeSingle(),
    sb.from('network_job_runs').select('finished_at, status')
      .eq('job_name', 'intelligence.refresh')
      .order('started_at', { ascending: false })
      .limit(1).maybeSingle(),
  ]);

  const intelRows = intel.rows;
  const intelByCategory: Record<string, IntelligenceRowRead[]> = {};
  const intelBySite: Record<string, IntelligenceRowRead[]> = {};
  for (const r of intelRows) {
    (intelByCategory[r.category] ??= []).push(r);
    const slug = r.network_sites?.slug ?? 'network';
    (intelBySite[slug] ??= []).push(r);
  }

  // ── attentionItems ─────────────────────────────────────────
  // Already ranked by priority_score desc. Mix of signal_kinds
  // is natural because the Intelligence engine ranks across them.
  // Cap at 7 to keep the operator view scannable.
  const attention_items: AttentionItem[] = intelRows
    .slice(0, 7)
    .map(toAttention);

  // ── tasks ──────────────────────────────────────────────────
  const toBriefTask = (t: TaskRow): BriefTask => ({
    id: t.id,
    title: t.title,
    priority: t.priority === 'critical' ? 'critical' : t.priority === 'high' ? 'high' : t.priority === 'low' ? 'low' : 'normal',
    task_kind: t.task_kind,
    task_source: t.task_source,
    site_slug: t.site_id ? (sites.find((s) => s.id === t.site_id)?.slug ?? null) : null,
    created_at: t.created_at,
  });
  const allTasks = (highTasks || otherTasks).map(toBriefTask);
  const tasksHigh  = allTasks.filter((t) => t.priority === 'critical' || t.priority === 'high');
  const tasksOther = allTasks.filter((t) => !(t.priority === 'critical' || t.priority === 'high')).slice(0, Math.max(0, 10 - tasksHigh.length));
  const tasks: BriefTaskList = {
    high: tasksHigh.slice(0, 10),
    other: tasksOther,
    total_open: allTasks.length,
  };

  // ── sites snapshot (parallel) ──────────────────────────────
  const siteSnapshots: SiteSnapshot[] = await Promise.all(sites.map(async (s): Promise<SiteSnapshot> => {
    const [winA, winB, gscA, revBySiteA] = await Promise.all([
      getReportingTrafficWindow(sb, { site_id: s.id, from: sinceA, to: untilA }),
      getReportingTrafficWindow(sb, { site_id: s.id, from: sinceB, to: untilB }),
      sb.from('network_gsc_url_daily')
        .select('clicks, impressions')
        .eq('site_id', s.id)
        .gte('date', sinceA).lte('date', untilA),
      sb.from('network_revenue_events')
        .select('amount_minor, currency')
        .eq('site_id', s.id)
        .gte('occurred_on', sinceA),
    ]);
    let clicks = 0, impressions = 0;
    for (const row of ((gscA.data ?? []) as Array<{ clicks: number; impressions: number }>)) {
      clicks += Number(row.clicks ?? 0);
      impressions += Number(row.impressions ?? 0);
    }
    // Revenue — group by currency. Report null if NO events; 0 is a real reading only if we saw events.
    const revEvents = (revBySiteA.data ?? []) as Array<{ amount_minor: number; currency: string }>;
    let revMinor: number | null = null;
    let revCurrency: string | null = null;
    if (revEvents.length > 0) {
      // Pick GBP if present, else highest-magnitude currency.
      const byCur = new Map<string, number>();
      for (const e of revEvents) byCur.set(e.currency, (byCur.get(e.currency) ?? 0) + Number(e.amount_minor ?? 0));
      const gbp = byCur.get('GBP');
      if (gbp != null) { revMinor = gbp; revCurrency = 'GBP'; }
      else {
        let best: { c: string; v: number } | null = null;
        for (const [c, v] of byCur) if (!best || Math.abs(v) > Math.abs(best.v)) best = { c, v };
        if (best) { revMinor = best.v; revCurrency = best.c; }
      }
    }

    const siteIntel = intelBySite[s.slug] ?? [];
    const openRisk    = siteIntel.filter((r) => r.signal_kind === 'risk').length;
    const openWarning = siteIntel.filter((r) => r.signal_kind === 'warning').length;

    const change = winA.active_users - winB.active_users;
    const insufficient = winA.active_users < SAMPLE_FLOOR_USERS;
    const changePctLabel = insufficient ? 'n/a — low sample'
      : winB.active_users > 0 ? fmtPct(((winA.active_users - winB.active_users) / winB.active_users) * 100)
      : 'n/a';

    // Status derivation (deterministic, in order of precedence):
    let status: SiteStatus = 'healthy';
    let reason = 'no outstanding risks or warnings';
    const hasActionRequired = siteIntel.some((r) =>
      (r.signal_kind === 'risk' && r.priority_score >= 70)
      || r.type === 'failed_job'
      || r.type === 'sitemap_fetch_error');
    if (hasActionRequired) { status = 'action_required'; reason = 'open risk at high priority or failed core job / sitemap fetch error'; }
    else if (openRisk > 0 || openWarning > 0) { status = 'watch'; reason = `${openRisk} risk · ${openWarning} warning in Intelligence`; }
    else if (insufficient && winA.active_users === 0 && clicks === 0 && impressions === 0) {
      status = 'insufficient_data'; reason = 'no reporting traffic + no GSC rows in the last 28d';
    } else if (insufficient) {
      status = 'insufficient_data'; reason = `recent-window active-user-days ${winA.active_users} < sample floor ${SAMPLE_FLOOR_USERS}`;
    }

    return {
      slug: s.slug as SiteSlug,
      name: s.name,
      status,
      status_reason: reason,
      reporting_active_users_28d: winA.active_users,
      reporting_active_users_prior_28d: winB.active_users,
      change_abs: change,
      change_pct_label: changePctLabel,
      gsc_clicks_28d: clicks,
      gsc_impressions_28d: impressions,
      revenue_minor_28d: revMinor,
      revenue_currency: revCurrency,
      open_risk_count: openRisk,
      open_warning_count: openWarning,
    };
  }));

  // ── growth ─────────────────────────────────────────────────
  const growthRows = (intelByCategory['growth'] ?? [])
    .concat(intelRows.filter((r) => r.type === 'gaining'))
    .slice(0, 5);
  const growth: GrowthEntry[] = growthRows.map((r) => ({
    site_slug: r.network_sites?.slug ?? 'network',
    title: r.title,
    summary: r.summary,
    signal_kind: r.signal_kind,
  }));

  // ── revenue ────────────────────────────────────────────────
  const gbpNow   = revenueTotals.find((r) => r.currency === 'GBP')?.net_minor ?? 0;
  // Approximate prior 28d via (sinceB..today) totals minus (sinceA..today) totals.
  // totalsSince is one-sided (events since a date), so prior-28d is best computed
  // by subtracting the recent-window total from the two-window total. Cheap +
  // deterministic + no second scan.
  const gbpTwoWindows = revenuePriorTotals.find((r) => r.currency === 'GBP')?.net_minor ?? 0;
  const gbpPrior = gbpTwoWindows - gbpNow;
  const gbpChangeLabel = Math.abs(gbpPrior) < 500
    ? 'n/a — too small to compare'
    : fmtPct(((gbpNow - gbpPrior) / Math.max(1, Math.abs(gbpPrior))) * 100);
  const nonGbp = revenueTotals
    .filter((r) => r.currency !== 'GBP' && r.net_minor !== 0)
    .map((r: TotalsByCurrency) => ({ currency: r.currency, net_minor: r.net_minor }));
  const revenueAvailable = revenueTotals.length > 0;
  const revenueItems: AttentionItem[] = (intelByCategory['revenue'] ?? [])
    .concat(intelByCategory['monetisation'] ?? [])
    .slice(0, 5)
    .map(toAttention);

  const revenue: RevenueBlock = {
    availability: revenueAvailable ? 'live' : 'unavailable',
    gbp_net_minor: gbpNow,
    gbp_prior_net_minor: gbpPrior,
    gbp_change_label: gbpChangeLabel,
    non_gbp: nonGbp,
    revenue_items: revenueItems,
    note: revenueAvailable ? null : 'No revenue events ingested yet — EPN pipeline may still be warming up.',
  };

  // ── content ────────────────────────────────────────────────
  interface ArticleRow { id: string; title: string; status: string; published_at: string | null; hold_reasons: string[] | null; site_id: string | null }
  const articleRows = (articles.data ?? []) as ArticleRow[];
  const published7 = articleRows.filter((a) => a.status === 'published' && a.published_at && a.published_at >= since7);
  const scheduled  = articleRows.filter((a) => a.status === 'scheduled' || a.status === 'publishing');
  const inReview   = articleRows.filter((a) => a.status === 'review');
  const blocked    = articleRows.filter((a) => (a.hold_reasons?.length ?? 0) > 0);
  interface IdeaRow { id: string; score: number; status: string; decision: string | null; hold_reasons: string[] | null }
  const ideaRows = (contentIdeas.data ?? []) as IdeaRow[];
  const highValueIdeas = ideaRows.filter((r) => (r.hold_reasons?.length ?? 0) === 0 && r.decision !== 'skip');
  const content: ContentBlock = {
    published_last_7d: published7.length,
    scheduled: scheduled.length,
    review: inReview.length,
    high_value_ideas: highValueIdeas.length,
    blocked_or_held: blocked.length,
    recent_titles: published7.slice(0, 3).map((a) => a.title),
  };

  // ── SEO lab ────────────────────────────────────────────────
  const seo: AttentionItem[] = (intelByCategory['seo'] ?? [])
    .slice(0, 5)
    .map(toAttention);

  // ── health ─────────────────────────────────────────────────
  const healthRows = intelRows.filter((r) =>
    r.category === 'data_health' || r.category === 'indexing');
  const health: HealthBlock = {
    all_healthy: healthRows.length === 0,
    items: healthRows.slice(0, 5).map(toAttention),
  };

  // ── positives ──────────────────────────────────────────────
  const positiveRows = intelRows.filter((r) => r.signal_kind === 'positive').slice(0, 3);
  const positives: PositiveSignal[] = positiveRows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    site_slug: r.network_sites?.slug ?? 'network',
  }));

  // ── network status ─────────────────────────────────────────
  let network_status: NetworkStatus = 'healthy';
  let networkReason = 'no high-priority risks or warnings';
  const anyAction = intelRows.some((r) =>
    (r.signal_kind === 'risk' && r.priority_score >= 70)
    || r.type === 'failed_job'
    || r.type === 'sitemap_fetch_error'
    || (r.type === 'stale_job' && (r.evidence as { is_core?: boolean })?.is_core === true));
  const anyWarnOrRisk = intelRows.some((r) => (r.signal_kind === 'warning' || r.signal_kind === 'risk') && r.priority_score >= 45);
  if (anyAction) { network_status = 'action_required'; networkReason = 'at least one open risk at high priority, failed/stale core job, or sitemap fetch error'; }
  else if (anyWarnOrRisk) { network_status = 'needs_attention'; networkReason = 'at least one open warning or risk above the normal priority threshold'; }

  // ── freshness ──────────────────────────────────────────────
  const gscDate = (latestGsc.data as { date: string } | null)?.date ?? null;
  const ga4Date = (latestGa4.data as { date: string } | null)?.date ?? null;
  const revDate = (latestRevenue.data as { occurred_on: string } | null)?.occurred_on ?? null;
  const intelFinished = (latestIntelRun.data as { finished_at: string | null } | null)?.finished_at ?? null;
  const freshness: FreshnessEntry[] = [
    { source: 'GA4',          through: ga4Date, freshness_label: ga4Date ? `through ${ga4Date}` : 'never' },
    { source: 'GSC',          through: gscDate, freshness_label: gscDate ? `through ${gscDate}` : 'never' },
    { source: 'Revenue',      through: revDate, freshness_label: revDate ? `through ${revDate}` : 'no events yet' },
    { source: 'Intelligence', through: intelFinished, freshness_label: intelFinished ? `refreshed ${relativeTime(intelFinished)}` : 'never' },
    { source: 'Content',      through: articleRows[0]?.published_at ?? null, freshness_label: articleRows[0]?.published_at ? `latest article ${articleRows[0]!.published_at.slice(0, 10)}` : 'no articles' },
  ];

  // ── Day label ───────────────────────────────────────────────
  const dayFmt = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return {
    generated_at: new Date().toISOString(),
    for_date: today.toISOString().slice(0, 10),
    day_label: dayFmt,
    network_status,
    network_status_reason: networkReason,
    attention_items,
    tasks,
    sites: siteSnapshots,
    growth,
    revenue,
    content,
    seo,
    health,
    positives,
    freshness,
  };
}

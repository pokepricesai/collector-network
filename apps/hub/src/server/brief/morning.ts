import 'server-only';

// Morning Brief Phase 1 — deterministic operator briefing.
//
// This is NOT a second intelligence engine. The Intelligence Inbox
// (apps/hub/src/server/intelligence) already decides WHAT MATTERS.
// This file reads that output + the task inbox + the existing
// analytics / revenue / content / health helpers, organises them
// into one assembled brief object, and attaches a freshness block.
//
// Operator Polish Pass changes (Checkpoint B):
//   • Attention items carry an action_hint ('Open sitemap',
//     'Inspect page', …) so the page can render ONE contextual
//     action per card instead of a generic 'View intelligence'.
//   • SEO lab collapses multiple Intelligence signals for the
//     SAME page (e.g. striking_distance + low_ctr on the same
//     URL) into one coherent Morning-Brief opportunity. The
//     underlying Intelligence rows stay separate.
//   • Positives merge into Growth — the brief is 'growth &
//     momentum', not two near-identical panels.
//   • status_headline is a count-based summary line
//     ('4 significant issues need attention').
//   • Site snapshot flags site-level revenue attribution
//     separately so the page can render ONE shared explanatory
//     note rather than 'Revenue: no data' five times.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NetworkSite } from '@/server/admin/sites';
import { getReportingTrafficWindow } from '@/server/reporting/traffic';
import { listIntelligenceInbox, type IntelligenceRowRead } from '@/server/intelligence/queries';
import { listTasks, OPERATOR_INBOX_SOURCES, type TaskRow } from '@/server/tasks/queries';
import { totalsSince, type TotalsByCurrency } from '@/server/revenue/queries';
import type { SiteSlug } from '@/server/intelligence/types';
import { siteDisplayName } from '@/lib/display-names';

// ─── Types ────────────────────────────────────────────────────

export type NetworkStatus = 'healthy' | 'needs_attention' | 'action_required';
export type SiteStatus = 'healthy' | 'watch' | 'action_required' | 'insufficient_data';

// Where the operator should go next for this attention item.
export type ActionHint =
  | { kind: 'sitemap';      href: string; label: string }
  | { kind: 'jobs';         href: string; label: string }
  | { kind: 'intelligence'; href: string; label: string }
  | { kind: 'tasks';        href: string; label: string }
  | { kind: 'page';         href: string; label: string }
  | { kind: 'seo';          href: string; label: string };

export interface AttentionItem {
  id: string;
  site_slug: string;
  site_display: string;         // 'PokePrices' etc.
  category: string;
  type: string;
  type_label: string;           // human: 'Sitemap fetch error'
  signal_kind: 'opportunity' | 'risk' | 'warning' | 'positive' | 'informational';
  title: string;
  summary: string;              // one-line evidence
  recommended_action: string;
  priority_score: number;
  priority_band: 'critical' | 'high' | 'normal' | 'low';
  expected_upside_label: string | null;
  action_hint: ActionHint;
  intelligence_item_id: string;
}

// Groups one or more Intelligence items that all target the same
// page under one Morning-Brief operator entry.
export interface SeoOpportunity {
  key: string;                  // "{site_slug}|{page_url}"
  site_slug: string;
  site_display: string;
  page: string;                 // url
  page_label: string;           // operator-friendly path or title
  types: string[];              // original Intelligence types joined into one card
  type_label: string;           // 'Low CTR + Striking Distance' etc
  total_impressions: number;
  weighted_position: number | null;
  query_count: number;
  expected_upside_label: string | null;
  priority_score: number;       // max of contributors
  intelligence_item_ids: string[];
  summary: string;
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
  site_display: string;
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
  change_pct_label: string;
  gsc_clicks_28d: number;
  gsc_impressions_28d: number;
  revenue_minor_28d: number | null;
  revenue_currency: string | null;
  open_risk_count: number;
  open_warning_count: number;
}

export interface GrowthEntry {
  site_slug: string;
  site_display: string;
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
  revenue_items: AttentionItem[];
  note: string | null;
  site_attribution_available: boolean;
}

export interface ContentBlock {
  published_last_7d: number;
  scheduled: number;
  review: number;
  high_value_ideas: number;
  blocked_or_held: number;
  recent_titles: string[];
  next_scheduled_title: string | null;
  in_review_title: string | null;
  last_published_label: string | null;
}

export interface HealthSummary {
  all_healthy: boolean;
  sitemap_error_count: number;
  failed_core_jobs: number;
  stale_core_jobs: number;
  network_stale_crons: number;
  other_warnings: number;
  // The actual items for drill-down.
  items: AttentionItem[];
}

export interface FreshnessEntry {
  source: 'GA4' | 'GSC' | 'Revenue' | 'Intelligence' | 'Content';
  through: string | null;
  freshness_label: string;
}

export interface MorningBrief {
  generated_at: string;
  for_date: string;
  day_label: string;
  network_status: NetworkStatus;
  // Short operator-language summary. "4 significant issues need attention".
  status_headline: string;
  attention_items: AttentionItem[];
  tasks: BriefTaskList;
  sites: SiteSnapshot[];
  // Combined growth + positive signals (Checkpoint B merge).
  growth: GrowthEntry[];
  revenue: RevenueBlock;
  content: ContentBlock;
  seo: SeoOpportunity[];
  health: HealthSummary;
  freshness: FreshnessEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────

function priorityBand(score: number): 'critical' | 'high' | 'normal' | 'low' {
  if (score >= 85) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 45) return 'normal';
  return 'low';
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

function humanTypeLabel(type: string): string {
  const MAP: Record<string, string> = {
    sitemap_fetch_error:        'Sitemap fetch error',
    inspection_sample_warning:  'Inspection sampler warning',
    coverage_deterioration:     'Coverage deteriorating',
    failed_job:                 'Failing job',
    stale_job:                  'Stale scheduled job',
    stale_job_network:          'Network cron stalled',
    striking_distance:          'Striking distance',
    low_ctr:                    'Low CTR',
    declining:                  'Declining page',
    gaining:                    'Gaining page',
    site_reporting_traffic_up:  'Reporting traffic up',
    site_reporting_traffic_down:'Reporting traffic down',
    site_growth_up:             'Site growth',
    site_growth_down:           'Site decline',
  };
  if (MAP[type]) return MAP[type]!;
  return type.split('_').map((p) => p ? p[0]!.toUpperCase() + p.slice(1) : '').join(' ');
}

// Pick ONE operator-sensible next step for an Intelligence item.
function actionHintFor(row: IntelligenceRowRead): ActionHint {
  if (row.category === 'indexing') return { kind: 'sitemap', href: '/admin/seo/sitemaps', label: 'Open sitemaps' };
  if (row.type === 'failed_job' || row.type === 'stale_job' || row.type === 'stale_job_network') {
    return { kind: 'jobs', href: '/admin/jobs', label: 'Open jobs' };
  }
  if (row.category === 'seo' || row.category === 'content') {
    return { kind: 'seo', href: '/admin/seo/opportunities', label: 'Inspect opportunity' };
  }
  return { kind: 'intelligence', href: '/admin/intelligence', label: 'Open Intelligence' };
}

function toAttention(row: IntelligenceRowRead): AttentionItem {
  const upside = (row.expected_upside && typeof row.expected_upside === 'object' && !Array.isArray(row.expected_upside))
    ? (row.expected_upside as { label?: string }).label ?? null
    : null;
  const slug = row.network_sites?.slug ?? 'network';
  return {
    id: `intel:${row.id}`,
    intelligence_item_id: row.id,
    site_slug: slug,
    site_display: siteDisplayName(slug, 'Network'),
    category: row.category,
    type: row.type,
    type_label: humanTypeLabel(row.type),
    signal_kind: row.signal_kind,
    title: row.title,
    summary: row.summary,
    recommended_action: row.recommended_action,
    priority_score: row.priority_score,
    priority_band: priorityBand(row.priority_score),
    expected_upside_label: typeof upside === 'string' ? upside : null,
    action_hint: actionHintFor(row),
  };
}

// Shorten a long URL into a /path · query-ish operator label.
function pageLabelFor(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const decoded = decodeURIComponent(path);
    return decoded.length > 70 ? '…' + decoded.slice(-67) : decoded;
  } catch {
    return url.length > 70 ? url.slice(0, 67) + '…' : url;
  }
}

const SAMPLE_FLOOR_USERS = 300;

// ─── Assembler ────────────────────────────────────────────────

export async function buildMorningBrief(
  sb: SupabaseClient,
  sites: NetworkSite[],
  today: Date = new Date(),
): Promise<MorningBrief> {
  const dayMs  = 24 * 60 * 60 * 1000;
  // Window alignment: mirror server/analytics/dashboard.ts
  // windowDaysAgo(today, 28). endA = yesterday; startA = endA - 27d.
  // That gives a 28-day inclusive span [today-28, today-1] which
  // matches every other operator metric on /admin and /admin/seo.
  // Prior comparable window is [today-56, today-29].
  const endA   = new Date(today.getTime() - 1 * dayMs);
  const startA = new Date(endA.getTime() - 27 * dayMs);
  const endB   = new Date(startA.getTime() - 1 * dayMs);
  const startB = new Date(endB.getTime() - 27 * dayMs);
  const sinceA = startA.toISOString().slice(0, 10);
  const untilA = endA.toISOString().slice(0, 10);
  const sinceB = startB.toISOString().slice(0, 10);
  const since7 = new Date(today.getTime() - 7 * dayMs).toISOString().slice(0, 10);
  void untilA; void sinceB;

  const [intel, opInboxTasks, revenueTotals, revenuePriorTotals, articles, contentIdeas, latestGsc, latestGa4, latestRevenue, latestIntelRun] = await Promise.all([
    listIntelligenceInbox(sb, { statuses: ['open', 'task_created'], limit: 200 }),
    listTasks(sb, { task_sources: OPERATOR_INBOX_SOURCES, statuses: ['open', 'in_progress', 'waiting'], limit: 50 }),
    totalsSince(sb, sinceA),
    totalsSince(sb, sinceB),
    sb.from('network_articles')
      .select('id, title, status, published_at, scheduled_for, hold_reasons, site_id')
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
    sb.from('network_job_runs').select('finished_at')
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

  // ── attention items ────────────────────────────────────────
  const attention_items: AttentionItem[] = intelRows.slice(0, 7).map(toAttention);

  // ── tasks ──────────────────────────────────────────────────
  const toBriefTask = (t: TaskRow): BriefTask => {
    const site_slug = t.site_id ? (sites.find((s) => s.id === t.site_id)?.slug ?? null) : null;
    return {
      id: t.id,
      title: t.title,
      priority: t.priority === 'critical' ? 'critical' : t.priority === 'high' ? 'high' : t.priority === 'low' ? 'low' : 'normal',
      task_kind: t.task_kind,
      task_source: t.task_source,
      site_slug,
      site_display: siteDisplayName(site_slug ?? undefined, 'Network'),
      created_at: t.created_at,
    };
  };
  const allTasks = opInboxTasks.map(toBriefTask);
  const tasksHigh  = allTasks.filter((t) => t.priority === 'critical' || t.priority === 'high');
  const tasksOther = allTasks.filter((t) => !(t.priority === 'critical' || t.priority === 'high')).slice(0, Math.max(0, 10 - tasksHigh.length));
  const tasks: BriefTaskList = {
    high: tasksHigh.slice(0, 10),
    other: tasksOther,
    total_open: allTasks.length,
  };

  // ── sites snapshot ─────────────────────────────────────────
  const siteSnapshots: SiteSnapshot[] = await Promise.all(sites.map(async (s): Promise<SiteSnapshot> => {
    const [winA, winB, gscA, revBySiteA] = await Promise.all([
      getReportingTrafficWindow(sb, { site_id: s.id, from: sinceA, to: untilA }),
      getReportingTrafficWindow(sb, { site_id: s.id, from: sinceB, to: endB.toISOString().slice(0, 10) }),
      sb.from('network_gsc_url_daily').select('clicks, impressions').eq('site_id', s.id).gte('date', sinceA).lte('date', untilA),
      sb.from('network_revenue_events').select('amount_minor, currency').eq('site_id', s.id).gte('occurred_on', sinceA),
    ]);
    let clicks = 0, impressions = 0;
    for (const row of ((gscA.data ?? []) as Array<{ clicks: number; impressions: number }>)) {
      clicks += Number(row.clicks ?? 0);
      impressions += Number(row.impressions ?? 0);
    }
    const revEvents = (revBySiteA.data ?? []) as Array<{ amount_minor: number; currency: string }>;
    let revMinor: number | null = null;
    let revCurrency: string | null = null;
    if (revEvents.length > 0) {
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
    const changePctLabel = insufficient ? 'Too little traffic to compare'
      : winB.active_users > 0 ? fmtPct(((winA.active_users - winB.active_users) / winB.active_users) * 100)
      : 'n/a';

    let status: SiteStatus = 'healthy';
    let reason = 'No outstanding risks or warnings';
    const hasActionRequired = siteIntel.some((r) =>
      (r.signal_kind === 'risk' && r.priority_score >= 70)
      || r.type === 'failed_job'
      || r.type === 'sitemap_fetch_error');
    if (hasActionRequired) { status = 'action_required'; reason = 'Open risk at high priority or failed core job'; }
    else if (openRisk > 0 || openWarning > 0) { status = 'watch'; reason = `${openRisk + openWarning} open ${openRisk + openWarning === 1 ? 'signal' : 'signals'} to review`; }
    else if (insufficient && winA.active_users === 0 && clicks === 0 && impressions === 0) {
      status = 'insufficient_data'; reason = 'No reporting traffic or search data yet';
    } else if (insufficient) {
      status = 'insufficient_data'; reason = 'Too little traffic yet for a reliable trend';
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
  const site_attribution_available = siteSnapshots.some((s) => s.revenue_minor_28d != null);

  // ── growth + positives merged ──────────────────────────────
  const growthSeen = new Set<string>();
  const growthRows: IntelligenceRowRead[] = [];
  for (const r of (intelByCategory['growth'] ?? [])) {
    if (!growthSeen.has(r.id)) { growthSeen.add(r.id); growthRows.push(r); }
  }
  for (const r of intelRows.filter((r) => r.signal_kind === 'positive' || r.type === 'gaining')) {
    if (!growthSeen.has(r.id)) { growthSeen.add(r.id); growthRows.push(r); }
  }
  const growth: GrowthEntry[] = growthRows.slice(0, 5).map((r) => ({
    site_slug: r.network_sites?.slug ?? 'network',
    site_display: siteDisplayName(r.network_sites?.slug, 'Network'),
    title: r.title,
    summary: r.summary,
    signal_kind: r.signal_kind,
  }));

  // ── revenue ────────────────────────────────────────────────
  const gbpNow   = revenueTotals.find((r) => r.currency === 'GBP')?.net_minor ?? 0;
  const gbpTwoWindows = revenuePriorTotals.find((r) => r.currency === 'GBP')?.net_minor ?? 0;
  const gbpPrior = gbpTwoWindows - gbpNow;
  const gbpChangeLabel = Math.abs(gbpPrior) < 500
    ? 'Prior window too small to compare'
    : fmtPct(((gbpNow - gbpPrior) / Math.max(1, Math.abs(gbpPrior))) * 100);
  const nonGbp = revenueTotals
    .filter((r) => r.currency !== 'GBP' && r.net_minor !== 0)
    .map((r: TotalsByCurrency) => ({ currency: r.currency, net_minor: r.net_minor }));
  const revenueAvailable = revenueTotals.length > 0;
  const revenueItems: AttentionItem[] = (intelByCategory['revenue'] ?? [])
    .concat(intelByCategory['monetisation'] ?? [])
    .slice(0, 3)
    .map(toAttention);

  const revenue: RevenueBlock = {
    availability: revenueAvailable ? 'live' : 'unavailable',
    gbp_net_minor: gbpNow,
    gbp_prior_net_minor: gbpPrior,
    gbp_change_label: gbpChangeLabel,
    non_gbp: nonGbp,
    revenue_items: revenueItems,
    note: revenueAvailable ? null : 'No revenue events ingested yet — EPN pipeline may still be warming up.',
    site_attribution_available,
  };

  // ── content ────────────────────────────────────────────────
  interface ArticleRow { id: string; title: string; status: string; published_at: string | null; scheduled_for: string | null; hold_reasons: string[] | null; site_id: string | null }
  const articleRows = (articles.data ?? []) as ArticleRow[];
  const published7 = articleRows.filter((a) => a.status === 'published' && a.published_at && a.published_at >= since7);
  const scheduled  = articleRows.filter((a) => a.status === 'scheduled' || a.status === 'publishing');
  const inReview   = articleRows.filter((a) => a.status === 'review');
  const blocked    = articleRows.filter((a) => (a.hold_reasons?.length ?? 0) > 0);
  interface IdeaRow { id: string; score: number; status: string; decision: string | null; hold_reasons: string[] | null }
  const ideaRows = (contentIdeas.data ?? []) as IdeaRow[];
  const highValueIdeas = ideaRows.filter((r) => (r.hold_reasons?.length ?? 0) === 0 && r.decision !== 'skip');
  const nextScheduled = scheduled.sort((a, b) => (a.scheduled_for ?? '') > (b.scheduled_for ?? '') ? 1 : -1)[0]?.title ?? null;
  const inReviewTitle = inReview[0]?.title ?? null;
  const lastPublished = articleRows.find((a) => a.status === 'published' && a.published_at);
  const lastPublishedLabel = lastPublished?.published_at ? `${lastPublished.title} · ${lastPublished.published_at.slice(0, 10)}` : null;

  const content: ContentBlock = {
    published_last_7d: published7.length,
    scheduled: scheduled.length,
    review: inReview.length,
    high_value_ideas: highValueIdeas.length,
    blocked_or_held: blocked.length,
    recent_titles: published7.slice(0, 3).map((a) => a.title),
    next_scheduled_title: nextScheduled,
    in_review_title: inReviewTitle,
    last_published_label: lastPublishedLabel,
  };

  // ── SEO lab — collapse by page ─────────────────────────────
  const seoByPage = new Map<string, {
    key: string; site_slug: string; page: string;
    types: Set<string>;
    impressions: number;
    posSumWeighted: number;
    posWeightDen: number;
    query_count: number;
    expected_upside_label: string | null;
    priority_score: number;
    intel_ids: string[];
    best_summary: string;
  }>();
  for (const r of (intelByCategory['seo'] ?? [])) {
    const site_slug = r.network_sites?.slug ?? 'network';
    const ev = r.evidence ?? {};
    const page = typeof ev['page'] === 'string' ? ev['page'] as string : null;
    if (!page) continue;
    const key = `${site_slug}|${page}`;
    const prev = seoByPage.get(key);
    const impressions = typeof ev['total_impressions_28d'] === 'number' ? ev['total_impressions_28d'] as number
      : typeof ev['impressions_28d'] === 'number' ? ev['impressions_28d'] as number : 0;
    const wPos = typeof ev['weighted_position'] === 'number' ? ev['weighted_position'] as number
      : typeof ev['avg_position'] === 'number' ? ev['avg_position'] as number : null;
    const qCount = typeof ev['query_count'] === 'number' ? ev['query_count'] as number : 1;
    const upside = (r.expected_upside && typeof r.expected_upside === 'object' && !Array.isArray(r.expected_upside))
      ? (r.expected_upside as { label?: string }).label ?? null : null;
    const bucket = prev ?? {
      key, site_slug, page,
      types: new Set<string>(),
      impressions: 0,
      posSumWeighted: 0,
      posWeightDen: 0,
      query_count: 0,
      expected_upside_label: null as string | null,
      priority_score: 0,
      intel_ids: [] as string[],
      best_summary: '',
    };
    bucket.types.add(r.type);
    bucket.impressions += impressions;
    if (wPos != null && impressions > 0) {
      bucket.posSumWeighted += wPos * impressions;
      bucket.posWeightDen += impressions;
    }
    bucket.query_count = Math.max(bucket.query_count, qCount);
    bucket.priority_score = Math.max(bucket.priority_score, r.priority_score);
    bucket.intel_ids.push(r.id);
    // Keep the highest-priority Intel's upside label as the headline.
    if (!bucket.expected_upside_label && typeof upside === 'string') bucket.expected_upside_label = upside;
    if (!bucket.best_summary) bucket.best_summary = r.summary;
    seoByPage.set(key, bucket);
  }
  const seo: SeoOpportunity[] = Array.from(seoByPage.values())
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 5)
    .map((b) => ({
      key: b.key,
      site_slug: b.site_slug,
      site_display: siteDisplayName(b.site_slug, 'Network'),
      page: b.page,
      page_label: pageLabelFor(b.page),
      types: Array.from(b.types),
      type_label: Array.from(b.types).map(humanTypeLabel).join(' + '),
      total_impressions: b.impressions,
      weighted_position: b.posWeightDen > 0 ? b.posSumWeighted / b.posWeightDen : null,
      query_count: b.query_count,
      expected_upside_label: b.expected_upside_label,
      priority_score: b.priority_score,
      intelligence_item_ids: b.intel_ids,
      summary: b.best_summary,
    }));

  // ── health summary ─────────────────────────────────────────
  const healthRows = intelRows.filter((r) => r.category === 'data_health' || r.category === 'indexing');
  const sitemapErrors = healthRows.filter((r) => r.type === 'sitemap_fetch_error').length;
  const failedCore = healthRows.filter((r) => r.type === 'failed_job' && (r.evidence as { is_core?: boolean })?.is_core === true).length;
  const failedNonCore = healthRows.filter((r) => r.type === 'failed_job' && !((r.evidence as { is_core?: boolean })?.is_core === true)).length;
  const staleCore = healthRows.filter((r) => r.type === 'stale_job' && (r.evidence as { is_core?: boolean })?.is_core === true).length;
  const networkStale = healthRows.filter((r) => r.type === 'stale_job_network').length;
  const otherWarnings = healthRows.length - sitemapErrors - failedCore - failedNonCore - staleCore - networkStale;
  const health: HealthSummary = {
    all_healthy: healthRows.length === 0,
    sitemap_error_count: sitemapErrors,
    failed_core_jobs: failedCore + failedNonCore,       // operator-visible count — don't split hairs on 'core'
    stale_core_jobs: staleCore,
    network_stale_crons: networkStale,
    other_warnings: Math.max(0, otherWarnings),
    items: healthRows.slice(0, 10).map(toAttention),
  };

  // ── network status + headline ──────────────────────────────
  let network_status: NetworkStatus = 'healthy';
  const anyAction = intelRows.some((r) =>
    (r.signal_kind === 'risk' && r.priority_score >= 70)
    || r.type === 'failed_job'
    || r.type === 'sitemap_fetch_error'
    || (r.type === 'stale_job' && (r.evidence as { is_core?: boolean })?.is_core === true));
  const anyWarnOrRisk = intelRows.some((r) => (r.signal_kind === 'warning' || r.signal_kind === 'risk') && r.priority_score >= 45);
  const actionCount = intelRows.filter((r) =>
    (r.signal_kind === 'risk' && r.priority_score >= 70)
    || r.type === 'failed_job'
    || r.type === 'sitemap_fetch_error').length;
  const warnCount = intelRows.filter((r) => r.signal_kind === 'warning' && r.priority_score >= 45).length;
  if (anyAction) {
    network_status = 'action_required';
  } else if (anyWarnOrRisk) {
    network_status = 'needs_attention';
  }
  const status_headline = network_status === 'action_required'
    ? `${actionCount} significant issue${actionCount === 1 ? '' : 's'} need${actionCount === 1 ? 's' : ''} attention`
    : network_status === 'needs_attention'
    ? `${warnCount} warning${warnCount === 1 ? '' : 's'} to review`
    : 'All clear — nothing urgent';

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

  const dayFmt = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return {
    generated_at: new Date().toISOString(),
    for_date: today.toISOString().slice(0, 10),
    day_label: dayFmt,
    network_status,
    status_headline,
    attention_items,
    tasks,
    sites: siteSnapshots,
    growth,
    revenue,
    content,
    seo,
    health,
    freshness,
  };
}

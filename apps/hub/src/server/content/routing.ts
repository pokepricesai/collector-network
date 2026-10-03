import 'server-only';

// Phase 3 opportunity router.
//
// Phase 2 produces several kinds of signal (SEO opportunities,
// cannibalisation, content gaps, page opportunities, internal-link
// opportunities). Not all of them are editorial content ideas —
// most are on-page SEO optimisation work that belongs in the
// network_tasks workflow, not /admin/content/ideas.
//
// Taxonomy (post-routing-fix):
//
//   Phase 2 signal                       →  Destination
//   ────────────────────────────────────────────────────────────
//   opportunity.zero_click    (page exists)  →  seo_rewrite task
//   opportunity.low_ctr       (page exists)  →  seo_rewrite task
//   opportunity.striking_distance (page exists) →  seo_improve task
//   opportunity.declining     (page exists)  →  seo_refresh task
//   opportunity.gaining       (page exists)  →  internal_link task
//   opportunity.new_query     (no page yet)  →  editorial article idea
//   content_gap  (ranking_url is hub/null)   →  editorial article idea
//   content_gap  (ranking_url is entity)     →  seo_rewrite task
//   cannibalisation                          →  consolidation task
//   page_opportunity                         →  stays in page_opp workflow
//   internal_link_opportunity                →  stays in internal_link workflow
//
// network_tasks already exists (Phase 0) with a free-form task_type.
// We dedupe by stable routing_key stored in task.metadata.routing_key
// so re-runs refresh the task rather than creating duplicates.

import type { SupabaseClient } from '@supabase/supabase-js';

type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

interface TaskInput {
  siteId: string;
  taskType: 'seo_rewrite' | 'seo_improve' | 'seo_refresh' | 'consolidation' | 'internal_link_reinforce';
  routingKey: string;
  title: string;
  description: string;
  priority: TaskPriority;
  recommendedAction: string;
  evidence: Record<string, unknown>;
  sourceCode: string;
  metadataExtra?: Record<string, unknown>;
}

async function upsertRoutedTask(sb: SupabaseClient, t: TaskInput): Promise<{ generated: boolean; updated: boolean; taskId: string | null }> {
  // Dedupe on metadata.routing_key for stable idempotency across
  // runs. We can't use a Postgres unique constraint directly on a
  // jsonb path without a function index — do a lookup round-trip
  // and treat it as the duplicate guard.
  const { data: existing } = await sb
    .from('network_tasks')
    .select('id, status')
    .eq('site_id', t.siteId)
    .eq('task_type', t.taskType)
    .filter('metadata->>routing_key', 'eq', t.routingKey)
    .maybeSingle();
  const metadata = { routing_key: t.routingKey, ...(t.metadataExtra ?? {}) };
  if (existing) {
    const row = existing as { id: string; status: string };
    // Preserve human-driven state transitions (in_progress / waiting /
    // completed / dismissed). Only refresh evidence/description/priority
    // when the task is still open or the status is one we're allowed
    // to touch.
    if (row.status === 'completed' || row.status === 'dismissed') {
      return { generated: false, updated: false, taskId: row.id };
    }
    await sb.from('network_tasks').update({
      title: t.title, description: t.description, priority: t.priority,
      recommended_action: t.recommendedAction, evidence: t.evidence,
      metadata: metadata as unknown as Record<string, unknown>,
    }).eq('id', row.id);
    return { generated: false, updated: true, taskId: row.id };
  }
  const { data: inserted } = await sb.from('network_tasks').insert({
    site_id: t.siteId, task_type: t.taskType,
    title: t.title, description: t.description, priority: t.priority,
    source_code: t.sourceCode, status: 'open',
    recommended_action: t.recommendedAction, evidence: t.evidence,
    metadata: metadata as unknown as Record<string, unknown>,
  }).select('id').single();
  return { generated: true, updated: false, taskId: (inserted as { id: string } | null)?.id ?? null };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// Classify a URL by shape. Entity pages (e.g. /set/<set>/card/<slug>)
// are concrete pages where the correct action is to optimise them.
// Hub pages (/, /insights, /sets) are generic — a query ranking
// there is a content-gap for a dedicated page.
function urlLooksLikeEntityPage(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.length >= 2;         // depth >=2 → likely entity
  } catch { return false; }
}

/** Run opportunities → network_tasks routing for one site.
 *  Returns per-category counts PLUS the editorial candidates it
 *  skipped (opportunities whose ranking page is a hub / homepage —
 *  those become content ideas, not SEO rewrite tasks). */
export async function routeOpportunitiesForSite(
  sb: SupabaseClient,
  siteId: string,
): Promise<{
  seo_rewrite: number; seo_improve: number; seo_refresh: number;
  internal_link_reinforce: number; refreshed: number;
  editorial_candidates: Array<{ id: string; query: string; page: string; severity: TaskPriority; metrics: Record<string, number>; kind: string }>;
}> {
  const stats = { seo_rewrite: 0, seo_improve: 0, seo_refresh: 0, internal_link_reinforce: 0, refreshed: 0 };
  const editorialCandidates: Array<{ id: string; query: string; page: string; severity: TaskPriority; metrics: Record<string, number>; kind: string }> = [];

  const { data: opps } = await sb
    .from('network_opportunities')
    .select('id, kind, title, description, page, query, severity, metrics')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .in('kind', ['low_ctr', 'zero_click', 'striking_distance', 'declining', 'gaining']);

  for (const o of ((opps ?? []) as Array<{ id: string; kind: string; title: string; description: string | null; page: string; query: string; severity: TaskPriority; metrics: Record<string, number> }>)) {
    if (!o.page) continue; // opportunities without a page are left for idea engine (new_query handling)

    // Hub / homepage ranking for a specific query is a content-gap
    // signal, not an on-page SEO signal. The idea engine will emit
    // these as editorial candidates instead.
    if (!urlLooksLikeEntityPage(o.page) && (o.kind === 'zero_click' || o.kind === 'low_ctr' || o.kind === 'striking_distance')) {
      editorialCandidates.push({ id: o.id, query: o.query, page: o.page, severity: o.severity, metrics: o.metrics, kind: o.kind });
      continue;
    }

    const impr28 = Number(o.metrics?.impressions_28d ?? 0);
    const clicks28 = Number(o.metrics?.clicks_28d ?? 0);
    const pos = Number(o.metrics?.position_28d ?? 0);

    let taskType: TaskInput['taskType'];
    let recommendation = '';
    switch (o.kind) {
      case 'zero_click':
        taskType = 'seo_rewrite';
        recommendation = `Rewrite the title tag + meta description to match the query intent. The current page is already ranking at position ${pos.toFixed(1)} on "${o.query}" but attracting zero clicks (${impr28} impressions over 28d). The snippet is not winning the SERP decision — surface a clear value signal (live price, PSA grade, pop count, or whatever is most salient to the query intent) in the meta title + description.`;
        break;
      case 'low_ctr':
        taskType = 'seo_rewrite';
        recommendation = `Rewrite title + meta description for better CTR. Position ${pos.toFixed(1)}, ${impr28} impressions, only ${clicks28} clicks over 28d.`;
        break;
      case 'striking_distance':
        taskType = 'seo_improve';
        recommendation = `Position ${pos.toFixed(1)} with ${impr28} impressions over 28d means a small ranking lift can land this on page 1. Enhance on-page relevance for "${o.query}": H1/H2 presence, intro-paragraph phrase match, topical depth, add internal links from authority pages, verify schema.`;
        break;
      case 'declining':
        taskType = 'seo_refresh';
        recommendation = `Clicks on this page have declined materially. Investigate ranking losses, cannibalisation, content decay, Core Update dates. Refresh content, verify freshness, add new data points.`;
        break;
      case 'gaining':
        taskType = 'internal_link_reinforce';
        recommendation = `Page is winning — reinforce it. Add internal links from the home/hub pages, related entity pages, and recent articles. Verify structured data is current.`;
        break;
      default: continue;
    }

    const result = await upsertRoutedTask(sb, {
      siteId,
      taskType,
      routingKey: `opp:${o.kind}:${slug(o.query || o.page)}`,
      title: o.title,
      description: o.description ?? '',
      priority: o.severity,
      recommendedAction: recommendation,
      evidence: {
        opportunity_id: o.id, opportunity_kind: o.kind,
        page: o.page, query: o.query,
        metrics: o.metrics,
      },
      sourceCode: 'derived',
    });
    if (result.generated) stats[taskType]++;
    else if (result.updated) stats.refreshed++;
  }

  return { ...stats, editorial_candidates: editorialCandidates };
}

/** Route cannibalisation findings into consolidation tasks. */
export async function routeCannibalisationForSite(
  sb: SupabaseClient,
  siteId: string,
): Promise<{ consolidation: number; refreshed: number }> {
  const { data: rows } = await sb
    .from('network_cannibalization_findings')
    .select('id, query, url_count, total_impressions, total_clicks, severity, urls')
    .eq('site_id', siteId).eq('status', 'open');

  let generated = 0, refreshed = 0;
  for (const c of ((rows ?? []) as Array<{ id: string; query: string; url_count: number; total_impressions: number; total_clicks: number; severity: TaskPriority; urls: Array<{ url: string }> }>)) {
    const result = await upsertRoutedTask(sb, {
      siteId,
      taskType: 'consolidation',
      routingKey: `cannibal:${slug(c.query)}`,
      title: `Consolidate pages ranking for "${c.query}"`,
      description: `${c.url_count} same-site URLs materially rank for "${c.query}" (${Number(c.total_impressions).toLocaleString()} impressions / ${Number(c.total_clicks).toLocaleString()} clicks over 28d). Decide whether to consolidate into a canonical URL, differentiate the two pages' intents, or add a definitive hub.`,
      priority: c.severity,
      recommendedAction: `Review the ${c.url_count} participating URLs. Pick the one that should win this query. Either 301 the losers to the winner, differentiate their primary queries, or add a hub page that routes clearly between them.`,
      evidence: {
        cannibalization_id: c.id, query: c.query, url_count: c.url_count,
        total_impressions: Number(c.total_impressions ?? 0),
        total_clicks: Number(c.total_clicks ?? 0),
        urls: (c.urls ?? []).slice(0, 10),
      },
      sourceCode: 'derived',
    });
    if (result.generated) generated++;
    else if (result.updated) refreshed++;
  }
  return { consolidation: generated, refreshed };
}

/**
 * Route content_gap_findings. Only true content gaps (ranking_url
 * missing OR a hub page) emit article ideas. Specific-entity ranking
 * URLs route to seo_rewrite tasks instead.
 */
export async function routeContentGapsForSite(
  sb: SupabaseClient,
  siteId: string,
): Promise<{ seo_rewrite: number; editorial_candidates: Array<{ id: string; query: string; impressions_28d: number; clicks_28d: number; position_28d: number | null; gap_reason: string; severity: TaskPriority }>; refreshed: number }> {
  const { data: gaps } = await sb
    .from('network_content_gap_findings')
    .select('id, query, ranking_url, impressions_28d, clicks_28d, position_28d, gap_reason, severity')
    .eq('site_id', siteId).eq('status', 'open');

  let seoRewrite = 0, refreshed = 0;
  const editorial: Array<{ id: string; query: string; impressions_28d: number; clicks_28d: number; position_28d: number | null; gap_reason: string; severity: TaskPriority }> = [];
  for (const g of ((gaps ?? []) as Array<{ id: string; query: string; ranking_url: string | null; impressions_28d: number; clicks_28d: number; position_28d: number | null; gap_reason: string; severity: TaskPriority }>)) {
    // If a specific entity page is already ranking, this is an
    // on-page optimisation signal, not a content gap for a new
    // editorial piece.
    if (urlLooksLikeEntityPage(g.ranking_url)) {
      const result = await upsertRoutedTask(sb, {
        siteId,
        taskType: 'seo_rewrite',
        routingKey: `gap:${slug(g.query)}`,
        title: `Optimise ${g.ranking_url ?? 'ranking page'} for "${g.query}"`,
        description: `${Number(g.impressions_28d).toLocaleString()} 28d impressions for this query land on ${g.ranking_url} at avg position ${(g.position_28d ?? 0).toFixed(1)}. Reason flagged: ${g.gap_reason}.`,
        priority: g.severity,
        recommendedAction: `Rewrite title + meta description + on-page copy to match the "${g.query}" intent on the existing page. If the page genuinely cannot answer the query, THEN create a dedicated article — but first exhaust the on-page optimisation.`,
        evidence: {
          content_gap_id: g.id, query: g.query, ranking_url: g.ranking_url,
          impressions_28d: Number(g.impressions_28d),
          clicks_28d: Number(g.clicks_28d),
          position_28d: g.position_28d, gap_reason: g.gap_reason,
        },
        sourceCode: 'derived',
      });
      if (result.generated) seoRewrite++;
      else if (result.updated) refreshed++;
      continue;
    }
    // Hub or missing ranking URL — this IS a content gap for a new
    // dedicated article.
    editorial.push({
      id: g.id, query: g.query,
      impressions_28d: Number(g.impressions_28d),
      clicks_28d: Number(g.clicks_28d),
      position_28d: g.position_28d, gap_reason: g.gap_reason,
      severity: g.severity,
    });
  }
  return { seo_rewrite: seoRewrite, editorial_candidates: editorial, refreshed };
}

/** Full per-site routing: opportunities + cannibalisation + content gaps.
 *  Returns per-category counts PLUS the editorial candidate rows that
 *  the content-idea engine should turn into ideas, so a single call
 *  provides both buckets. Does not touch internal_link_opportunities
 *  or page_opportunities (they stay in their own workflows). */
export async function routeAllForSite(
  sb: SupabaseClient,
  siteId: string,
): Promise<{
  opp: Awaited<ReturnType<typeof routeOpportunitiesForSite>>;
  cannibal: Awaited<ReturnType<typeof routeCannibalisationForSite>>;
  gap: { seo_rewrite: number; refreshed: number; editorial_count: number; editorial_candidates: Array<{ id: string; query: string; impressions_28d: number; clicks_28d: number; position_28d: number | null; gap_reason: string; severity: TaskPriority }> };
}> {
  const [opp, cannibal, gap] = await Promise.all([
    routeOpportunitiesForSite(sb, siteId),
    routeCannibalisationForSite(sb, siteId),
    routeContentGapsForSite(sb, siteId),
  ]);
  return {
    opp, cannibal,
    gap: { seo_rewrite: gap.seo_rewrite, refreshed: gap.refreshed, editorial_count: gap.editorial_candidates.length, editorial_candidates: gap.editorial_candidates },
  };
}

/**
 * Also exposes the "editorial-shape content gaps" so the content
 * idea engine can emit them WITHOUT redundantly querying.
 */
export { urlLooksLikeEntityPage };

import 'server-only';

// Content idea engine. Deterministic — no LLM.
//
// POST-ROUTING-FIX taxonomy: this engine ONLY emits genuinely
// editorial / new-content ideas. On-page SEO signals are routed to
// network_tasks by src/server/content/routing.ts.
//
// Sources that become article ideas:
//
//   • opportunity.new_query — a query first appeared with ≥20
//     impressions in the trailing 7d AND no existing site URL
//     currently ranks for it. These are candidates for a dedicated
//     page.
//   • content_gap_findings where ranking_url is NULL or path depth
//     ≤ 1 (homepage / hub pages — the site has no entity-specific
//     page for the query). Entity-depth ranking URLs fall through
//     to the routing engine as seo_rewrite tasks instead.
//   • manual admin-entered ideas (handled by the UI; not by this
//     engine).
//
// What this engine deliberately NO LONGER emits:
//
//   • opportunity.zero_click / low_ctr / striking_distance /
//     declining / gaining when the opportunity has a `page` field —
//     these are on-page optimisation signals and belong in
//     network_tasks.
//   • page_opportunities (bulk template work) — handled by
//     /admin/seo/page-opportunities, not by the editorial pipeline.
//   • cannibalization_findings — handled by routing.ts as
//     consolidation tasks.
//
// Dedup: (site_id, dedupe_key). Re-runs refresh evidence +
// last_seen_at. Ideas whose dedupe_key disappears → status='stale'.

import type { SupabaseClient } from '@supabase/supabase-js';
import { routeAllForSite } from './routing';

export interface IdeaInput {
  site_id: string;
  content_type: 'seo_article' | 'news' | 'market_analysis' | 'evergreen_guide'
              | 'set_guide' | 'entity_feature' | 'buying_guide' | 'editorial';
  working_title: string;
  primary_query?: string;
  secondary_queries?: string[];
  summary?: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  origin_type: 'new_query_opportunity' | 'content_gap' | 'manual' | 'refresh';
  origin_id?: string | null;
  evidence: Record<string, unknown>;
  dedupe_key: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export async function generateIdeasForSite(
  sb: SupabaseClient,
  siteId: string,
  siteSlug: string,
): Promise<{ generated: number; refreshed: number; dismissed_stale: number }> {
  const ideas: IdeaInput[] = [];

  // Run routing FIRST. It writes the non-editorial Phase 2 signals
  // into network_tasks and hands back the editorial candidates
  // (opportunities whose page is a hub/homepage; content_gap
  // findings without a specific-entity ranking URL).
  const route = await routeAllForSite(sb, siteId);

  // --- Source 1: opportunity-born editorial candidates --------------
  for (const c of route.opp.editorial_candidates) {
    const impr28 = Number(c.metrics?.impressions_28d ?? 0);
    ideas.push({
      site_id: siteId,
      content_type: 'seo_article',
      working_title: `Dedicated page for "${c.query}" (currently landing on ${c.page})`,
      primary_query: c.query,
      summary: `${impr28.toLocaleString()} impressions over 28d for "${c.query}" are landing on a hub/homepage URL (${c.page}) rather than a dedicated page. A focused editorial piece targeting this intent could absorb the demand.`,
      priority: c.severity,
      origin_type: 'new_query_opportunity',
      origin_id: c.id,
      evidence: { opportunity_kind: c.kind, metrics: c.metrics, weak_ranking_page: c.page },
      dedupe_key: `editorial_from_opportunity:${slugify(c.query)}`,
    });
  }

  // --- Source 2: new_query opportunities ---------------------------
  //
  // Phase 2's opportunity engine emits kind='new_query' when a query
  // first appeared with ≥20 impressions in the trailing 7d. These
  // are candidates for dedicated pages when no entity page already
  // ranks for the query.
  const { data: newQ } = await sb
    .from('network_opportunities')
    .select('id, title, severity, page, query, metrics')
    .eq('site_id', siteId).eq('status', 'open').eq('kind', 'new_query')
    .limit(100);
  for (const o of ((newQ ?? []) as Array<{ id: string; title: string; severity: 'critical' | 'high' | 'normal' | 'low'; page: string; query: string; metrics: Record<string, number> }>)) {
    if (!o.query) continue;
    // Entity-depth ranking means an on-page SEO signal, not a
    // content gap. These are handled by the routing engine.
    if (o.page && new URL(o.page).pathname.split('/').filter(Boolean).length >= 2) continue;
    const impr7 = Number(o.metrics?.impressions_7d ?? 0);
    ideas.push({
      site_id: siteId,
      content_type: 'seo_article',
      working_title: `New search intent: "${o.query}"`,
      primary_query: o.query,
      summary: `A new query surfaced in the last 7 days with ${impr7} impressions. ${o.page ? `Currently landing weakly on ${o.page}.` : 'No dedicated page exists.'} Candidate for a focused editorial piece.`,
      priority: o.severity,
      origin_type: 'new_query_opportunity',
      origin_id: o.id,
      evidence: { opportunity_kind: 'new_query', metrics: o.metrics, weak_ranking_page: o.page || null },
      dedupe_key: `new_query:${slugify(o.query)}`,
    });
  }

  // --- Source 3: content_gap_findings (editorial-shaped only) ------
  for (const g of route.gap.editorial_candidates) {
    ideas.push({
      site_id: siteId,
      content_type: 'seo_article',
      working_title: `Content gap: write a dedicated page for "${g.query}"`,
      primary_query: g.query,
      summary: `${g.impressions_28d.toLocaleString()} impressions over 28d with no specific-entity page ranking. Reason flagged: ${g.gap_reason}.`,
      priority: g.severity,
      origin_type: 'content_gap',
      origin_id: g.id,
      evidence: {
        gap_reason: g.gap_reason,
        impressions_28d: g.impressions_28d,
        clicks_28d: g.clicks_28d,
        position_28d: g.position_28d,
      },
      dedupe_key: `content_gap:${slugify(g.query)}`,
    });
  }

  void siteSlug;

  // --- Dedup within this run --------------------------------------
  const batch = new Map<string, IdeaInput>();
  for (const i of ideas) batch.set(i.dedupe_key, i);
  const final = [...batch.values()];

  // Early-exit: if nothing to emit AND there are no 'new' ideas to
  // mark stale, we're done. But we DO still need to run the stale
  // sweep to retire ideas whose origin disappeared.
  const now = new Date().toISOString();

  const existing = await sb
    .from('network_content_ideas')
    .select('dedupe_key').eq('site_id', siteId);
  const existingKeys = new Set(((existing.data ?? []) as Array<{ dedupe_key: string }>).map((r) => r.dedupe_key));

  if (final.length > 0) {
    const rows = final.map((i) => ({
      site_id: i.site_id, content_type: i.content_type,
      working_title: i.working_title,
      primary_query: i.primary_query ?? null,
      secondary_queries: i.secondary_queries ?? [],
      summary: i.summary ?? null, priority: i.priority,
      status: 'new' as const,
      origin_type: i.origin_type, origin_id: i.origin_id ?? null,
      evidence: i.evidence, dedupe_key: i.dedupe_key,
      last_seen_at: now,
    }));
    const CHUNK = 500;
    for (let s = 0; s < rows.length; s += CHUNK) {
      const slice = rows.slice(s, s + CHUNK);
      const { error } = await sb.from('network_content_ideas')
        .upsert(slice, { onConflict: 'site_id,dedupe_key' });
      if (error) throw new Error(`[ideas] upsert: ${error.message}`);
    }
  }

  const emittedKeys = new Set(final.map((i) => i.dedupe_key));
  const { data: openIdeas } = await sb
    .from('network_content_ideas')
    .select('id, dedupe_key, origin_type')
    .eq('site_id', siteId).eq('status', 'new');
  let dismissed = 0;
  for (const r of ((openIdeas ?? []) as Array<{ id: string; dedupe_key: string; origin_type: string }>)) {
    // Only stale-sweep ideas whose origin_type the current engine
    // actively manages. Manual ideas and anything with an unknown
    // origin_type are left alone.
    if (!['new_query_opportunity', 'content_gap'].includes(r.origin_type)) continue;
    if (!emittedKeys.has(r.dedupe_key)) {
      await sb.from('network_content_ideas')
        .update({ status: 'stale', last_seen_at: now }).eq('id', r.id);
      dismissed++;
    }
  }

  let generated = 0; let refreshed = 0;
  for (const i of final) {
    if (existingKeys.has(i.dedupe_key)) refreshed++;
    else generated++;
  }
  return { generated, refreshed, dismissed_stale: dismissed };
}

import 'server-only';

// Content idea engine. Deterministic — no LLM.
//
// Reads Phase 2 intelligence and generates evidence-backed article
// ideas. Dedup is keyed on (site_id, dedupe_key) where dedupe_key
// combines origin kind + a normalised slug derived from the primary
// query or target URL. Re-running the engine refreshes evidence +
// last_seen_at on existing ideas instead of creating duplicates.
//
// Sources, in order of signal strength:
//   • network_opportunities with status='open' and severity high+ →
//     target the specific query/page
//   • network_page_opportunities with status='open' → template-level
//     ideas ("build Pokemon species pages")
//   • network_content_gap_findings status='open' → "cover this query"
//   • network_cannibalization_findings status='open' → consolidation /
//     clarification ideas
//
// Each idea carries:
//   origin_type / origin_id — so we never lose provenance
//   evidence JSONB — the exact metrics that made us flag it

import type { SupabaseClient } from '@supabase/supabase-js';

export interface IdeaInput {
  site_id: string;
  content_type: 'seo_article' | 'news' | 'market_analysis' | 'evergreen_guide'
              | 'set_guide' | 'entity_feature' | 'buying_guide' | 'editorial';
  working_title: string;
  primary_query?: string;
  secondary_queries?: string[];
  summary?: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  origin_type: 'opportunity' | 'page_opp' | 'content_gap' | 'cannibal' | 'manual' | 'refresh';
  origin_id?: string | null;
  evidence: Record<string, unknown>;
  dedupe_key: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function priorityFromImpressions(impressions: number): 'critical' | 'high' | 'normal' | 'low' {
  if (impressions >= 10_000) return 'high';
  if (impressions >= 2_000) return 'normal';
  return 'low';
}

export async function generateIdeasForSite(
  sb: SupabaseClient,
  siteId: string,
  siteSlug: string,
): Promise<{ generated: number; refreshed: number; dismissed_stale: number }> {
  const ideas: IdeaInput[] = [];

  // 1. From network_opportunities (striking_distance + zero_click only —
  // these two naturally map to "write a dedicated page"). Low_ctr and
  // declining typically call for an EDIT of an existing page, not a
  // new article. Gaining = reinforce = refresh. new_query is handled
  // via content_gap already.
  const { data: opps } = await sb
    .from('network_opportunities')
    .select('id, kind, title, severity, page, query, metrics')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .in('kind', ['striking_distance', 'zero_click'])
    .in('severity', ['critical', 'high', 'normal'])
    .limit(200);
  for (const o of ((opps ?? []) as Array<{ id: string; kind: string; title: string; severity: 'critical' | 'high' | 'normal' | 'low'; page: string; query: string; metrics: Record<string, number> }>)) {
    if (!o.query) continue;
    const impr = Number(o.metrics?.impressions_28d ?? 0);
    const workingTitle = o.kind === 'striking_distance'
      ? `Dedicated page for "${o.query}" (striking distance from page 1)`
      : `Rewrite target for "${o.query}" (${impr.toLocaleString()} impressions, zero clicks)`;
    ideas.push({
      site_id: siteId,
      content_type: 'seo_article',
      working_title: workingTitle,
      primary_query: o.query,
      summary: `GSC flags this query as a ${o.kind.replace(/_/g, ' ')} opportunity. Current ranking page: ${o.page || '—'}.`,
      priority: o.severity,
      origin_type: 'opportunity',
      origin_id: o.id,
      evidence: { opportunity_kind: o.kind, metrics: o.metrics, existing_page: o.page },
      dedupe_key: `opportunity:${slugify(o.query)}`,
    });
  }

  // 2. From network_page_opportunities (template-level ideas).
  const { data: pageOpps } = await sb
    .from('network_page_opportunities')
    .select('id, kind, template_label, reason, gsc_impressions_28d, gsc_clicks_28d, related_queries, priority')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .in('priority', ['critical', 'high', 'normal'])
    .limit(100);
  for (const p of ((pageOpps ?? []) as Array<{ id: string; kind: string; template_label: string; reason: string; gsc_impressions_28d: number; gsc_clicks_28d: number; related_queries: string[]; priority: 'critical' | 'high' | 'normal' | 'low' }>)) {
    const impr = Number(p.gsc_impressions_28d ?? 0);
    const topQueries = (p.related_queries ?? []).slice(0, 5);
    ideas.push({
      site_id: siteId,
      content_type: 'evergreen_guide',
      working_title: `Build out: ${p.template_label}`,
      primary_query: topQueries[0] ?? '',
      secondary_queries: topQueries.slice(1),
      summary: p.reason,
      priority: p.priority,
      origin_type: 'page_opp',
      origin_id: p.id,
      evidence: { kind: p.kind, impressions_28d: impr, clicks_28d: Number(p.gsc_clicks_28d ?? 0), related_queries: topQueries },
      dedupe_key: `page_opp:${slugify(p.kind + '-' + p.template_label)}`,
    });
  }

  // 3. From network_content_gap_findings (BigQuery-fed; currently
  // only PokePrices has findings but the schema is network-wide).
  const { data: gaps } = await sb
    .from('network_content_gap_findings')
    .select('id, query, ranking_url, impressions_28d, clicks_28d, position_28d, gap_reason, severity')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .limit(100);
  for (const g of ((gaps ?? []) as Array<{ id: string; query: string; ranking_url: string | null; impressions_28d: number; clicks_28d: number; position_28d: number; gap_reason: string; severity: 'critical' | 'high' | 'normal' | 'low' }>)) {
    const impr = Number(g.impressions_28d ?? 0);
    ideas.push({
      site_id: siteId,
      content_type: 'seo_article',
      working_title: `Content gap: write a dedicated page for "${g.query}"`,
      primary_query: g.query,
      summary: `Reason: ${g.gap_reason}. Current ranking page: ${g.ranking_url ?? '—'} at avg position ${g.position_28d?.toFixed(1) ?? '—'}.`,
      priority: g.severity,
      origin_type: 'content_gap',
      origin_id: g.id,
      evidence: { gap_reason: g.gap_reason, impressions_28d: impr, clicks_28d: Number(g.clicks_28d ?? 0), position_28d: g.position_28d, ranking_url: g.ranking_url },
      dedupe_key: `content_gap:${slugify(g.query)}`,
    });
  }

  // 4. From network_cannibalization_findings — flag as a "consolidation
  // or clarification" idea rather than a brand-new article.
  const { data: cannibal } = await sb
    .from('network_cannibalization_findings')
    .select('id, query, url_count, total_impressions, total_clicks, severity, urls')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .limit(50);
  for (const c of ((cannibal ?? []) as Array<{ id: string; query: string; url_count: number; total_impressions: number; total_clicks: number; severity: 'critical' | 'high' | 'normal' | 'low'; urls: Array<{ url: string }> }>)) {
    ideas.push({
      site_id: siteId,
      content_type: 'editorial',
      working_title: `Consolidation review: "${c.query}" ranks on ${c.url_count} URLs`,
      primary_query: c.query,
      summary: `Multiple pages on the site share the "${c.query}" query. Decide whether to consolidate, differentiate, or add a definitive hub.`,
      priority: c.severity,
      origin_type: 'cannibal',
      origin_id: c.id,
      evidence: { url_count: c.url_count, total_impressions: Number(c.total_impressions ?? 0), total_clicks: Number(c.total_clicks ?? 0), urls: (c.urls ?? []).slice(0, 10) },
      dedupe_key: `cannibal:${slugify(c.query)}`,
    });
  }
  void siteSlug; // reserved for site-specific heuristics in later blocks

  // --- Dedup within this run (same dedupe_key within a batch should
  // only emit once; later wins because evidence is more specific).
  const batch = new Map<string, IdeaInput>();
  for (const i of ideas) batch.set(i.dedupe_key, i);
  const final = [...batch.values()];

  // --- Upsert into network_content_ideas. Idempotent on
  // (site_id, dedupe_key); existing rows get evidence + priority
  // refreshed and last_seen_at bumped.
  const now = new Date().toISOString();
  if (final.length === 0) {
    return { generated: 0, refreshed: 0, dismissed_stale: 0 };
  }

  // Fetch existing dedupe_keys for this site so we can tell generated
  // vs refreshed apart without an extra round-trip per row.
  const { data: existing } = await sb
    .from('network_content_ideas')
    .select('dedupe_key')
    .eq('site_id', siteId);
  const existingKeys = new Set(((existing ?? []) as Array<{ dedupe_key: string }>).map((r) => r.dedupe_key));

  const rows = final.map((i) => ({
    site_id: i.site_id,
    content_type: i.content_type,
    working_title: i.working_title,
    primary_query: i.primary_query ?? null,
    secondary_queries: i.secondary_queries ?? [],
    summary: i.summary ?? null,
    priority: i.priority,
    status: 'new' as const,
    origin_type: i.origin_type,
    origin_id: i.origin_id ?? null,
    evidence: i.evidence,
    dedupe_key: i.dedupe_key,
    last_seen_at: now,
  }));

  const CHUNK = 500;
  for (let s = 0; s < rows.length; s += CHUNK) {
    const slice = rows.slice(s, s + CHUNK);
    const { error } = await sb.from('network_content_ideas')
      .upsert(slice, { onConflict: 'site_id,dedupe_key', ignoreDuplicates: false });
    if (error) throw new Error(`[ideas] upsert: ${error.message}`);
  }

  // Mark stale: previously-'new' ideas whose dedupe_key wasn't emitted
  // this run (origin disappeared) → 'stale'.
  const emittedKeys = new Set(final.map((i) => i.dedupe_key));
  const { data: openIdeas } = await sb
    .from('network_content_ideas')
    .select('id, dedupe_key')
    .eq('site_id', siteId)
    .eq('status', 'new');
  let dismissed = 0;
  for (const r of ((openIdeas ?? []) as Array<{ id: string; dedupe_key: string }>)) {
    if (!emittedKeys.has(r.dedupe_key)) {
      await sb.from('network_content_ideas').update({ status: 'stale', last_seen_at: now }).eq('id', r.id);
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

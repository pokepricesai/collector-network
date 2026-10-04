import 'server-only';

// Social idea engine. Deterministic — no LLM. Mirrors the Phase 3
// content-idea pattern but with narrower candidate selection: the
// goal is 0-5 strong candidates per day, not a dump.
//
// Candidate sources (all evidence-backed, every row deduped by
// stable key so re-runs refresh rather than duplicate):
//
//   1. Newly PUBLISHED articles that have no social post yet
//      → article_share idea, high priority if it was AI-brief
//        content type (data_driven, market_analysis).
//   2. Approved / scheduled articles that will go live soon
//      → article_share scheduled with the article's publish time.
//   3. Significant market movers from PokePrices (via Phase 3
//      pricing provider) — the single biggest 30d % mover each in
//      raw + PSA 10, filtered the same way the data-driven brief
//      is filtered. Dedupe weekly so we don't spam the account
//      with the same card.
//   4. Daily brief notable_changes with severity in (high|critical)
//      → network_update idea or market_mover depending on kind.
//   5. Manual admin-entered ideas (handled by the UI).

import type { SupabaseClient } from '@supabase/supabase-js';
import { getMarketMovers } from '../pokeprices/pricing';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

interface IdeaInput {
  account_id: string;
  site_id: string | null;
  post_type: 'data_insight' | 'market_mover' | 'article_share' | 'feature_update' | 'network_update' | 'collector_observation' | 'engagement_question' | 'release_note' | 'partner_sponsor' | 'thread' | 'manual';
  working_title: string;
  summary: string | null;
  priority: 'critical' | 'high' | 'normal' | 'low';
  origin_type: string;
  origin_id?: string | null;
  origin_entity_type?: string;
  evidence: Record<string, unknown>;
  dedupe_key: string;
}

export async function generateSocialIdeasForAccount(
  sb: SupabaseClient,
  accountId: string,
): Promise<{ generated: number; refreshed: number; dismissed_stale: number }> {
  const ideas: IdeaInput[] = [];

  // --- Source 1: published articles without a social post --------
  // Not every article deserves a social post; the engine only
  // generates for `market_analysis`, `evergreen_guide`, and
  // `news` content types where a social post is clearly useful.
  const { data: pubArticles } = await sb
    .from('network_articles')
    .select('id, title, slug, content_type, publication_url, published_at, summary, site_id, primary_query')
    .eq('status', 'published')
    .in('content_type', ['market_analysis', 'evergreen_guide', 'news', 'set_guide'])
    .gte('published_at', new Date(Date.now() - 14 * 86400000).toISOString())
    .limit(50);
  for (const a of ((pubArticles ?? []) as Array<{ id: string; title: string; slug: string; content_type: string; publication_url: string | null; published_at: string | null; summary: string | null; site_id: string; primary_query: string | null }>)) {
    // Did this article already produce a social post for this account?
    const { count } = await sb.from('network_social_posts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId).eq('source_article_id', a.id);
    if ((count ?? 0) > 0) continue;
    ideas.push({
      account_id: accountId, site_id: a.site_id,
      post_type: 'article_share',
      working_title: `Share: ${a.title}`,
      summary: a.summary,
      priority: a.content_type === 'market_analysis' ? 'high' : 'normal',
      origin_type: 'published_article',
      origin_id: a.id, origin_entity_type: 'article',
      evidence: { article_id: a.id, title: a.title, slug: a.slug, publication_url: a.publication_url, published_at: a.published_at, primary_query: a.primary_query, content_type: a.content_type },
      dedupe_key: `article:${a.id}`,
    });
  }

  // --- Source 2: approved / scheduled articles due soon ----------
  const soon = new Date(Date.now() + 7 * 86400000).toISOString();
  const { data: schedArticles } = await sb
    .from('network_articles')
    .select('id, title, slug, content_type, publication_url, scheduled_for, summary, site_id')
    .in('status', ['approved', 'scheduled'])
    .not('scheduled_for', 'is', null).lt('scheduled_for', soon).limit(20);
  for (const a of ((schedArticles ?? []) as Array<{ id: string; title: string; slug: string; content_type: string; publication_url: string | null; scheduled_for: string | null; summary: string | null; site_id: string }>)) {
    const { count } = await sb.from('network_social_posts')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId).eq('source_article_id', a.id);
    if ((count ?? 0) > 0) continue;
    ideas.push({
      account_id: accountId, site_id: a.site_id,
      post_type: 'article_share',
      working_title: `Launch share: ${a.title}`,
      summary: a.summary,
      priority: 'normal',
      origin_type: 'scheduled_article',
      origin_id: a.id, origin_entity_type: 'article',
      evidence: { article_id: a.id, title: a.title, slug: a.slug, scheduled_for: a.scheduled_for, content_type: a.content_type },
      dedupe_key: `article_launch:${a.id}`,
    });
  }

  // --- Source 3: significant market movers (PokePrices) ----------
  //
  // One biggest raw + one biggest PSA10 per week. Dedupe key keyed on
  // card_slug so we won't re-emit the same card next week unless
  // the engine detects a materially different story.
  try {
    const raw = await getMarketMovers(sb, { grade: 'raw', windowDays: 30, topN: 1 });
    const psa10 = await getMarketMovers(sb, { grade: 'psa10', windowDays: 30, topN: 1 });
    for (const m of [raw.risers[0], psa10.risers[0]]) {
      if (!m) continue;
      const direction = m.pctChange > 0 ? 'up' : 'down';
      ideas.push({
        account_id: accountId, site_id: null,
        post_type: 'market_mover',
        working_title: `Market mover (${m.grade}): ${m.cardName}`,
        summary: `${m.cardName} (${m.setName}) ${direction} ${Math.abs(m.pctChange).toFixed(1)}% to $${m.endPriceUsd} over the ${m.windowLabel.toLowerCase()}. ${m.salesLastWindow} 90-day sales.`,
        priority: Math.abs(m.pctChange) >= 50 ? 'high' : 'normal',
        origin_type: 'market_mover',
        origin_entity_type: 'card',
        evidence: {
          card_slug: m.cardSlug, card_name: m.cardName, set_name: m.setName,
          grade: m.grade, start_price_usd: m.startPriceUsd, end_price_usd: m.endPriceUsd,
          pct_change: m.pctChange, abs_change_usd: m.absChangeUsd,
          sales_90d: m.salesLastWindow, confidence: m.confidence,
          window_label: m.windowLabel, pokeprices_url: m.pokepricesUrl,
          data_notes: m.dataNotes,
        },
        dedupe_key: `mover:${m.grade}:${slugify(m.cardSlug)}:${new Date().toISOString().slice(0, 7)}`,
      });
    }
  } catch (err) {
    console.error('[social-ideas] market mover enrichment failed:', (err as Error).message);
  }

  // --- Source 4: daily brief notable changes ---------------------
  const { data: briefRow } = await sb.from('network_daily_briefs')
    .select('for_date, payload').order('for_date', { ascending: false }).limit(1).maybeSingle();
  const brief = (briefRow as { for_date: string; payload: { notable?: Array<{ id: string; kind: string; severity: string; title: string; description: string }> } } | null)?.payload;
  for (const n of (brief?.notable ?? [])) {
    if (!['high', 'critical'].includes(n.severity)) continue;
    if (['stale_feed', 'sitemap_issue'].includes(n.kind)) continue; // ops concerns, not social
    const postType: IdeaInput['post_type'] =
      n.kind === 'traffic_up' || n.kind === 'traffic_down' ? 'data_insight' :
      n.kind === 'new_opportunity' ? 'data_insight' : 'network_update';
    ideas.push({
      account_id: accountId, site_id: null,
      post_type: postType,
      working_title: `From the brief: ${n.title}`,
      summary: n.description,
      priority: n.severity as 'critical' | 'high',
      origin_type: 'brief_notable',
      origin_id: null, origin_entity_type: 'brief',
      evidence: { kind: n.kind, title: n.title, description: n.description, severity: n.severity },
      dedupe_key: `brief_notable:${slugify(n.id)}`,
    });
  }

  // --- Dedup within batch + upsert -------------------------------
  const batch = new Map<string, IdeaInput>();
  for (const i of ideas) batch.set(i.dedupe_key, i);
  const final = [...batch.values()];
  const now = new Date().toISOString();

  const { data: existing } = await sb.from('network_social_ideas')
    .select('dedupe_key').eq('account_id', accountId);
  const existingKeys = new Set(((existing ?? []) as Array<{ dedupe_key: string }>).map((r) => r.dedupe_key));

  if (final.length > 0) {
    const rows = final.map((i) => ({
      account_id: i.account_id, site_id: i.site_id,
      post_type: i.post_type, working_title: i.working_title,
      summary: i.summary ?? null, priority: i.priority,
      status: 'new' as const,
      origin_type: i.origin_type, origin_id: i.origin_id ?? null,
      origin_entity_type: i.origin_entity_type ?? null,
      evidence: i.evidence, dedupe_key: i.dedupe_key,
      last_seen_at: now,
    }));
    const CHUNK = 500;
    for (let s = 0; s < rows.length; s += CHUNK) {
      const slice = rows.slice(s, s + CHUNK);
      const { error } = await sb.from('network_social_ideas')
        .upsert(slice, { onConflict: 'account_id,dedupe_key' });
      if (error) throw new Error(`[social-ideas] upsert: ${error.message}`);
    }
  }

  // Stale-sweep for engine-managed origin types.
  const emitted = new Set(final.map((i) => i.dedupe_key));
  const { data: openIdeas } = await sb.from('network_social_ideas')
    .select('id, dedupe_key, origin_type')
    .eq('account_id', accountId).eq('status', 'new');
  let dismissed = 0;
  for (const r of ((openIdeas ?? []) as Array<{ id: string; dedupe_key: string; origin_type: string }>)) {
    if (!['published_article', 'scheduled_article', 'market_mover', 'brief_notable'].includes(r.origin_type)) continue;
    if (!emitted.has(r.dedupe_key)) {
      await sb.from('network_social_ideas').update({ status: 'stale', last_seen_at: now }).eq('id', r.id);
      dismissed++;
    }
  }

  let generated = 0, refreshed = 0;
  for (const i of final) if (existingKeys.has(i.dedupe_key)) refreshed++; else generated++;
  return { generated, refreshed, dismissed_stale: dismissed };
}

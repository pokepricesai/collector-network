import 'server-only';

// Real internal-link engine for Autopilot.
//
// Builds outbound candidate links for an article from TWO sources:
//
//   1. network_internal_link_opportunities (open) scoped to the site.
//      These are the opportunities surfaced by
//      server/internal-links/engine.ts and already-triaged for weak
//      coverage / orphan support. Each row carries source_url +
//      target_url + reason + evidence.
//
//   2. tcg_cards + tcg_sets catalogue hits that match the article's
//      topic tokens. These add card-mention and set-mention anchor
//      candidates even when the opportunities table hasn't surfaced
//      the exact link.
//
// Inbound opportunities: existing pages that COULD link into the
// future article. Returned as a follow-up task list rather than
// auto-rewriting pages. The pipeline persists these as task rows
// only after the article actually publishes (not in Checkpoint B).
//
// Everything is deterministic.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvidenceInternalLink } from './types';
import type { AutopilotSiteSlug } from './config';

export interface InternalLinkEngineInput {
  sb: SupabaseClient;
  site_slug: AutopilotSiteSlug;
  site_id: string;
  working_title: string;
  primary_query: string | null;
  // When a `candidate_url` is passed, we also compute inbound
  // opportunities (pages that could link INTO the article). For a
  // not-yet-published new article the caller passes null; refresh
  // flows pass the existing article's URL.
  candidate_url: string | null;
}

export interface InternalLinkEngineResult {
  outbound: EvidenceInternalLink[];
  inbound_opportunities: InboundOpportunity[];
  validation: Array<{ url: string; status: 'ok' | 'warning'; message: string }>;
}

export interface InboundOpportunity {
  source_url: string;
  reason: string;
  evidence: Record<string, unknown>;
}

const SITE_ORIGIN: Record<AutopilotSiteSlug, string> = {
  ygo:      'https://ygoprices.io',
  pokemon:  'https://pokeprices.io',
  mtg:      'https://mtgprices.io',
  onepiece: 'https://onepieceprices.io',
  lorcana:  'https://lorcanaprices.io',
};

export async function buildInternalLinks(input: InternalLinkEngineInput): Promise<InternalLinkEngineResult> {
  const origin = SITE_ORIGIN[input.site_slug];
  const topicTokens = extractTopicTokens(input.working_title + ' ' + (input.primary_query ?? ''));

  // ── Outbound from the opportunities table ────────────────────
  const { data: oppData } = await input.sb
    .from('network_internal_link_opportunities')
    .select('source_url, target_url, reason, relationship, confidence, priority, evidence')
    .eq('site_id', input.site_id)
    .eq('status', 'open')
    .order('priority', { ascending: false })
    .limit(200);
  const opps = (oppData ?? []) as Array<{
    source_url: string; target_url: string; reason: string;
    relationship: string | null; confidence: 'low' | 'medium' | 'high';
    priority: string; evidence: Record<string, unknown>;
  }>;

  // Filter opportunities whose target_url or source_url touches the
  // topic tokens — these are the most likely to make sense in the
  // article body.
  const outbound: EvidenceInternalLink[] = [];
  const seen = new Set<string>();
  for (const o of opps) {
    const score = scoreUrlMatch(o.target_url, topicTokens) + scoreUrlMatch(o.source_url, topicTokens);
    if (score < 1) continue;
    if (seen.has(o.target_url)) continue;
    seen.add(o.target_url);
    const anchorConcepts = extractAnchorConcepts(o.target_url, o.relationship);
    const reason = mapOppReason(o.reason);
    outbound.push({
      target_url: o.target_url,
      anchor_concepts: anchorConcepts,
      reason,
      priority: 60 + score * 10 + (o.confidence === 'high' ? 10 : o.confidence === 'medium' ? 5 : 0),
    });
    if (outbound.length >= 8) break;
  }

  // ── Outbound from catalogue (card + set URLs by token match) ─
  // Supplements the opportunities table with card/set pages that are
  // deterministically derivable from the topic tokens, even if no
  // formal "opportunity" exists yet.
  if (topicTokens.length > 0 && outbound.length < 8) {
    const nameMatch = topicTokens.join(' ');
    const { data: cardRows } = await input.sb
      .from('tcg_cards')
      .select('name, collector_number')
      .eq('game_id', input.site_slug)
      .ilike('name', `%${topicTokens[0]}%`)
      .limit(10);
    const cardList = (cardRows ?? []) as Array<{ name: string; collector_number: string | null }>;
    for (const c of cardList) {
      const slug = c.collector_number?.toLowerCase() ?? c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const target = `${origin}/card/${slug}`;
      if (seen.has(target)) continue;
      seen.add(target);
      outbound.push({
        target_url: target,
        anchor_concepts: [c.name],
        reason: 'card_mention',
        priority: 50,
      });
      if (outbound.length >= 10) break;
    }

    const { data: setRows } = await input.sb
      .from('tcg_sets')
      .select('name, code')
      .eq('game_id', input.site_slug)
      .ilike('name', `%${topicTokens[0]}%`)
      .limit(6);
    const setList = (setRows ?? []) as Array<{ name: string; code: string }>;
    for (const s of setList) {
      const target = `${origin}/sets/${s.code.toLowerCase()}`;
      if (seen.has(target)) continue;
      seen.add(target);
      outbound.push({
        target_url: target,
        anchor_concepts: [s.name],
        reason: 'set_mention',
        priority: 45,
      });
      if (outbound.length >= 12) break;
    }
    void nameMatch;
  }

  outbound.sort((a, b) => b.priority - a.priority);

  // ── URL validation (same-origin only) ────────────────────────
  const validation: InternalLinkEngineResult['validation'] = [];
  for (const link of outbound) {
    if (!link.target_url.startsWith(origin + '/')) {
      validation.push({ url: link.target_url, status: 'warning', message: `target not on ${origin}` });
    } else {
      validation.push({ url: link.target_url, status: 'ok', message: 'same-origin internal link' });
    }
  }

  // ── Inbound opportunities ────────────────────────────────────
  // Any existing opp whose SOURCE_URL exists today and whose
  // target_url pattern matches the article's eventual URL slug.
  const inbound_opportunities: InboundOpportunity[] = [];
  if (input.candidate_url) {
    for (const o of opps) {
      if (o.target_url === input.candidate_url) {
        inbound_opportunities.push({
          source_url: o.source_url,
          reason: mapOppReason(o.reason),
          evidence: o.evidence,
        });
        if (inbound_opportunities.length >= 10) break;
      }
    }
  }

  return { outbound, inbound_opportunities, validation };
}

// ─── Helpers ───────────────────────────────────────────────────

function extractTopicTokens(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !STOPWORDS.has(t))
    .slice(0, 6);
}

function scoreUrlMatch(url: string, tokens: string[]): number {
  const lower = url.toLowerCase();
  let hits = 0;
  for (const t of tokens) if (lower.includes(t)) hits += 1;
  return hits;
}

function extractAnchorConcepts(url: string, relationship: string | null): string[] {
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  const slugs = path.split('/').filter(Boolean);
  const last = slugs[slugs.length - 1] ?? '';
  const concept = last.replace(/-/g, ' ');
  const concepts = concept ? [concept] : [];
  if (relationship) concepts.push(relationship.replace(/_/g, ' '));
  return concepts.slice(0, 3);
}

function mapOppReason(reason: string): EvidenceInternalLink['reason'] {
  switch (reason) {
    case 'orphan':
    case 'orphan_gsc':             return 'orphan_support';
    case 'authority_handoff':      return 'authority_handoff';
    case 'query_cluster_missing_link':
    case 'query_cluster':          return 'query_cluster';
    case 'weakly_linked':          return 'orphan_support';
    default:                       return 'card_mention';
  }
}

const STOPWORDS = new Set([
  'this', 'that', 'what', 'with', 'from', 'into', 'their', 'about', 'announced',
  'reveals', 'review', 'preview', 'news', 'post', 'posts', 'thread',
  'discussion', 'yugioh', 'card', 'cards', 'guide',
]);

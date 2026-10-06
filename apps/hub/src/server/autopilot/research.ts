import 'server-only';

// Per-candidate research orchestrator (stage 2).
//
// For each shortlisted DiscoveryCandidate, this module:
//
//   1. Extracts entities (cards/sets) from the title + feed summaries
//      + any already-extracted source text.
//   2. Fetches external source pages for the top signals (bounded).
//   3. Builds real internal-link candidates (opportunity table + entity
//      catalogue hits).
//   4. Selects eligible images from matched card entities.
//   5. Looks up related existing articles for overlap scoring.
//   6. Attempts official corroboration — for secondary-source stories,
//      checks whether a Tier-1 signal exists in the same cluster. For
//      Tier-1 sources that use discovery_method=manual (no feed), we
//      report the limitation explicitly rather than pretending we
//      searched.
//   7. Assembles the research pack via buildEvidencePack.
//   8. Runs the final editorial score + evidence quality gate.
//
// Deterministic. No AI. No budget consumption.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DiscoveryCandidate,
  EvidenceImage,
  EvidenceInternalLink,
  ResearchedCandidate,
  SourceTier,
} from './types';
import type { AutopilotSiteSlug } from './config';
import { extractEntities, buildEntityDerivedLinks } from './entity-extraction';
import { buildInternalLinks } from './internal-links';
import { extractSignalsForPack, type ExtractionResult } from './external-extraction';
import { buildEvidencePack, evaluateEvidenceQuality } from './evidence-pack';
import { listSources } from './sources';
import { buildScoredOpportunity, type ScoringSignals } from './opportunity-scoring';

export interface ResearchInput {
  sb: SupabaseClient;
  site_slug: AutopilotSiteSlug;
  site_id: string;
  site_name: string;
  candidate: DiscoveryCandidate;
  // Signals from the entire discovery pool — used for official
  // corroboration (does ANY Tier-1 signal land in this cluster?).
  all_signals_in_pool: Array<{ cluster_key: string | null; url: string; source_name: string; source_tier: SourceTier; domain: string }>;
  // Existing published articles on the site, used for overlap scoring.
  existing_articles: Array<{ id: string; slug: string; title: string; published_at: string | null; publication_url: string | null }>;
  // Admin per-article cap so the research pack carries the budget
  // the orchestrator will enforce. Projection comes later.
  max_cost_per_article_usd: number;
}

export async function researchCandidate(input: ResearchInput): Promise<ResearchedCandidate> {
  const c = input.candidate;
  const topicText = [
    c.working_title,
    ...c.signals.map((s) => s.title ?? ''),
    ...c.signals.map((s) => s.summary ?? ''),
  ].join('  ');

  // ─── 1. External extraction (bounded) ───────────────────────
  const extractionResults: ExtractionResult[] = c.signals.length > 0
    ? await extractSignalsForPack(input.sb, c.signals, input.site_slug, 3)
    : [];
  const extractedByUrl = new Map<string, { extracted_text: string; og_image_url: string | null; published_at: string | null }>();
  for (const e of extractionResults) {
    if (e.success && e.extracted_text) {
      extractedByUrl.set(e.url, {
        extracted_text: e.extracted_text,
        og_image_url: e.og_image_url ?? null,
        published_at: e.published_at ?? null,
      });
    }
  }

  // Richer text for entity extraction after we've got the pages.
  const enrichedText = topicText + '\n' + Array.from(extractedByUrl.values()).map((v) => v.extracted_text).join('\n');

  // ─── 2. Entity extraction (cards + sets) ────────────────────
  const entities = await extractEntities(input.sb, input.site_slug, enrichedText);
  const { internal_links: entityLinks, images: entityImages } = buildEntityDerivedLinks(entities, input.site_slug);

  // ─── 3. Internal links (opportunity table + entity hits) ────
  const engine = await buildInternalLinks({
    sb: input.sb,
    site_slug: input.site_slug,
    site_id: input.site_id,
    working_title: c.working_title,
    primary_query: null,
    candidate_url: null,
  });
  // Merge entity-derived links on top of opportunity links. Dedupe
  // by target_url; keep the higher priority.
  const linksMap = new Map<string, EvidenceInternalLink>();
  for (const l of engine.outbound) linksMap.set(l.target_url, l);
  for (const l of entityLinks) {
    const existing = linksMap.get(l.target_url);
    if (!existing || existing.priority < l.priority) linksMap.set(l.target_url, l);
  }
  const outbound = Array.from(linksMap.values()).sort((a, b) => b.priority - a.priority).slice(0, 12);

  // ─── 4. Images (entity-scoped, with safe fallback) ──────────
  const images: EvidenceImage[] = entityImages.map((img, i) => ({
    media_id: null,
    source_url: img.source_url,
    alt_text: img.alt_text,
    width: null,
    height: null,
    card_slug: null,
    set_code: null,
    role_suggestion: i === 0 ? 'featured' : 'inline',
  }));

  // ─── 5. Existing content overlap ────────────────────────────
  let closest = 0;
  let similar = 0;
  for (const a of input.existing_articles) {
    const o = lexicalOverlap(c.working_title, a.title);
    if (o > closest) closest = o;
    if (o > 0.3) similar += 1;
  }

  // ─── 6. Official corroboration ──────────────────────────────
  const corroboration = await findOfficialCorroboration(
    input.sb,
    input.site_slug,
    c,
    input.all_signals_in_pool,
  );

  // ─── 7. Build the research pack ─────────────────────────────
  const packBuilt = await buildEvidencePack(input.sb, {
    site_slug: input.site_slug,
    site_name: input.site_name,
    site_id: input.site_id,
    template_id: c.template_id,
    working_title: c.working_title,
    primary_query: null,
    secondary_queries: [],
    summary: c.signals[0]?.summary ?? null,
    date_range_days: 30,
    external_signals: c.signals,
    extracted_by_url: extractedByUrl,
    approved_internal_links: outbound,
    budget: {
      max_cost_usd: input.max_cost_per_article_usd,
      projected_draft_cost_usd: 0,
      projected_qa_cost_usd: null,
    },
  });

  // Overlay the entity-derived images onto the pack. Keeps the pack
  // image list grounded in cards actually mentioned.
  if (images.length > 0) packBuilt.payload.images = images;

  const evidence_quality = evaluateEvidenceQuality(packBuilt.payload);

  // ─── 8. Final editorial score ───────────────────────────────
  const final_signals: ScoringSignals = {
    search_impressions_28d: 0,
    search_clicks_28d: 0,
    search_position_avg: null,
    search_striking_distance_count: 0,
    market_observations: packBuilt.payload.market_data.length,
    market_max_abs_percentage_change: Math.max(0, ...packBuilt.payload.market_data.map((m) => Math.abs(m.percentage_change))),
    signal_age_days: c.age_days ?? 7,
    images_available: images.length,
    internal_link_candidates: outbound.length,
    related_pages: packBuilt.payload.related_pages.length,
    affiliate_links_available: packBuilt.payload.commercial_links.length,
    existing_similar_articles: similar,
    closest_existing_overlap: closest,
    closest_existing_age_days: null,
    template_complexity: c.template_id === 'news' || c.template_id === 'trend_story' ? 'medium' : 'low',
    external_source_count: c.signals.length,
    external_official_count: c.signals.filter((s) => s.source_tier === 'official').length + (corroboration.found ? corroboration.sources.filter((x) => x.tier === 'official').length : 0),
    external_secondary_count: c.signals.filter((s) => s.source_tier === 'secondary').length,
    external_community_count: c.signals.filter((s) => s.source_tier === 'community').length,
    external_distinct_domains: new Set(c.signals.map((s) => s.domain)).size,
    external_newest_age_days: c.age_days,
  };

  const existingRouting = input.existing_articles.map((a) => ({
    article_id: a.id,
    url: a.publication_url ?? `https://ygoprices.io/insights/${a.slug}`,
    overlap: lexicalOverlap(c.working_title, a.title),
    age_days: a.published_at ? Math.max(0, Math.floor((Date.now() - new Date(a.published_at).getTime()) / 86_400_000)) : null,
  }));
  const scored = buildScoredOpportunity(
    {
      idea_id: c.kind === 'internal_idea' ? c.key : `ext:${c.key}`,
      site_slug: input.site_slug,
      working_title: c.working_title,
      template_id: c.template_id,
      signals: final_signals,
    },
    existingRouting,
  );

  const eligible = scored.score.total >= 60 && evidence_quality.status === 'ready';

  return {
    discovery: c,
    entities: {
      cards: entities.cards.map((card) => ({ name: card.name, collector_number: card.collector_number, url: `https://ygoprices.io/card/${(card.collector_number ?? card.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, image_url: card.image_url })),
      sets: entities.sets.map((s) => ({ name: s.name, code: s.code, url: `https://ygoprices.io/sets/${s.code.toLowerCase()}` })),
    },
    internal_links_outbound: outbound,
    internal_links_inbound_opportunity_count: engine.inbound_opportunities.length,
    images,
    external_sources: packBuilt.payload.external_sources,
    official_corroboration: corroboration,
    existing_similar_count: similar,
    closest_existing_overlap: closest,
    final_score: scored.score,
    routing: scored.routing,
    evidence_pack: packBuilt.payload,
    evidence_quality,
    eligible_for_generation: eligible,
  };
}

// ─── Helpers ───────────────────────────────────────────────────

interface CorroborationResult {
  attempted: boolean;
  found: boolean;
  reason: string;
  sources: Array<{ url: string; publisher: string; tier: SourceTier }>;
}

async function findOfficialCorroboration(
  sb: SupabaseClient,
  siteSlug: AutopilotSiteSlug,
  candidate: DiscoveryCandidate,
  pool: ResearchInput['all_signals_in_pool'],
): Promise<CorroborationResult> {
  // Internal-idea candidates: not applicable.
  if (candidate.kind !== 'external_cluster') {
    return { attempted: false, found: false, reason: 'candidate is an internal idea — official corroboration is not applicable.', sources: [] };
  }
  // Already has an official signal in its own cluster.
  const inCluster = candidate.signals.filter((s) => s.source_tier === 'official');
  if (inCluster.length > 0) {
    return {
      attempted: true,
      found: true,
      reason: `${inCluster.length} official source(s) in the same cluster`,
      sources: inCluster.map((s) => ({ url: s.url, publisher: s.source_name, tier: 'official' })),
    };
  }

  // Check the broader pool for an official signal sharing this cluster_key.
  const clusterKey = candidate.signals[0]?.cluster_key ?? null;
  if (clusterKey) {
    const inPool = pool.filter((s) => s.cluster_key === clusterKey && s.source_tier === 'official');
    if (inPool.length > 0) {
      return {
        attempted: true,
        found: true,
        reason: `${inPool.length} official source(s) found in discovery pool matching cluster_key`,
        sources: inPool.map((s) => ({ url: s.url, publisher: s.source_name, tier: 'official' })),
      };
    }
  }

  // Nothing in-pool — explain what's possible given the registry.
  const sources = await listSources(sb, siteSlug);
  const manualOfficial = sources.filter((s) => s.enabled && s.tier === 'official' && s.discovery_method === 'manual');
  const feedOfficial = sources.filter((s) => s.enabled && s.tier === 'official' && s.discovery_method !== 'manual');
  if (feedOfficial.length > 0) {
    return {
      attempted: true,
      found: false,
      reason: `No matching cluster signal from the enabled official feed(s): ${feedOfficial.map((s) => s.name).join(', ')}.`,
      sources: [],
    };
  }
  if (manualOfficial.length > 0) {
    return {
      attempted: true,
      found: false,
      reason: `Official sources (${manualOfficial.map((s) => s.name).join(', ')}) are configured with discovery_method=manual and have no searchable feed. Corroboration cannot be determined automatically yet.`,
      sources: [],
    };
  }
  return {
    attempted: true,
    found: false,
    reason: 'No official sources are enabled for this site.',
    sources: [],
  };
}

function lexicalOverlap(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let inter = 0;
  for (const t of tokensA) if (tokensB.has(t)) inter += 1;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : inter / union;
}

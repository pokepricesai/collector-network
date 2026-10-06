import 'server-only';

// Stage-1 discovery pre-score (0..40).
//
// Uses only information available at discovery time:
//   * recency of the newest supporting signal
//   * trust tier of supporting publishers
//   * cluster breadth (how many distinct publishers)
//   * cluster depth (how many signals in the cluster)
//   * YGO/TCG relevance in the headline + feed summary
//   * approximate content gap vs existing published articles
//
// Deliberately does NOT include:
//   * evidence_quality beyond "the signal exists"
//   * internal-link counts (we haven't computed them)
//   * image availability
//   * extracted-source depth
//
// The score ceiling is 40 — explicitly shallower than the final
// editorial score — so the admin can see at a glance that this is
// a pre-research sort key.

import type { DiscoveredSignal, DiscoveryCandidate, SourceTier } from './types';

const WEIGHTS = Object.freeze({
  recency: 10,
  authority: 10,
  cluster_breadth: 5,
  cluster_depth: 5,
  relevance: 5,
  gap: 5,
});

const YGO_RELEVANCE_TERMS: readonly string[] = [
  'yu-gi-oh', 'yugioh', 'ygo', 'konami', 'duel master', 'rush duel',
  'master duel', 'speed duel', 'blue-eyes', 'dark magician', 'exodia',
  'synchro', 'xyz', 'link', 'pendulum', 'tcg', 'ocg', 'maximum gold',
  'duel monsters', 'archetype', 'banlist', 'forbidden', 'limited list',
  'secret rare', 'ultra rare', 'ghost rare', 'quarter century',
];

export interface DiscoveryScoreInput {
  signals: DiscoveredSignal[];                        // cluster signals (external only; [] for internal)
  kind: 'internal_idea' | 'external_cluster';
  working_title: string;
  existing_similar_count: number;                     // from a cheap title-lexical scan
}

export interface DiscoveryScoreOutput {
  score: number;                                      // 0..40
  rationale: string[];
}

export function scoreDiscovery(input: DiscoveryScoreInput): DiscoveryScoreOutput {
  const rationale: string[] = [];
  let score = 0;

  // 1. Recency — 0..10.
  let newestAge = Infinity;
  for (const s of input.signals) {
    if (!s.published_at) continue;
    const age = Math.max(0, Math.floor((Date.now() - new Date(s.published_at).getTime()) / 86_400_000));
    if (age < newestAge) newestAge = age;
  }
  if (!Number.isFinite(newestAge)) newestAge = input.kind === 'internal_idea' ? 1 : 14;
  const recency =
    newestAge <= 1 ? WEIGHTS.recency :
    newestAge <= 3 ? 8 :
    newestAge <= 7 ? 6 :
    newestAge <= 14 ? 3 : 0;
  score += recency;
  if (input.signals.length > 0 || input.kind === 'internal_idea') {
    rationale.push(`Recency: newest signal ${newestAge}d old → ${recency}/${WEIGHTS.recency}`);
  }

  // 2. Authority — 0..10. Weighted by the HIGHEST tier in the cluster.
  //    Official = 10, Secondary = 5, Community = 2, Internal = 4.
  let authority = input.kind === 'internal_idea' ? 4 : 2;
  for (const s of input.signals) {
    const tierScore: Record<SourceTier, number> = { official: 10, secondary: 5, community: 2 };
    const v = tierScore[s.source_tier] ?? 2;
    if (v > authority) authority = v;
  }
  score += authority;
  rationale.push(`Authority: best tier gives ${authority}/${WEIGHTS.authority}`);

  // 3. Cluster breadth — 0..5. Distinct publishers.
  const distinctPublishers = new Set(input.signals.map((s) => s.domain)).size;
  const breadth = Math.min(WEIGHTS.cluster_breadth, distinctPublishers > 0 ? distinctPublishers + 1 : 0);
  if (distinctPublishers > 0) {
    rationale.push(`Breadth: ${distinctPublishers} distinct publisher${distinctPublishers === 1 ? '' : 's'} → ${breadth}/${WEIGHTS.cluster_breadth}`);
  }
  score += breadth;

  // 4. Cluster depth — 0..5. Number of signals in the cluster.
  const depth = Math.min(WEIGHTS.cluster_depth, Math.ceil(input.signals.length / 2));
  if (input.signals.length > 0) {
    rationale.push(`Depth: ${input.signals.length} signal(s) → ${depth}/${WEIGHTS.cluster_depth}`);
  }
  score += depth;

  // 5. Topic relevance — 0..5. Headline/summary mentions YGO terms.
  const text = (input.working_title + ' ' + input.signals.map((s) => (s.summary ?? '')).join(' ')).toLowerCase();
  let relevanceHits = 0;
  for (const t of YGO_RELEVANCE_TERMS) if (text.includes(t)) relevanceHits += 1;
  const relevance = Math.min(WEIGHTS.relevance, relevanceHits);
  score += relevance;
  if (relevance > 0) rationale.push(`Relevance: ${relevanceHits} YGO/TCG term match(es) → ${relevance}/${WEIGHTS.relevance}`);

  // 6. Content gap — 0..5. Lower existing-overlap counts = fuller marks.
  const gap =
    input.existing_similar_count === 0 ? WEIGHTS.gap :
    input.existing_similar_count === 1 ? 3 :
    input.existing_similar_count <= 3 ? 2 : 0;
  score += gap;
  rationale.push(`Gap: ${input.existing_similar_count} existing article(s) similar → ${gap}/${WEIGHTS.gap}`);

  // Clamp
  if (score < 0) score = 0;
  if (score > 40) score = 40;

  return { score, rationale };
}

export const DISCOVERY_SCORE_MAX = 40;
export const DISCOVERY_SHORTLIST_SIZE = 5;

// Helper for the pipeline: converts a cluster of raw signals + a
// title into a DiscoveryCandidate ready to be ranked.
export function toDiscoveryCandidate(
  kind: 'internal_idea' | 'external_cluster',
  key: string,
  working_title: string,
  template_id: DiscoveryCandidate['template_id'],
  signals: DiscoveredSignal[],
  existing_similar_count: number,
): DiscoveryCandidate {
  const { score, rationale } = scoreDiscovery({
    signals,
    kind,
    working_title,
    existing_similar_count,
  });
  const newestPublished = signals
    .map((s) => s.published_at)
    .filter(Boolean)
    .sort()
    .reverse()[0];
  const age_days = newestPublished
    ? Math.max(0, Math.floor((Date.now() - new Date(newestPublished).getTime()) / 86_400_000))
    : null;
  const publishers = Array.from(
    new Map(signals.map((s) => [s.domain, { name: s.source_name, tier: s.source_tier, domain: s.domain }])).values(),
  );
  return {
    kind,
    key,
    working_title,
    template_id,
    signals,
    publishers,
    age_days,
    discovery_score: score,
    discovery_rationale: rationale,
  };
}

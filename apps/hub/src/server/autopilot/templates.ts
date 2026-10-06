import 'server-only';

// Deterministic article templates.
//
// Each template defines:
//   * sections — ordered list, each with evidence restrictions
//   * min_evidence — gate against generating when the pack is thin
//
// The AI never invents structure. It receives the template + the
// evidence pack and fills in the per-section prose. QA enforces that
// each section's claims trace back to the evidence slots allowed by
// that section.

import type { ArticleTemplate, ArticleTemplateId } from './types';

export const MARKET_MOVERS_TEMPLATE: ArticleTemplate = {
  id: 'market_movers',
  label: 'Market movers',
  description: 'Short editorial note on card prices moving the most in a defined window.',
  sections: [
    { id: 'intro',         heading_level: null, title_hint: 'Standfirst',       min_sentences: 1, max_sentences: 3, evidence: ['market_data', 'topic', 'date_range'], required: true },
    { id: 'methodology',   heading_level: 2,    title_hint: 'How we measured',  min_sentences: 1, max_sentences: 2, evidence: ['methodology', 'date_range'],         required: true },
    { id: 'top_movers',    heading_level: 2,    title_hint: 'Top movers',       min_sentences: 1, max_sentences: 2, evidence: ['market_data'],                       required: true },
    { id: 'card_detail',   heading_level: 3,    title_hint: 'Per-card detail',  min_sentences: 3, max_sentences: 10, evidence: ['market_data', 'images'],            required: true },
    { id: 'context',       heading_level: 2,    title_hint: 'What changed',     min_sentences: 1, max_sentences: 3, evidence: ['topic'],                             required: false },
    { id: 'what_to_watch', heading_level: 2,    title_hint: 'What to watch',    min_sentences: 1, max_sentences: 2, evidence: ['market_data'],                       required: false },
    { id: 'related',       heading_level: 2,    title_hint: 'Related',          min_sentences: 1, max_sentences: 2, evidence: ['related_pages', 'internal_links'],   required: false },
    { id: 'close',         heading_level: null, title_hint: 'Short close',      min_sentences: 1, max_sentences: 1, evidence: ['topic'],                             required: false },
  ],
  min_evidence: { market_data: 3, images: 1 },
};

export const SET_GUIDE_TEMPLATE: ArticleTemplate = {
  id: 'set_guide',
  label: 'Set guide',
  description: 'Reference piece on a single Yu-Gi-Oh! set — overview, key cards, market observations, watchlist.',
  sections: [
    { id: 'set_overview',  heading_level: null, title_hint: 'Standfirst',       min_sentences: 2, max_sentences: 4, evidence: ['topic', 'related_pages'],         required: true },
    { id: 'set_key_cards', heading_level: 2,    title_hint: 'Key cards',        min_sentences: 2, max_sentences: 8, evidence: ['market_data', 'images'],          required: true },
    { id: 'set_market',    heading_level: 2,    title_hint: 'Market',           min_sentences: 1, max_sentences: 3, evidence: ['market_data'],                    required: true },
    { id: 'set_watchlist', heading_level: 2,    title_hint: 'Watchlist',        min_sentences: 2, max_sentences: 6, evidence: ['market_data', 'related_pages'],   required: false },
    { id: 'related',       heading_level: 2,    title_hint: 'Related',          min_sentences: 1, max_sentences: 2, evidence: ['related_pages', 'internal_links'],required: false },
  ],
  min_evidence: { market_data: 4, images: 1 },
};

export const CARD_GUIDE_TEMPLATE: ArticleTemplate = {
  id: 'card_guide',
  label: 'Card guide',
  description: 'Deep dive on a single card — printings, market position, movement, collecting considerations.',
  sections: [
    { id: 'card_overview',  heading_level: null, title_hint: 'Standfirst',      min_sentences: 2, max_sentences: 4, evidence: ['topic', 'images'],              required: true },
    { id: 'card_printings', heading_level: 2,    title_hint: 'Printings',       min_sentences: 1, max_sentences: 4, evidence: ['market_data'],                  required: true },
    { id: 'card_market',    heading_level: 2,    title_hint: 'Market position', min_sentences: 1, max_sentences: 3, evidence: ['market_data'],                  required: true },
    { id: 'card_movement',  heading_level: 2,    title_hint: 'Recent movement', min_sentences: 1, max_sentences: 4, evidence: ['market_data'],                  required: true },
    { id: 'collecting',     heading_level: 2,    title_hint: 'Collecting',      min_sentences: 1, max_sentences: 3, evidence: ['topic'],                        required: false },
    { id: 'related',        heading_level: 2,    title_hint: 'Related',         min_sentences: 1, max_sentences: 2, evidence: ['related_pages', 'internal_links'], required: false },
  ],
  min_evidence: { market_data: 2, images: 1 },
};

export const EVERGREEN_GUIDE_TEMPLATE: ArticleTemplate = {
  id: 'evergreen_guide',
  label: 'Evergreen guide',
  description: 'How-to / explainer. No price claims unless the pack supports them.',
  sections: [
    { id: 'intro',         heading_level: null, title_hint: 'Standfirst',    min_sentences: 2, max_sentences: 4, evidence: ['topic'],                           required: true },
    { id: 'top_movers',    heading_level: 2,    title_hint: 'Core answer',   min_sentences: 2, max_sentences: 6, evidence: ['topic', 'related_pages'],         required: true },
    { id: 'card_detail',   heading_level: 2,    title_hint: 'Examples',      min_sentences: 2, max_sentences: 8, evidence: ['related_pages', 'market_data'],   required: false },
    { id: 'faq',           heading_level: 2,    title_hint: 'FAQ',           min_sentences: 1, max_sentences: 6, evidence: ['topic'],                           required: false },
    { id: 'related',       heading_level: 2,    title_hint: 'Related',       min_sentences: 1, max_sentences: 2, evidence: ['related_pages', 'internal_links'], required: false },
  ],
  min_evidence: {},  // can run on topic alone
};

export const REFRESH_TEMPLATE: ArticleTemplate = {
  id: 'refresh',
  label: 'Refresh existing article',
  description: 'Minimal-change update of an existing article — refresh prices, dates, and add new context.',
  sections: [
    { id: 'intro',       heading_level: null, title_hint: 'Updated standfirst', min_sentences: 1, max_sentences: 3, evidence: ['topic', 'date_range'],    required: true },
    { id: 'context',     heading_level: 2,    title_hint: 'What changed since', min_sentences: 1, max_sentences: 3, evidence: ['topic'],                   required: true },
    { id: 'top_movers',  heading_level: 2,    title_hint: 'Updated figures',    min_sentences: 1, max_sentences: 4, evidence: ['market_data'],             required: true },
    { id: 'related',     heading_level: 2,    title_hint: 'Related',            min_sentences: 1, max_sentences: 2, evidence: ['related_pages', 'internal_links'], required: false },
  ],
  min_evidence: { market_data: 1 },
};

// External-driven news template. Must have at least one authoritative
// (tier-1 or tier-2) external source. Short, carefully attributed,
// internally-linked. Not a rewrite of the source article.
export const NEWS_TEMPLATE: ArticleTemplate = {
  id: 'news',
  label: 'News update',
  description: 'Report an external announcement with internal collector context. Short, attributed, never a rewrite.',
  sections: [
    { id: 'intro',         heading_level: null, title_hint: 'Lede',             min_sentences: 2, max_sentences: 4, evidence: ['external_sources', 'article_angle', 'topic'],         required: true },
    { id: 'context',       heading_level: 2,    title_hint: 'What was said',    min_sentences: 2, max_sentences: 6, evidence: ['external_sources', 'article_angle'],                   required: true },
    { id: 'card_detail',   heading_level: 2,    title_hint: 'For collectors',   min_sentences: 2, max_sentences: 6, evidence: ['related_pages', 'market_data', 'internal_links'],      required: false },
    { id: 'what_to_watch', heading_level: 2,    title_hint: 'What to watch',    min_sentences: 1, max_sentences: 3, evidence: ['article_angle', 'external_sources'],                   required: false },
    { id: 'related',       heading_level: 2,    title_hint: 'Related',          min_sentences: 1, max_sentences: 2, evidence: ['related_pages', 'internal_links'],                     required: false },
  ],
  min_evidence: { external_sources: 1, images: 1 },
};

export const SET_DEEP_DIVE_TEMPLATE: ArticleTemplate = {
  id: 'set_deep_dive',
  label: 'Set deep dive',
  description: 'Historical / collectability deep dive on a single set. Prefers at least one authoritative external source.',
  sections: [
    { id: 'set_overview',  heading_level: null, title_hint: 'Standfirst',       min_sentences: 2, max_sentences: 4, evidence: ['topic', 'external_sources', 'related_pages'],      required: true },
    { id: 'context',       heading_level: 2,    title_hint: 'Historical context', min_sentences: 2, max_sentences: 6, evidence: ['external_sources', 'article_angle'],              required: true },
    { id: 'set_key_cards', heading_level: 2,    title_hint: 'Key cards',        min_sentences: 2, max_sentences: 8, evidence: ['market_data', 'images', 'related_pages'],          required: true },
    { id: 'set_market',    heading_level: 2,    title_hint: 'Collectability',   min_sentences: 1, max_sentences: 4, evidence: ['market_data', 'external_sources'],                 required: false },
    { id: 'related',       heading_level: 2,    title_hint: 'Related',          min_sentences: 1, max_sentences: 2, evidence: ['related_pages', 'internal_links'],                 required: false },
  ],
  min_evidence: { external_sources: 1 },
};

export const ARCHETYPE_GUIDE_TEMPLATE: ArticleTemplate = {
  id: 'archetype_guide',
  label: 'Archetype guide',
  description: 'Theme / archetype guide — history, key cards, context.',
  sections: [
    { id: 'intro',         heading_level: null, title_hint: 'Standfirst',       min_sentences: 2, max_sentences: 4, evidence: ['topic', 'article_angle'],                           required: true },
    { id: 'context',       heading_level: 2,    title_hint: 'Where it came from', min_sentences: 2, max_sentences: 6, evidence: ['external_sources', 'article_angle'],              required: true },
    { id: 'card_detail',   heading_level: 2,    title_hint: 'Core cards',       min_sentences: 3, max_sentences: 8, evidence: ['related_pages', 'market_data', 'images'],          required: true },
    { id: 'related',       heading_level: 2,    title_hint: 'Related',          min_sentences: 1, max_sentences: 2, evidence: ['related_pages', 'internal_links'],                 required: false },
  ],
  min_evidence: {},
};

export const RETROSPECTIVE_TEMPLATE: ArticleTemplate = {
  id: 'retrospective',
  label: 'Retrospective',
  description: 'Historical retrospective on a set, card, era, or format change. Dates must trace to evidence.',
  sections: [
    { id: 'intro',         heading_level: null, title_hint: 'Lede',             min_sentences: 2, max_sentences: 4, evidence: ['article_angle', 'topic', 'external_sources'],      required: true },
    { id: 'context',       heading_level: 2,    title_hint: 'What happened',    min_sentences: 2, max_sentences: 8, evidence: ['external_sources', 'article_angle'],               required: true },
    { id: 'card_detail',   heading_level: 2,    title_hint: 'The cards involved', min_sentences: 2, max_sentences: 6, evidence: ['market_data', 'related_pages', 'images'],         required: false },
    { id: 'close',         heading_level: 2,    title_hint: 'In hindsight',     min_sentences: 1, max_sentences: 4, evidence: ['article_angle', 'external_sources'],                required: false },
  ],
  min_evidence: { external_sources: 1 },
};

const TEMPLATE_MAP: Record<ArticleTemplateId, ArticleTemplate> = {
  market_movers:      MARKET_MOVERS_TEMPLATE,
  set_guide:          SET_GUIDE_TEMPLATE,
  set_deep_dive:      SET_DEEP_DIVE_TEMPLATE,
  card_guide:         CARD_GUIDE_TEMPLATE,
  card_deep_dive:     CARD_GUIDE_TEMPLATE,       // same contract; the deep_dive flavour comes via angle + token budget
  archetype_guide:    ARCHETYPE_GUIDE_TEMPLATE,
  collector_guide:    EVERGREEN_GUIDE_TEMPLATE,  // alias — same section shape
  evergreen_guide:    EVERGREEN_GUIDE_TEMPLATE,
  search_led:         EVERGREEN_GUIDE_TEMPLATE,  // alias for intent-matched
  news:               NEWS_TEMPLATE,
  trend_story:        NEWS_TEMPLATE,             // same shape; min_evidence enforced by scorer penalty on single-tier
  tournament_context: NEWS_TEMPLATE,
  retrospective:      RETROSPECTIVE_TEMPLATE,
  refresh:            REFRESH_TEMPLATE,
};

export function getTemplate(id: ArticleTemplateId): ArticleTemplate {
  return TEMPLATE_MAP[id];
}

export const BANNED_FILLER_PHRASES: readonly string[] = Object.freeze([
  "whether you're a seasoned collector",
  "whether you're a seasoned player",
  'in today\'s fast-paced',
  'in today\'s competitive',
  'look no further',
  'without further ado',
  'in the world of',
  'in the ever-evolving',
  'take your collection to the next level',
  'this article will explore',
  'in this article',
  'at the end of the day',
  'needless to say',
]);

export const DRAFT_RULES: readonly string[] = Object.freeze([
  'Never invent prices, dates, releases, card facts, trends, percentages, volume, rankings, or quotes.',
  'Only reference cards, sets, printings, URLs, and images present in the evidence pack.',
  'Every monetary and percentage claim must trace to a specific market_data entry.',
  'Do not describe cards as investments. No financial advice framing. No fake urgency.',
  'No generic AI openers such as "whether you\'re a seasoned collector..." or "in today\'s fast-paced world".',
  'Avoid filler, padding, and arbitrary word-count targets. If a section has no useful material, omit it.',
  'Return structured JSON matching the DraftOutput schema. Do not emit prose outside the JSON.',
]);

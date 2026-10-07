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
  // Checkpoint C hardening (no em dashes in the rules themselves to avoid "do as I do"):
  'HARD STYLE RULE. NEVER use an em dash. Any em dash character in the output is a publishing blocker. Rewrite with a comma, colon, parentheses, semicolon, or full stop instead.',
  'HARD STYLE RULE. Paragraph strings must be PLAIN TEXT. Do NOT embed Markdown. No image syntax such as !alt(url), no link syntax such as [text](url), no "###" headings, no bold or italic markers. Images and links belong in the separate section.images and section.internal_links arrays only.',
  'NEVER predict or state a specific rarity (Secret Rare, Ultra Rare, Starlight Rare, Ghost Rare, Collector\'s Rare, Quarter Century, Platinum Secret Rare, Prismatic, etc.) unless the exact rarity string is present in evidence_pack.market_data[].printing or in an external source\'s headline, summary, or facts.',
  'NEVER state as fact that a card will "increase demand", "see renewed collector interest", "command a premium", "sustain demand", "appreciate in value", "attract chase printings", or any similar speculative market claim. If the evidence pack does not explicitly support a market, rarity, price, demand, tournament, or collector claim, either omit it or clearly label it as uncertain (for example, "it is not yet clear whether..."). The deterministic QA pass REJECTS speculative statements of fact.',
  'For news articles: report what the external source actually said. Short attributed quotations only. Do NOT invent collector reactions, market reactions, or tournament implications unless the sources describe them.',
]);

// Phrases that, when present in paragraph text, require matching
// evidence inside the pack. Any match that is NOT corroborated by the
// pack is flagged by deterministic QA as speculative_claim and acts
// as a publishing blocker. The pattern is scanned case-insensitively.
export const SPECULATIVE_CLAIM_PATTERNS: readonly { id: string; pattern: RegExp; label: string }[] = Object.freeze([
  { id: 'increase_demand',        pattern: /\bincrease(?:s|d)?\s+(?:collector\s+)?demand\b/i,         label: 'increase demand' },
  { id: 'renewed_interest',       pattern: /\brenewed\s+(?:collector\s+)?interest\b/i,                label: 'renewed collector interest' },
  { id: 'collector_interest_rise',pattern: /\b(?:collector|player)\s+interest\s+(?:is\s+)?(?:rising|rises|growing|grows|surging|surges|increased?|increasing)\b/i, label: 'collector interest rising' },
  { id: 'command_premium',        pattern: /\bcommand(?:s|ed|ing)?\s+(?:a\s+)?premium\b/i,            label: 'command a premium' },
  { id: 'premium_price',          pattern: /\bpremium\s+(?:prices?|pricing|value)\b/i,                label: 'premium price' },
  { id: 'sustained_demand',       pattern: /\bsustained?\s+(?:collector\s+)?demand\b/i,               label: 'sustained demand' },
  { id: 'chase_printing',         pattern: /\bchase\s+(?:printing|print|rarity|card|version)s?\b/i,   label: 'chase printing' },
  { id: 'market_appreciation',    pattern: /\bmarket\s+(?:appreciation|appreciates?|appreciated?)\b/i, label: 'market appreciation' },
  { id: 'appreciate_in_value',    pattern: /\bappreciat(?:e|es|ed|ing)\s+in\s+value\b/i,              label: 'appreciate in value' },
  { id: 'price_rise',             pattern: /\b(?:price|prices)\s+(?:rise|rises|rising|increase|increases|increased|increasing|climb|climbs|climbed|climbing)\b/i, label: 'price rise' },
  { id: 'rarity_expectation',     pattern: /\bexpect(?:ed|s)?\s+(?:to\s+be\s+a\s+)?(?:secret|ultra|starlight|ghost|collector['’]?s|quarter\s*century|platinum\s+secret|prismatic)\s+rare\b/i, label: 'rarity expectation' },
  { id: 'first_ed_premium',       pattern: /\bfirst\s+edition\s+premiums?\b/i,                        label: 'first edition premium' },
  { id: 'tournament_viability',   pattern: /\btournament\s+viabilit(?:y|ies)\b/i,                     label: 'tournament viability (requires evidence)' },
]);

// Rarity vocabulary. Any rarity named in the article text must be
// present in evidence_pack.market_data[].printing OR in an external
// source's headline/summary/facts. Otherwise flagged as
// rarity_claim_unsupported (blocker). The list is intentionally
// conservative: generic words like "rare" without a modifier are not
// flagged, because the model may legitimately say "the card is rare".
export const RARITY_VOCABULARY: readonly string[] = Object.freeze([
  'Secret Rare',
  'Ultra Rare',
  'Starlight Rare',
  'Ghost Rare',
  'Collector\'s Rare',
  'Collectors Rare',
  'Quarter Century Secret Rare',
  'Quarter Century',
  'Platinum Secret Rare',
  'Prismatic Secret Rare',
  'Prismatic Collector\'s Rare',
  'Prismatic Ultimate Rare',
  'Ultimate Rare',
  'Gold Rare',
  'Premium Gold Rare',
  'Mosaic Rare',
  'Shatterfoil Rare',
  'Starfoil Rare',
  'Super Rare',
  'Common',
]);

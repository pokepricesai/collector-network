import 'server-only';

// Deterministic entity extraction.
//
// Given a text blob (headline + summary + extracted source text) and
// an admin-pilot site, this module matches card names, set names, and
// set codes against the shared Collector Network catalogue:
//
//   * tcg_cards: name (ILIKE), collector_number (exact uppercase)
//   * tcg_sets:  name (ILIKE), code (exact uppercase)
//
// No LLM. Results feed:
//   * image selection (which card images to pull)
//   * internal-link anchor candidates
//   * commercial-link construction (which cards to build eBay URLs for)
//   * research pack `related_pages`

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutopilotSiteSlug } from './config';

export interface ExtractedCard {
  id: string;
  name: string;
  collector_number: string | null;
  rarity: string | null;
  image_url: string | null;
}

export interface ExtractedSet {
  id: string;
  name: string;
  code: string;
}

export interface EntityExtractionResult {
  cards: ExtractedCard[];
  sets: ExtractedSet[];
  raw_tokens: string[];                     // debug: what the extractor fed to the catalogue match
}

const SITE_ORIGIN: Record<AutopilotSiteSlug, string> = {
  ygo:      'https://ygoprices.io',
  pokemon:  'https://pokeprices.io',
  mtg:      'https://mtgprices.io',
  onepiece: 'https://onepieceprices.io',
  lorcana:  'https://lorcanaprices.io',
};

export async function extractEntities(
  sb: SupabaseClient,
  siteSlug: AutopilotSiteSlug,
  text: string,
): Promise<EntityExtractionResult> {
  // Hard-coded tightening after the B.2 live test showed the extractor
  // happily matched "Genesys" + "Anniversary" + "Update" against ten
  // unrelated cards:
  //   * Only 2+ token phrases are allowed as search anchors (single
  //     tokens are nearly always too ambiguous).
  //   * Every DB candidate MUST pass nameAppearsInText(): ≥ 70% of
  //     its significant name tokens must appear as whole words in
  //     the source text. This kills ILIKE substring false positives.
  //   * Common stopwords inside a candidate name are ignored when
  //     computing coverage so "Anniversary" matching a card called
  //     "Anniversary Pack Blue-Eyes" doesn't get a free pass.
  const multiWordPhrases = findCapitalisedPhrases(text, 2, 5).slice(0, 8);
  const setCodes = findSetCodes(text);

  // ─── Set lookup ────────────────────────────────────────────
  const sets: ExtractedSet[] = [];
  const seenSetIds = new Set<string>();

  if (setCodes.length > 0) {
    const { data } = await sb
      .from('tcg_sets')
      .select('id, name, code')
      .eq('game_id', siteSlug)
      .in('code', setCodes)
      .limit(20);
    for (const r of (data ?? []) as Array<{ id: string; name: string; code: string }>) {
      if (seenSetIds.has(r.id)) continue;
      seenSetIds.add(r.id);
      sets.push({ id: r.id, name: r.name, code: r.code });
    }
  }

  for (const phrase of multiWordPhrases) {
    if (sets.length >= 8) break;
    const { data } = await sb
      .from('tcg_sets')
      .select('id, name, code')
      .eq('game_id', siteSlug)
      .ilike('name', `%${phrase}%`)
      .limit(3);
    for (const r of (data ?? []) as Array<{ id: string; name: string; code: string }>) {
      if (seenSetIds.has(r.id)) continue;
      if (!nameAppearsInText(r.name, text)) continue;
      seenSetIds.add(r.id);
      sets.push({ id: r.id, name: r.name, code: r.code });
    }
  }

  // ─── Card lookup ──────────────────────────────────────────
  const cards: ExtractedCard[] = [];
  const seenCardIds = new Set<string>();
  for (const phrase of multiWordPhrases) {
    if (cards.length >= 8) break;
    const { data } = await sb
      .from('tcg_cards')
      .select('id, name, collector_number, rarity, images')
      .eq('game_id', siteSlug)
      .ilike('name', `%${phrase}%`)
      .limit(5);
    for (const r of (data ?? []) as Array<{ id: string; name: string; collector_number: string | null; rarity: string | null; images: { large?: string; normal?: string; small?: string } | null }>) {
      if (seenCardIds.has(r.id)) continue;
      if (!nameAppearsInText(r.name, text)) continue;
      seenCardIds.add(r.id);
      const image_url = r.images?.large ?? r.images?.normal ?? r.images?.small ?? null;
      cards.push({ id: r.id, name: r.name, collector_number: r.collector_number, rarity: r.rarity, image_url });
    }
  }

  return { cards, sets, raw_tokens: multiWordPhrases.slice(0, 20) };
}

// Verifies a candidate name is actually plausibly referenced in the
// source text. For each significant token of the name, check that it
// appears as a whole word (case-insensitive). Return true only if at
// least MATCH_THRESHOLD of the significant tokens hit.
const MATCH_THRESHOLD = 0.7;
function nameAppearsInText(name: string, text: string): boolean {
  const nameTokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (nameTokens.length === 0) return false;
  const textLower = text.toLowerCase();
  let hits = 0;
  for (const t of nameTokens) {
    const re = new RegExp(`\\b${escapeRegex(t)}\\b`);
    if (re.test(textLower)) hits += 1;
  }
  const coverage = hits / nameTokens.length;
  // Single-token names (e.g. "Exodia") must match outright.
  if (nameTokens.length === 1) return coverage === 1;
  return coverage >= MATCH_THRESHOLD;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Match card entities into internal link + image + commercial outputs.
export function buildEntityDerivedLinks(entities: EntityExtractionResult, siteSlug: AutopilotSiteSlug): {
  internal_links: Array<{ target_url: string; anchor_concepts: string[]; reason: 'card_mention' | 'set_mention'; priority: number }>;
  images: Array<{ source_url: string; alt_text: string; card_id: string }>;
} {
  const origin = SITE_ORIGIN[siteSlug];
  const internal_links: Array<{ target_url: string; anchor_concepts: string[]; reason: 'card_mention' | 'set_mention'; priority: number }> = [];
  const images: Array<{ source_url: string; alt_text: string; card_id: string }> = [];
  for (const c of entities.cards.slice(0, 8)) {
    const slug = c.collector_number?.toLowerCase() ?? c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    internal_links.push({
      target_url: `${origin}/card/${slug}`,
      anchor_concepts: [c.name],
      reason: 'card_mention',
      priority: 70,
    });
    if (c.image_url) {
      images.push({ source_url: c.image_url, alt_text: c.name, card_id: c.id });
    }
  }
  for (const s of entities.sets.slice(0, 6)) {
    internal_links.push({
      target_url: `${origin}/sets/${s.code.toLowerCase()}`,
      anchor_concepts: [s.name],
      reason: 'set_mention',
      priority: 55,
    });
  }
  return { internal_links, images };
}

// ─── Tokenisers ────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'in', 'on', 'at', 'to', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'this', 'that', 'these', 'those', 'with', 'into', 'about', 'their',
  'our', 'your', 'his', 'her', 'its', 'they', 'them', 'we', 'us', 'you',
  'news', 'post', 'posts', 'thread', 'discussion', 'review', 'preview',
  'yugioh', 'yu-gi-oh', 'card', 'cards', 'set', 'sets', 'guide',
  'announced', 'reveals', 'reveal', 'reveals', 'announcement', 'new',
]);

function tokenise(text: string): string[] {
  return text
    .split(/[^A-Za-z0-9'-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORDS.has(t.toLowerCase()));
}

// Capitalised multi-token phrases: sequences of minTokens+ Capitalised
// tokens. Deliberately NO single-token fallback — the live test showed
// single-token "proper nouns" like "Genesys" trigger far too many
// false ILIKE positives. Named entities worth matching almost always
// have at least two significant tokens in the source text.
function findCapitalisedPhrases(text: string, minTokens: number, maxTokens: number): string[] {
  const phrases: string[] = [];
  const re = new RegExp(`\\b([A-Z][a-z0-9'-]+(?:\\s+(?:of|the|and|&|[A-Z][a-z0-9'-]+)){${minTokens - 1},${maxTokens - 1}})\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const phrase = m[1]!.trim();
    if (!phrase) continue;
    if (phrases.includes(phrase)) continue;
    // Reject phrases that are all stopwords — e.g. "Anniversary Update".
    const sigTokens = phrase.toLowerCase().split(/\s+/).filter((t) => !STOPWORDS.has(t));
    if (sigTokens.length < Math.max(1, Math.ceil(minTokens / 2))) continue;
    phrases.push(phrase);
  }
  phrases.sort((a, b) => b.length - a.length);
  return phrases.slice(0, 20);
}

// Find set codes — 3-4 uppercase letters or alphanumerics, often with
// a hyphen variant. Loose heuristic.
function findSetCodes(text: string): string[] {
  const codes = new Set<string>();
  const re = /\b([A-Z]{2,4}[0-9]?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const c = m[1]!;
    if (c.length >= 3 && c.length <= 5) codes.add(c);
  }
  return Array.from(codes).slice(0, 10);
}

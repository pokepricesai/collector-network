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
  const tokens = tokenise(text);
  const setCodes = findSetCodes(text);

  // Set lookup — exact code match first (most specific), then
  // name ILIKE for multi-word tokens.
  const sets: ExtractedSet[] = [];
  if (setCodes.length > 0) {
    const { data } = await sb
      .from('tcg_sets')
      .select('id, name, code')
      .eq('game_id', siteSlug)
      .in('code', setCodes)
      .limit(20);
    for (const r of (data ?? []) as Array<{ id: string; name: string; code: string }>) {
      sets.push({ id: r.id, name: r.name, code: r.code });
    }
  }

  // Set name lookup via multi-word phrase candidates — only run when
  // we see at least one Capitalised multi-token phrase, else skip.
  const multiWordPhrases = findCapitalisedPhrases(text, 2, 5).slice(0, 5);
  for (const phrase of multiWordPhrases) {
    if (sets.length >= 10) break;
    const { data } = await sb
      .from('tcg_sets')
      .select('id, name, code')
      .eq('game_id', siteSlug)
      .ilike('name', `%${phrase}%`)
      .limit(3);
    for (const r of (data ?? []) as Array<{ id: string; name: string; code: string }>) {
      if (!sets.some((s) => s.id === r.id)) sets.push({ id: r.id, name: r.name, code: r.code });
    }
  }

  // Card lookup via proper-noun phrases. We prefer longer phrases
  // first to catch multi-word card names (e.g. "Blue-Eyes White
  // Dragon"), then fall back to single Capitalised tokens.
  const cards: ExtractedCard[] = [];
  const seenCardIds = new Set<string>();
  for (const phrase of multiWordPhrases) {
    if (cards.length >= 10) break;
    const { data } = await sb
      .from('tcg_cards')
      .select('id, name, collector_number, rarity, images')
      .eq('game_id', siteSlug)
      .ilike('name', `%${phrase}%`)
      .limit(5);
    for (const r of (data ?? []) as Array<{ id: string; name: string; collector_number: string | null; rarity: string | null; images: { large?: string; normal?: string; small?: string } | null }>) {
      if (seenCardIds.has(r.id)) continue;
      seenCardIds.add(r.id);
      const image_url = r.images?.large ?? r.images?.normal ?? r.images?.small ?? null;
      cards.push({ id: r.id, name: r.name, collector_number: r.collector_number, rarity: r.rarity, image_url });
    }
  }

  return { cards, sets, raw_tokens: tokens.slice(0, 20) };
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

// Capitalised multi-token phrases: sequences of 2+ Capitalised tokens.
// Returns phrases in descending length so the matcher tries the most
// specific first.
function findCapitalisedPhrases(text: string, minTokens: number, maxTokens: number): string[] {
  const phrases: string[] = [];
  const re = new RegExp(`\\b([A-Z][a-z0-9'-]+(?:\\s+(?:of|the|and|&|[A-Z][a-z0-9'-]+)){${minTokens - 1},${maxTokens - 1}})\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const phrase = m[1]!.trim();
    if (phrase && !phrases.includes(phrase)) phrases.push(phrase);
  }
  // Also allow a single Capitalised token >= 4 chars (e.g. "Exodia").
  const single = new RegExp(`\\b([A-Z][a-z0-9'-]{3,})\\b`, 'g');
  let s: RegExpExecArray | null;
  while ((s = single.exec(text)) != null) {
    const token = s[1]!.trim();
    if (token && !phrases.includes(token) && !STOPWORDS.has(token.toLowerCase())) phrases.push(token);
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

import 'server-only';
import type { TcgCard } from '@collector-network/database';
import { getLorcanaClient, getLorcanaGameId } from './client';
import { slugifyCardName } from '../lib/lorcana/slug';
import { characterKeyFromName } from './characters';
import { toLcGamedata } from '../lib/lorcana/gamedata';

// Internal-linking helpers for the /card/[slug] page.
//
// These are deliberately small, capped queries. They exist to feed
// crawlable internal-linking blocks (see CardInternalLinks) so search
// engines can discover related cards without dumping 30+ links per
// section.

export interface InternalLinkTile {
  cardId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  setCode: string | null;
  rarity: string | null;
  collectorNumber: string | null;
}

function pickImage(images: unknown): string | null {
  if (!images || typeof images !== 'object') return null;
  const o = images as Record<string, unknown>;
  for (const k of ['normal', 'small', 'large']) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

interface InternalCardRow {
  id: string;
  name: string;
  rarity: string | null;
  collector_number: string | null;
  images: unknown;
  gamedata: unknown;
  set_id: string;
  tcg_sets?: { code: string | null } | null;
}

function toTile(row: InternalCardRow): InternalLinkTile {
  return {
    cardId: row.id,
    name: row.name,
    slug: slugifyCardName(row.name),
    imageUrl: pickImage(row.images),
    setCode: row.tcg_sets?.code ?? null,
    rarity: row.rarity,
    collectorNumber: row.collector_number,
  };
}

/** Up to N other cards from the same set. */
export async function getCardsInSameSet(
  setId: string,
  excludeCardId: string,
  limit = 8,
): Promise<InternalLinkTile[]> {
  const sb = getLorcanaClient();
  const gameId = await getLorcanaGameId(sb);
  const { data, error } = await sb
    .from('tcg_cards')
    .select('id, name, rarity, collector_number, images, gamedata, set_id, tcg_sets(code)')
    .eq('game_id', gameId)
    .eq('set_id', setId)
    .neq('id', excludeCardId)
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as InternalCardRow[]).map(toTile);
}

/** Up to N other cards sharing the same character (base name).
 *  Only meaningful when the anchor card's cardType is 'character'. */
export async function getOtherCharacterCards(
  characterName: string,
  excludeCardId: string,
  limit = 8,
): Promise<InternalLinkTile[]> {
  const sb = getLorcanaClient();
  const gameId = await getLorcanaGameId(sb);
  const base = characterKeyFromName(characterName);
  const targetSlug = slugifyCardName(base);
  if (!targetSlug) return [];

  // We scan a bounded slice of the Lorcana catalogue and match in
  // memory. The set of CHARACTER rows is small (a few thousand); we
  // over-fetch and filter to the shared character slug.
  const { data, error } = await sb
    .from('tcg_cards')
    .select('id, name, rarity, collector_number, images, gamedata, set_id, tcg_sets(code)')
    .eq('game_id', gameId)
    .ilike('name', `${base}%`)
    .limit(80);
  if (error || !data) return [];
  const rows = data as unknown as InternalCardRow[];
  const out: InternalLinkTile[] = [];
  const seenSlugs = new Set<string>();
  for (const r of rows) {
    if (r.id === excludeCardId) continue;
    const gd = toLcGamedata(r.gamedata);
    if (gd.cardType !== 'character') continue;
    if (slugifyCardName(characterKeyFromName(r.name)) !== targetSlug) continue;
    const nameSlug = slugifyCardName(r.name);
    // De-dupe by logical card name; the card page groups printings.
    if (seenSlugs.has(nameSlug)) continue;
    seenSlugs.add(nameSlug);
    out.push(toTile(r));
    if (out.length >= limit) break;
  }
  return out;
}

/** Up to N other cards of the same rarity, ordered newest first (by
 *  set release), then by name. */
export async function getCardsBySameRarity(
  rarity: string,
  excludeCardId: string,
  limit = 6,
): Promise<InternalLinkTile[]> {
  const sb = getLorcanaClient();
  const gameId = await getLorcanaGameId(sb);
  const { data, error } = await sb
    .from('tcg_cards')
    .select('id, name, rarity, collector_number, images, gamedata, set_id, tcg_sets(code, released_at)')
    .eq('game_id', gameId)
    .eq('rarity', rarity)
    .neq('id', excludeCardId)
    .limit(Math.max(limit * 4, 24));
  if (error || !data) return [];
  interface WithReleased extends InternalCardRow {
    tcg_sets?: { code: string | null; released_at?: string | null } | null;
  }
  const rows = data as unknown as WithReleased[];
  rows.sort((a, b) => {
    const ar = a.tcg_sets?.released_at ?? '';
    const br = b.tcg_sets?.released_at ?? '';
    if (ar !== br) return br.localeCompare(ar);
    return a.name.localeCompare(b.name);
  });
  const seen = new Set<string>();
  const out: InternalLinkTile[] = [];
  for (const r of rows) {
    const slug = slugifyCardName(r.name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(toTile(r));
    if (out.length >= limit) break;
  }
  return out;
}

/** Up to N other cards sharing the primary ink. */
export async function getCardsBySameInk(
  ink: string,
  excludeCardId: string,
  limit = 6,
): Promise<InternalLinkTile[]> {
  const sb = getLorcanaClient();
  const gameId = await getLorcanaGameId(sb);
  const inkLower = ink.toLowerCase();
  // gamedata.ink is inside JSON — we filter in-memory over a bounded
  // slice keyed by the anchor's ink chip. Cheap enough for a page-level
  // internal-links block.
  const { data, error } = await sb
    .from('tcg_cards')
    .select('id, name, rarity, collector_number, images, gamedata, set_id, tcg_sets(code, released_at)')
    .eq('game_id', gameId)
    .neq('id', excludeCardId)
    .limit(400);
  if (error || !data) return [];
  interface WithReleased extends InternalCardRow {
    tcg_sets?: { code: string | null; released_at?: string | null } | null;
  }
  const rows = data as unknown as WithReleased[];
  const filtered = rows.filter((r) => {
    const gd = toLcGamedata(r.gamedata);
    return gd.inks.some((c) => c.toLowerCase() === inkLower);
  });
  filtered.sort((a, b) => {
    const ar = a.tcg_sets?.released_at ?? '';
    const br = b.tcg_sets?.released_at ?? '';
    if (ar !== br) return br.localeCompare(ar);
    return a.name.localeCompare(b.name);
  });
  const seen = new Set<string>();
  const out: InternalLinkTile[] = [];
  for (const r of filtered) {
    const slug = slugifyCardName(r.name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(toTile(r));
    if (out.length >= limit) break;
  }
  return out;
}

// Set-page helper: the top-N characters represented in a set.
export interface CharacterInSet {
  slug: string;
  name: string;
  count: number;
}

export function summariseSetTaxonomy(
  cards: readonly TcgCard[],
): {
  characters: CharacterInSet[];
  inks: string[];
  rarities: string[];
} {
  const byChar = new Map<string, { name: string; count: number }>();
  const inks = new Set<string>();
  const rarities = new Set<string>();
  for (const c of cards) {
    const gd = toLcGamedata(c.gamedata);
    for (const ink of gd.inks) inks.add(ink);
    if (c.rarity) rarities.add(c.rarity);
    if (gd.cardType === 'character') {
      const base = characterKeyFromName(c.name);
      const slug = slugifyCardName(base);
      if (!slug) continue;
      const cur = byChar.get(slug) ?? { name: base, count: 0 };
      cur.count += 1;
      byChar.set(slug, cur);
    }
  }
  const characters: CharacterInSet[] = [];
  for (const [slug, v] of byChar) {
    characters.push({ slug, name: v.name, count: v.count });
  }
  characters.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    characters,
    inks: [...inks],
    rarities: [...rarities],
  };
}

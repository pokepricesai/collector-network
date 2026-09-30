// Lorcana character discovery.
//
// Character identity is the base card name — the part BEFORE the
// " - " subtitle separator. "Mickey Mouse - Brave Little Tailor"
// and "Mickey Mouse - Musketeer" are two versions of the same
// character, "Mickey Mouse".
//
// This module only groups `cardType='CHARACTER'` rows; Actions,
// Items, Locations and Songs never become character pages.

import 'server-only';
import { unstable_cache } from 'next/cache';
import type { TcgCard, TcgSet } from '@collector-network/database';
import { getLorcanaClient } from './client';
import { slugifyCardName } from '../lib/lorcana/slug';
import { toLcGamedata } from '../lib/lorcana/gamedata';

const LORCANA_GAME_ID = 'lorcana';

export interface CharacterListEntry {
  slug: string;         // slug of the base character name
  name: string;         // display name ("Mickey Mouse")
  cardCount: number;    // number of tcg_cards rows with this character
  representativeImage: string | null;
  ink: string | null;   // most common ink for the character (informational)
}

export interface CharacterVersion {
  card: TcgCard;
  set: TcgSet | null;
  versionSubtitle: string | null; // "Brave Little Tailor" etc.
  ink: string | null;
  rarity: string | null;
  image: string | null;
}

export interface CharacterPageData {
  slug: string;
  name: string;
  totalCards: number;
  versions: CharacterVersion[];
  inks: string[];
  representativeImage: string | null;
}

//  Split "Name - Subtitle" and return the base. When the name has no
//  " - " separator, the whole name IS the character (e.g. "Yzma").
export function characterKeyFromName(name: string): string {
  const idx = name.indexOf(' - ');
  return idx > 0 ? name.slice(0, idx).trim() : name.trim();
}

//  Aggregate the whole Lorcana character catalogue. Cached under a
//  long TTL — new releases move slowly.
async function _listCharacters(): Promise<CharacterListEntry[]> {
  const sb = getLorcanaClient();
  const CHUNK = 1000;
  const collected: Array<{ id: string; name: string; images: unknown; gamedata: unknown; rarity: string | null }> = [];
  for (let from = 0; from < 60_000; from += CHUNK) {
    const { data, error } = await sb
      .from('tcg_cards')
      .select('id, name, images, gamedata, rarity')
      .eq('game_id', LORCANA_GAME_ID)
      .range(from, from + CHUNK - 1);
    if (error) throw new Error(`[lorcana/characters] list: ${error.message}`);
    const rows = (data as typeof collected | null) ?? [];
    if (rows.length === 0) break;
    collected.push(...rows);
    if (rows.length < CHUNK) break;
  }
  const grouped = new Map<string, { name: string; count: number; images: string[]; inks: Map<string, number> }>();
  for (const r of collected) {
    const gd = toLcGamedata(r.gamedata);
    if (gd.cardType !== 'character') continue;
    const charName = characterKeyFromName(r.name);
    const key = slugifyCardName(charName);
    if (!key) continue;
    const bucket = grouped.get(key) ?? { name: charName, count: 0, images: [], inks: new Map<string, number>() };
    bucket.count += 1;
    const img = pickImage(r.images);
    if (img) bucket.images.push(img);
    for (const ink of gd.inks) bucket.inks.set(ink, (bucket.inks.get(ink) ?? 0) + 1);
    grouped.set(key, bucket);
  }
  const out: CharacterListEntry[] = [];
  for (const [slug, b] of grouped) {
    const topInk = [...b.inks.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? null;
    out.push({
      slug,
      name: b.name,
      cardCount: b.count,
      representativeImage: b.images[0] ?? null,
      ink: topInk,
    });
  }
  out.sort((a, b) => b.cardCount - a.cardCount || a.name.localeCompare(b.name));
  return out;
}

export const listCharacters = unstable_cache(
  _listCharacters,
  ['lorcana:characters:list', 'v1'],
  { revalidate: 21_600, tags: ['lorcana:taxonomy'] },
);

//  Look up every card row belonging to one character. Kept uncached
//  per-slug so the character page can update the moment a new
//  version ships. Perf-optimised (2026-09-30): instead of scanning
//  the ENTIRE 4k-row Lorcana catalogue in 1000-row chunks we filter
//  server-side by name pattern. Every character-card name in
//  Lorcana is either the bare base name (no subtitle) or of the
//  form "BaseName - Subtitle", so `name = base OR name LIKE 'base - %'`
//  narrows to ≤ 60 rows for even the most-versioned character.
export async function getCharacterBySlug(slug: string): Promise<CharacterPageData | null> {
  const characters = await listCharacters();
  const match = characters.find((c) => c.slug === slug);
  if (!match) return null;

  const sb = getLorcanaClient();
  //  Escape the base name for PostgREST's ILIKE pattern grammar.
  //  Lorcana names contain apostrophes and punctuation but no % or
  //  _ characters in practice; keep the escape defensive anyway.
  const escaped = match.name.replace(/[\\%_]/g, (m) => `\\${m}`);
  const { data, error } = await sb
    .from('tcg_cards')
    .select('*, tcg_sets(*)')
    .eq('game_id', LORCANA_GAME_ID)
    .or(`name.eq.${match.name},name.ilike.${escaped} - %`);
  if (error) throw new Error(`[lorcana/characters] getBySlug ${slug}: ${error.message}`);
  type Joined = TcgCard & { tcg_sets: TcgSet | null };
  const rows = (data as Joined[] | null) ?? [];

  const versions: CharacterVersion[] = [];
  const inks = new Set<string>();
  for (const r of rows) {
    const gd = toLcGamedata(r.gamedata);
    if (gd.cardType !== 'character') continue;
    //  Belt-and-braces: our OR-filter already narrows to base or
    //  base-hyphen-subtitle, but re-slug the LHS and compare to be
    //  sure the row genuinely belongs to this character.
    if (slugifyCardName(characterKeyFromName(r.name)) !== slug) continue;
    const image = pickImage(r.images);
    versions.push({
      card: r,
      set: r.tcg_sets ?? null,
      versionSubtitle: gd.version,
      ink: gd.inks[0] ?? null,
      rarity: r.rarity ?? null,
      image,
    });
    for (const ink of gd.inks) inks.add(ink);
  }
  if (versions.length === 0) return null;
  versions.sort((a, b) => {
    const releaseA = a.set?.released_at ?? '';
    const releaseB = b.set?.released_at ?? '';
    if (releaseA !== releaseB) return releaseB.localeCompare(releaseA);
    return (a.card.collector_number ?? '').localeCompare(b.card.collector_number ?? '');
  });
  return {
    slug,
    name: match.name,
    totalCards: versions.length,
    versions,
    inks: [...inks],
    representativeImage: versions[0]?.image ?? match.representativeImage,
  };
}

function pickImage(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const candidates = [o['large'], o['normal'], o['small'], o['thumbnail']];
  for (const c of candidates) if (typeof c === 'string' && c.length > 0) return c;
  return null;
}

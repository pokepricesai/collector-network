// Set-checklist completion for the signed-in user.
//
// Contract:
//   A set's DENOMINATOR is the number of distinct base checklist slots
//   in that set. A "slot" is the base collector number stripped of the
//   `_p1` / `_p2` / … parallel suffix and the `_r1` / `_r2` / …
//   reprint suffix. So `OP13-001`, `OP13-001_p1` and `OP13-001_p2`
//   all fill the same slot `OP13-001`.
//
//   A user OWNS a slot if they have any collection row whose
//   underlying tcg_card lives in that set and normalises to the slot
//   base. Any treatment/finish counts.
//
//   Never round up. A set at 5/6 slots reports 83%, not 100%.
//
// This module reads via the caller's own Supabase session so RLS on
// op_collection_items applies. No service role.

import 'server-only';
import type { SupabaseClient, TcgSet } from '@collector-network/database';
import { getSetsByIds } from '@collector-network/database';
import { createServerSupabase } from '@collector-network/auth';
import { slugifyCardName } from '@/lib/onepiece/slug';

// Regex matches the trailing `_p<digits>` (parallel) or `_r<digits>`
// (reprint) suffix. Everything before that is the base slot.
const SUFFIX_RE = /_(?:p|r)\d+$/i;

export function baseChecklistSlot(collectorNumber: string | null): string | null {
  if (!collectorNumber) return null;
  return collectorNumber.replace(SUFFIX_RE, '');
}

export interface MissingSlot {
  slot: string;
  cardName: string;
  slugName: string;
  cardId: string;
}

export interface SetCompletionEntry {
  set: TcgSet;
  totalSlots: number;
  ownedSlots: number;
  percent: number;                 // integer 0-100, never rounds an incomplete set to 100
  missing: MissingSlot[];          // capped list of missing slots (up to 24 for UI)
  missingTotal: number;            // full count of missing slots (missing.length may be < missingTotal after cap)
}

export interface CompletionSummary {
  setsStarted: number;             // sets with at least 1 owned slot
  setsCompleted: number;           // sets with owned == total
  entries: SetCompletionEntry[];   // sorted: closest-to-complete first among not-yet-complete, then completed
}

const MISSING_CAP = 24;

interface CollectionRow {
  tcg_card_id: string;
  tcg_printing_id: string;
}

interface CardRow {
  id: string;
  name: string;
  set_id: string;
  collector_number: string | null;
}

async function fetchOwnedCardIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('op_collection_items')
    .select('tcg_card_id');
  if (error) throw new Error(`[onepiece/completion] collection read: ${error.message}`);
  const ids = new Set<string>();
  for (const r of (data as { tcg_card_id: string }[] | null) ?? []) ids.add(r.tcg_card_id);
  return [...ids];
}

async function fetchCardsByIds(
  supabase: SupabaseClient,
  ids: readonly string[],
): Promise<CardRow[]> {
  if (ids.length === 0) return [];
  const IN = 100;
  const out: CardRow[] = [];
  for (let i = 0; i < ids.length; i += IN) {
    const slice = ids.slice(i, i + IN);
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('id,name,set_id,collector_number')
      .in('id', slice as string[]);
    if (error) throw new Error(`[onepiece/completion] tcg_cards: ${error.message}`);
    for (const c of (data as CardRow[] | null) ?? []) out.push(c);
  }
  return out;
}

async function fetchAllCardsInSets(
  supabase: SupabaseClient,
  setIds: readonly string[],
): Promise<CardRow[]> {
  if (setIds.length === 0) return [];
  const out: CardRow[] = [];
  const PAGE = 1000;
  for (const setId of setIds) {
    for (let from = 0; ; from += PAGE) {
      const to = from + PAGE - 1;
      const { data, error } = await supabase
        .from('tcg_cards')
        .select('id,name,set_id,collector_number')
        .eq('set_id', setId)
        .range(from, to);
      if (error) throw new Error(`[onepiece/completion] set cards: ${error.message}`);
      const chunk = (data as CardRow[] | null) ?? [];
      out.push(...chunk);
      if (chunk.length < PAGE) break;
    }
  }
  return out;
}

/**
 * Read completion state for every set the current user has at least
 * one card in. Sets they have no card in are omitted. Returns [] when
 * the collection is empty.
 */
export async function getSetCompletionForCurrentUser(): Promise<CompletionSummary> {
  const supabase = await createServerSupabase();
  const ownedCardIds = await fetchOwnedCardIds(supabase);
  if (ownedCardIds.length === 0) {
    return { setsStarted: 0, setsCompleted: 0, entries: [] };
  }
  const ownedCards = await fetchCardsByIds(supabase, ownedCardIds);
  if (ownedCards.length === 0) {
    return { setsStarted: 0, setsCompleted: 0, entries: [] };
  }

  // For every set the user has any card in, mark the base slots the
  // user has covered.
  const ownedSlotsBySet = new Map<string, Set<string>>();
  for (const c of ownedCards) {
    const slot = baseChecklistSlot(c.collector_number);
    if (!slot) continue;
    const bag = ownedSlotsBySet.get(c.set_id) ?? new Set<string>();
    bag.add(slot);
    ownedSlotsBySet.set(c.set_id, bag);
  }
  const startedSetIds = [...ownedSlotsBySet.keys()];

  // Load every card in every started set so we can compute the
  // denominator (distinct base slots) and the missing-list.
  const [allCardsInStartedSets, sets] = await Promise.all([
    fetchAllCardsInSets(supabase, startedSetIds),
    getSetsByIds(supabase, startedSetIds),
  ]);
  const setsById = new Map<string, TcgSet>();
  for (const s of sets) setsById.set(s.id, s);

  // For each started set: group cards by base slot; pick one canonical
  // display name per slot (prefer the base printing when present, else
  // the alphabetically-first card name).
  interface SlotMeta { slot: string; cardName: string; cardId: string }
  const slotsBySet = new Map<string, Map<string, SlotMeta>>();
  for (const c of allCardsInStartedSets) {
    const slot = baseChecklistSlot(c.collector_number);
    if (!slot) continue;
    const bag = slotsBySet.get(c.set_id) ?? new Map<string, SlotMeta>();
    const existing = bag.get(slot);
    // Prefer the row whose collector_number equals the slot (base) so
    // the missing-list links to the base card rather than a Parallel.
    const isBase = c.collector_number === slot;
    if (!existing || isBase) {
      bag.set(slot, { slot, cardName: c.name, cardId: c.id });
    }
    slotsBySet.set(c.set_id, bag);
  }

  const entries: SetCompletionEntry[] = [];
  for (const setId of startedSetIds) {
    const set = setsById.get(setId);
    if (!set) continue;
    const allSlots = slotsBySet.get(setId) ?? new Map<string, SlotMeta>();
    const owned = ownedSlotsBySet.get(setId) ?? new Set<string>();
    const totalSlots = allSlots.size;
    const ownedSlots = [...allSlots.keys()].filter((k) => owned.has(k)).length;
    // Never round an incomplete set to 100.
    const rawPercent = totalSlots === 0 ? 0 : (ownedSlots / totalSlots) * 100;
    const percent =
      ownedSlots >= totalSlots && totalSlots > 0
        ? 100
        : Math.min(99, Math.floor(rawPercent));
    const missingList: MissingSlot[] = [];
    for (const [slot, meta] of allSlots) {
      if (owned.has(slot)) continue;
      missingList.push({
        slot,
        cardName: meta.cardName,
        slugName: slugifyCardName(meta.cardName),
        cardId: meta.cardId,
      });
    }
    missingList.sort((a, b) => a.slot.localeCompare(b.slot, undefined, { numeric: true }));
    const missingTotal = missingList.length;
    const missing = missingList.slice(0, MISSING_CAP);
    entries.push({ set, totalSlots, ownedSlots, percent, missing, missingTotal });
  }

  // Sort: incomplete sets first, closest-to-complete at the top (by
  // percent desc, then fewest missing, then set code). Completed sets
  // (100%) come last so a user's "next milestone" is always the top
  // row.
  entries.sort((a, b) => {
    const aComplete = a.percent === 100;
    const bComplete = b.percent === 100;
    if (aComplete !== bComplete) return aComplete ? 1 : -1;
    if (a.percent !== b.percent) return b.percent - a.percent;
    const aMissing = a.totalSlots - a.ownedSlots;
    const bMissing = b.totalSlots - b.ownedSlots;
    if (aMissing !== bMissing) return aMissing - bMissing;
    return a.set.code.localeCompare(b.set.code);
  });

  const setsStarted = entries.length;
  const setsCompleted = entries.filter((e) => e.percent === 100).length;
  return { setsStarted, setsCompleted, entries };
}


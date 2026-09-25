// Slice F — deck CRUD + card operations + hydration + valuation.
//
// Locked server-side invariants (never violated regardless of what
// the client sends):
//
//   I1  card_key is derived server-side from a card name that has
//       been resolved against tcg_cards. Clients never invent one.
//
//   I2  When a preferred_tcg_printing_id is supplied, the server
//       verifies its printing's underlying tcg_card.name normalises
//       to the same card_key. Cross-family preferences are rejected.
//
//   I3  F&L copy limits are recomputed across Main + Extra + Side
//       combined on every write. The DB CHECK (quantity ≤ 3) is a
//       safety net; the real per-family cap is enforced here.
//
//   I4  Section placement is validated server-side via the same
//       validatePlacement() the UI uses. The client cannot smuggle
//       a Link monster into Main by sending section='main'.
//
// Every read/write goes through the caller's own Supabase session
// (@supabase/ssr createServerClient with the user's auth cookie).
// RLS enforces owner-only visibility. No service-role code path.

import {
  getPrintingsForCards,
  getSetsByIds,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
} from '@collector-network/database';
import { createServerSupabase } from '@collector-network/auth';
import {
  getRetailQuotesForPrintings,
  selectPreferredRetailQuote,
} from '@collector-network/market-data';
import {
  allowedSections,
  normaliseCardKey,
  readFnlStatus,
  type FnlStatus,
  type Section,
} from '../lib/deck-identity';
import {
  evaluateDeckLegality,
  validatePlacement,
  type DeckCardInput,
  type LegalityResult,
} from '../lib/deck-legality';

const DECKS = 'ygo_decks';
const DECK_CARDS = 'ygo_deck_cards';

// ── Result types ────────────────────────────────────────────────

export interface TableMissing { ok: false; reason: 'table-missing'; }
export interface Failure { ok: false; reason: 'failed'; error: string; }
export interface Success<T> { ok: true; value: T; }
export type DeckResult<T> = Success<T> | TableMissing | Failure;

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    /does not exist/i.test(err.message ?? '') ||
    /Could not find the table/i.test(err.message ?? '')
  );
}

// ── Public shapes ───────────────────────────────────────────────

export interface DeckRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  format: 'tcg';
  created_at: string;
  updated_at: string;
}

export interface DeckCardRow {
  id: string;
  deck_id: string;
  card_key: string;
  card_name: string;
  preferred_tcg_printing_id: string | null;
  section: Section;
  quantity: number;
  created_at: string;
  updated_at: string;
}

// Hydrated view served to the builder + library. Includes gameplay
// metadata (frameType, F&L) and the priced representative printing.
export interface DeckCardHydrated {
  row: DeckCardRow;
  representative: TcgCard | null;
  preferredPrinting: TcgPrinting | null;
  representativePrinting: TcgPrinting | null;
  set: TcgSet | null;
  fnlStatus: FnlStatus;
  frameType: string | null;
  unitPriceUsd: number | null;
  unitPriceSource: 'preferred-printing' | 'representative-printing' | 'none';
}

export interface DeckSummary {
  deck: DeckRow;
  counts: { main: number; extra: number; side: number; total: number };
  legality: LegalityResult;
  totalValueUsd: number;
  missingPriceCount: number;
}

export interface DeckDetail {
  deck: DeckRow;
  cards: DeckCardHydrated[];
  legality: LegalityResult;
  totalValueUsd: number;
  mainValueUsd: number;
  extraValueUsd: number;
  sideValueUsd: number;
  missingPriceCount: number;
}

// ── Reads ───────────────────────────────────────────────────────

export async function listDecksForCurrentUser(): Promise<DeckResult<DeckSummary[]>> {
  const supabase = await createServerSupabase();
  const { data: decks, error: decksErr } = await supabase
    .from(DECKS)
    .select('*')
    .order('updated_at', { ascending: false });
  if (decksErr) {
    if (isMissingTable(decksErr)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: decksErr.message };
  }
  const deckRows = (decks as DeckRow[] | null) ?? [];
  if (deckRows.length === 0) return { ok: true, value: [] };

  const deckIds = deckRows.map((d) => d.id);
  const { data: cards, error: cardsErr } = await supabase
    .from(DECK_CARDS)
    .select('*')
    .in('deck_id', deckIds);
  if (cardsErr) {
    if (isMissingTable(cardsErr)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: cardsErr.message };
  }
  const deckCards = (cards as DeckCardRow[] | null) ?? [];
  const byDeck = new Map<string, DeckCardRow[]>();
  for (const c of deckCards) {
    const arr = byDeck.get(c.deck_id) ?? [];
    arr.push(c);
    byDeck.set(c.deck_id, arr);
  }

  // Batch hydrate every card_key referenced by every deck.
  const keys = Array.from(new Set(deckCards.map((c) => c.card_key)));
  const meta = await fetchRepresentativeCards(supabase, keys);

  const preferredIds = Array.from(
    new Set(
      deckCards
        .map((c) => c.preferred_tcg_printing_id)
        .filter((x): x is string => !!x),
    ),
  );
  const preferredById = await fetchPrintingsByIds(supabase, preferredIds);

  const repCardIds = Array.from(
    new Set(
      [...meta.values()]
        .map((m) => m.representative?.id)
        .filter((x): x is string => !!x),
    ),
  );
  const repPrintings = await fetchOneRepresentativePrintingPerCard(supabase, repCardIds);

  const printingIdsForPricing = Array.from(
    new Set([
      ...preferredIds,
      ...[...repPrintings.values()].map((p) => p.id),
    ]),
  );
  const priceByPrinting = await fetchRetailUsdByPrinting(supabase, printingIdsForPricing);

  const summaries: DeckSummary[] = deckRows.map((deck) => {
    const rows = byDeck.get(deck.id) ?? [];
    const inputs: DeckCardInput[] = rows.map((r) => {
      const m = meta.get(r.card_key);
      return {
        card_key: r.card_key,
        card_name: r.card_name,
        section: r.section,
        quantity: r.quantity,
        fnlStatus: m?.fnlStatus ?? 'unlimited',
        frameType: m?.frameType ?? null,
      };
    });
    const legality = evaluateDeckLegality(inputs);
    let totalValueUsd = 0;
    let missingPriceCount = 0;
    for (const r of rows) {
      const priced = pricedForRow(r, meta, preferredById, repPrintings, priceByPrinting);
      if (priced.unitPriceUsd == null) missingPriceCount += 1;
      else totalValueUsd += priced.unitPriceUsd * r.quantity;
    }
    return {
      deck,
      counts: legality.counts,
      legality,
      totalValueUsd,
      missingPriceCount,
    };
  });
  return { ok: true, value: summaries };
}

export async function getDeckDetail(deckId: string): Promise<DeckResult<DeckDetail>> {
  const supabase = await createServerSupabase();
  const { data: deckRaw, error: deckErr } = await supabase
    .from(DECKS)
    .select('*')
    .eq('id', deckId)
    .maybeSingle();
  if (deckErr) {
    if (isMissingTable(deckErr)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: deckErr.message };
  }
  if (!deckRaw) return { ok: false, reason: 'failed', error: 'Deck not found' };
  const deck = deckRaw as DeckRow;

  const { data: cards, error: cardsErr } = await supabase
    .from(DECK_CARDS)
    .select('*')
    .eq('deck_id', deckId)
    .order('created_at', { ascending: true });
  if (cardsErr) return { ok: false, reason: 'failed', error: cardsErr.message };
  const deckCards = (cards as DeckCardRow[] | null) ?? [];

  const keys = Array.from(new Set(deckCards.map((c) => c.card_key)));
  const meta = await fetchRepresentativeCards(supabase, keys);
  const preferredIds = Array.from(
    new Set(
      deckCards
        .map((c) => c.preferred_tcg_printing_id)
        .filter((x): x is string => !!x),
    ),
  );
  const preferredById = await fetchPrintingsByIds(supabase, preferredIds);
  const repCardIds = Array.from(
    new Set(
      [...meta.values()]
        .map((m) => m.representative?.id)
        .filter((x): x is string => !!x),
    ),
  );
  const repPrintings = await fetchOneRepresentativePrintingPerCard(supabase, repCardIds);
  const printingIdsForPricing = Array.from(
    new Set([
      ...preferredIds,
      ...[...repPrintings.values()].map((p) => p.id),
    ]),
  );
  const priceByPrinting = await fetchRetailUsdByPrinting(supabase, printingIdsForPricing);

  const setIds = Array.from(
    new Set(
      [...meta.values()]
        .map((m) => m.representative?.set_id)
        .filter((x): x is string => !!x),
    ),
  );
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  const hydrated: DeckCardHydrated[] = deckCards.map((r) => {
    const m = meta.get(r.card_key);
    const priced = pricedForRow(r, meta, preferredById, repPrintings, priceByPrinting);
    const preferredPrinting = r.preferred_tcg_printing_id
      ? preferredById.get(r.preferred_tcg_printing_id) ?? null
      : null;
    const representativePrinting = m?.representative
      ? repPrintings.get(m.representative.id) ?? null
      : null;
    const rep = m?.representative ?? null;
    return {
      row: r,
      representative: rep,
      preferredPrinting,
      representativePrinting,
      set: rep ? setsById.get(rep.set_id) ?? null : null,
      fnlStatus: m?.fnlStatus ?? 'unlimited',
      frameType: m?.frameType ?? null,
      unitPriceUsd: priced.unitPriceUsd,
      unitPriceSource: priced.unitPriceSource,
    };
  });

  const inputs: DeckCardInput[] = hydrated.map((h) => ({
    card_key: h.row.card_key,
    card_name: h.row.card_name,
    section: h.row.section,
    quantity: h.row.quantity,
    fnlStatus: h.fnlStatus,
    frameType: h.frameType,
  }));
  const legality = evaluateDeckLegality(inputs);

  let totalValueUsd = 0;
  let mainValueUsd = 0;
  let extraValueUsd = 0;
  let sideValueUsd = 0;
  let missingPriceCount = 0;
  for (const h of hydrated) {
    if (h.unitPriceUsd == null) {
      missingPriceCount += 1;
      continue;
    }
    const v = h.unitPriceUsd * h.row.quantity;
    totalValueUsd += v;
    if (h.row.section === 'main') mainValueUsd += v;
    else if (h.row.section === 'extra') extraValueUsd += v;
    else sideValueUsd += v;
  }

  return {
    ok: true,
    value: {
      deck,
      cards: hydrated,
      legality,
      totalValueUsd,
      mainValueUsd,
      extraValueUsd,
      sideValueUsd,
      missingPriceCount,
    },
  };
}

// ── Batch hydration helpers ─────────────────────────────────────

interface CardMeta {
  representative: TcgCard | null;
  frameType: string | null;
  fnlStatus: FnlStatus;
}

// Look up each card_key's canonical entry in tcg_cards. Since the
// catalogue lacks a per-card identity table we pick a deterministic
// "representative" row per card family — the one with the lowest id
// (stable) — and read gamedata from it.
async function fetchRepresentativeCards(
  supabase: SupabaseClient,
  cardKeys: readonly string[],
): Promise<Map<string, CardMeta>> {
  const out = new Map<string, CardMeta>();
  if (cardKeys.length === 0) return out;
  // We can't query lower(name) IN (...) directly through PostgREST
  // filter without a computed column, so we fetch all English YGO
  // rows whose lower(name) matches ANY of our keys via ILIKE OR
  // groups in batches.
  const IN_BATCH = 40;
  for (let i = 0; i < cardKeys.length; i += IN_BATCH) {
    const batch = cardKeys.slice(i, i + IN_BATCH);
    const orExpr = batch.map((k) => `name.ilike.${escapeIlike(k)}`).join(',');
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('*')
      .eq('game_id', 'ygo')
      .eq('language', 'en')
      .or(orExpr);
    if (error) throw new Error(`[yugioh/decks] representatives: ${error.message}`);
    const groups = new Map<string, TcgCard[]>();
    for (const c of (data as TcgCard[] | null) ?? []) {
      const key = normaliseCardKey(c.name);
      const bucket = groups.get(key) ?? [];
      bucket.push(c);
      groups.set(key, bucket);
    }
    for (const key of batch) {
      const group = groups.get(key) ?? [];
      if (group.length === 0) {
        out.set(key, { representative: null, frameType: null, fnlStatus: 'unlimited' });
        continue;
      }
      // Deterministic representative: lowest id.
      group.sort((a, b) => a.id.localeCompare(b.id));
      const rep = group[0]!;
      const gd = (rep.gamedata ?? {}) as Record<string, unknown>;
      const frame = typeof gd['frameType'] === 'string' ? (gd['frameType'] as string).toLowerCase() : null;
      out.set(key, {
        representative: rep,
        frameType: frame,
        fnlStatus: readFnlStatus(rep.gamedata),
      });
    }
  }
  return out;
}

function escapeIlike(s: string): string {
  // PostgREST `or=...` requires values to be comma-safe and to
  // escape wildcard chars we don't want. We don't include `%`; we
  // want exact match with ilike (case-insensitive equality).
  return s.replace(/[,()]/g, (m) => `\\${m}`);
}

async function fetchPrintingsByIds(
  supabase: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, TcgPrinting>> {
  const out = new Map<string, TcgPrinting>();
  if (ids.length === 0) return out;
  const IN_BATCH = 100;
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const batch = ids.slice(i, i + IN_BATCH);
    const { data, error } = await supabase
      .from('tcg_printings')
      .select('*')
      .in('id', batch as string[]);
    if (error) throw new Error(`[yugioh/decks] printings: ${error.message}`);
    for (const p of (data as TcgPrinting[] | null) ?? []) out.set(p.id, p);
  }
  return out;
}

// For each representative tcg_cards.id, pick a deterministic
// representative printing (lowest printing id). Used for display +
// fallback valuation when no preferred printing is chosen.
async function fetchOneRepresentativePrintingPerCard(
  supabase: SupabaseClient,
  cardIds: readonly string[],
): Promise<Map<string, TcgPrinting>> {
  const out = new Map<string, TcgPrinting>();
  if (cardIds.length === 0) return out;
  const printings = await getPrintingsForCards(supabase, cardIds);
  const byCard = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const bucket = byCard.get(p.tcg_card_id) ?? [];
    bucket.push(p);
    byCard.set(p.tcg_card_id, bucket);
  }
  for (const [cid, bucket] of byCard) {
    bucket.sort((a, b) => a.id.localeCompare(b.id));
    if (bucket[0]) out.set(cid, bucket[0]);
  }
  return out;
}

async function fetchRetailUsdByPrinting(
  supabase: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const quotes = await getRetailQuotesForPrintings(supabase, ids as string[]);
  const perPrinting = new Map<string, typeof quotes>();
  for (const q of quotes) {
    const bucket = perPrinting.get(q.printingId) ?? [];
    bucket.push(q);
    perPrinting.set(q.printingId, bucket);
  }
  for (const [pid, bucket] of perPrinting) {
    const preferred = selectPreferredRetailQuote(bucket, 'USD');
    if (preferred?.price != null && preferred.currency === 'USD') {
      out.set(pid, preferred.price);
    }
  }
  return out;
}

function pricedForRow(
  r: DeckCardRow,
  meta: Map<string, CardMeta>,
  preferredById: Map<string, TcgPrinting>,
  repPrintings: Map<string, TcgPrinting>,
  priceByPrinting: Map<string, number>,
): { unitPriceUsd: number | null; unitPriceSource: DeckCardHydrated['unitPriceSource'] } {
  // Preferred printing first.
  if (r.preferred_tcg_printing_id) {
    const p = preferredById.get(r.preferred_tcg_printing_id);
    if (p) {
      const price = priceByPrinting.get(p.id);
      if (price != null) return { unitPriceUsd: price, unitPriceSource: 'preferred-printing' };
    }
  }
  // Representative printing fallback.
  const m = meta.get(r.card_key);
  if (m?.representative) {
    const rep = repPrintings.get(m.representative.id);
    if (rep) {
      const price = priceByPrinting.get(rep.id);
      if (price != null) return { unitPriceUsd: price, unitPriceSource: 'representative-printing' };
    }
  }
  return { unitPriceUsd: null, unitPriceSource: 'none' };
}

// ── Writes: decks ──────────────────────────────────────────────

export async function createDeck(input: {
  name: string;
  description?: string | null;
}): Promise<DeckResult<DeckRow>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, reason: 'failed', error: 'Name is required' };
  if (name.length > 120) return { ok: false, reason: 'failed', error: 'Name too long' };
  const description = input.description?.trim() || null;
  const { data, error } = await supabase
    .from(DECKS)
    .insert({ user_id: user.id, name, description })
    .select('*').single();
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: data as DeckRow };
}

export async function renameDeck(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<DeckResult<DeckRow>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const set: Record<string, unknown> = {};
  if (patch.name != null) {
    const name = patch.name.trim();
    if (!name) return { ok: false, reason: 'failed', error: 'Name is required' };
    if (name.length > 120) return { ok: false, reason: 'failed', error: 'Name too long' };
    set.name = name;
  }
  if (patch.description !== undefined) {
    set.description = patch.description?.trim() || null;
  }
  const { data, error } = await supabase
    .from(DECKS)
    .update(set)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*').single();
  if (error) return { ok: false, reason: 'failed', error: error.message };
  return { ok: true, value: data as DeckRow };
}

export async function deleteDeck(id: string): Promise<DeckResult<null>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { error } = await supabase
    .from(DECKS)
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return { ok: false, reason: 'failed', error: error.message };
  return { ok: true, value: null };
}

export async function duplicateDeck(id: string): Promise<DeckResult<DeckRow>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { data: source, error: srcErr } = await supabase
    .from(DECKS).select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (srcErr) return { ok: false, reason: 'failed', error: srcErr.message };
  if (!source) return { ok: false, reason: 'failed', error: 'Deck not found' };
  const sourceDeck = source as DeckRow;
  const { data: cards, error: cardsErr } = await supabase
    .from(DECK_CARDS).select('*').eq('deck_id', id);
  if (cardsErr) return { ok: false, reason: 'failed', error: cardsErr.message };
  const newName = `${sourceDeck.name} Copy`.slice(0, 120);
  const { data: cloned, error: clErr } = await supabase
    .from(DECKS)
    .insert({
      user_id: user.id,
      name: newName,
      description: sourceDeck.description,
      format: sourceDeck.format,
    })
    .select('*').single();
  if (clErr) return { ok: false, reason: 'failed', error: clErr.message };
  const newDeck = cloned as DeckRow;
  const rows = (cards as DeckCardRow[] | null) ?? [];
  if (rows.length > 0) {
    const insertRows = rows.map((r) => ({
      deck_id: newDeck.id,
      card_key: r.card_key,
      card_name: r.card_name,
      preferred_tcg_printing_id: r.preferred_tcg_printing_id,
      section: r.section,
      quantity: r.quantity,
    }));
    const { error: bulkErr } = await supabase.from(DECK_CARDS).insert(insertRows);
    if (bulkErr) {
      // Roll back the empty duplicate — we can't leave a half-copy.
      await supabase.from(DECKS).delete().eq('id', newDeck.id);
      return { ok: false, reason: 'failed', error: bulkErr.message };
    }
  }
  return { ok: true, value: newDeck };
}

// ── Writes: deck cards (with invariants I1-I4) ─────────────────

export interface AddCardInput {
  // The client sends a printing id OR a card name. Both paths flow
  // through server-side identity resolution (I1).
  tcg_printing_id?: string;
  tcg_card_id?: string;
  card_name?: string;
  section: Section;
  deltaQty?: number; // default +1
  preferred_tcg_printing_id?: string | null;
}

// Resolve the client's request into (card_key, card_name, meta,
// preferredPrintingId). Enforces I1 (server-derived key) and I2
// (preferred printing must belong to the same identity).
async function resolveGameplayIdentity(
  supabase: SupabaseClient,
  input: {
    tcg_printing_id?: string;
    tcg_card_id?: string;
    card_name?: string;
    preferred_tcg_printing_id?: string | null;
  },
): Promise<
  | { ok: true; card_key: string; card_name: string; meta: CardMeta; preferred_tcg_printing_id: string | null }
  | { ok: false; error: string }
> {
  // Step 1 — get one canonical name from a catalogue row we look up
  // ourselves. We never trust a client-supplied card_key.
  let name: string | null = null;
  if (input.tcg_printing_id) {
    const { data, error } = await supabase
      .from('tcg_printings').select('id, tcg_card_id').eq('id', input.tcg_printing_id).maybeSingle();
    if (error || !data) return { ok: false, error: 'Unknown printing' };
    const { data: card, error: cardErr } = await supabase
      .from('tcg_cards').select('name').eq('id', data.tcg_card_id).maybeSingle();
    if (cardErr || !card) return { ok: false, error: 'Unknown card for printing' };
    name = (card as { name: string }).name;
  } else if (input.tcg_card_id) {
    const { data, error } = await supabase
      .from('tcg_cards').select('name').eq('id', input.tcg_card_id).maybeSingle();
    if (error || !data) return { ok: false, error: 'Unknown card' };
    name = (data as { name: string }).name;
  } else if (input.card_name) {
    // The card name is authoritative if and only if we can find at
    // least one matching row in the catalogue. We do the lookup with
    // an ILIKE on lower-name because the catalogue lacks a canonical
    // id today (see docs/yugioh/schema-request-slice-f.md).
    const key = normaliseCardKey(input.card_name);
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('name')
      .eq('game_id', 'ygo')
      .eq('language', 'en')
      .ilike('name', escapeIlike(key))
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Card not found in catalogue' };
    name = (data as { name: string }).name;
  } else {
    return { ok: false, error: 'Provide a printing, card id or card name' };
  }

  const card_key = normaliseCardKey(name);
  const metaMap = await fetchRepresentativeCards(supabase, [card_key]);
  const meta = metaMap.get(card_key)!;
  if (!meta.representative) {
    return { ok: false, error: 'Card metadata unavailable' };
  }
  const card_name = meta.representative.name;

  // Invariant I2 — verify the preferred printing belongs to this identity.
  let preferred_tcg_printing_id: string | null = null;
  if (input.preferred_tcg_printing_id) {
    const { data, error } = await supabase
      .from('tcg_printings').select('id, tcg_card_id').eq('id', input.preferred_tcg_printing_id).maybeSingle();
    if (error || !data) return { ok: false, error: 'Unknown preferred printing' };
    const { data: card, error: cardErr } = await supabase
      .from('tcg_cards').select('name').eq('id', (data as { tcg_card_id: string }).tcg_card_id).maybeSingle();
    if (cardErr || !card) return { ok: false, error: 'Unknown preferred printing card' };
    if (normaliseCardKey((card as { name: string }).name) !== card_key) {
      return {
        ok: false,
        error: 'Preferred printing does not match the card being added.',
      };
    }
    preferred_tcg_printing_id = input.preferred_tcg_printing_id;
  }

  return { ok: true, card_key, card_name, meta, preferred_tcg_printing_id };
}

// Load current deck contents for validation. Only fetches columns
// we need for placement checks.
async function loadDeckRows(
  supabase: SupabaseClient,
  deckId: string,
): Promise<DeckCardRow[]> {
  const { data, error } = await supabase
    .from(DECK_CARDS).select('*').eq('deck_id', deckId);
  if (error) throw new Error(`[yugioh/decks] loadDeckRows: ${error.message}`);
  return (data as DeckCardRow[] | null) ?? [];
}

// Add / increment a card in a specific section. Enforces I1-I4.
export async function upsertDeckCard(
  deckId: string,
  input: AddCardInput,
): Promise<DeckResult<DeckCardRow>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };

  // Assert deck ownership before any writes so we return a clean
  // error rather than relying on RLS to silently reject.
  const { data: deck, error: deckErr } = await supabase
    .from(DECKS).select('id, user_id').eq('id', deckId).maybeSingle();
  if (deckErr || !deck || (deck as { user_id: string }).user_id !== user.id) {
    return { ok: false, reason: 'failed', error: 'Deck not found' };
  }

  const identity = await resolveGameplayIdentity(supabase, input);
  if (!identity.ok) return { ok: false, reason: 'failed', error: identity.error };

  const delta = input.deltaQty ?? 1;
  const rows = await loadDeckRows(supabase, deckId);

  // Invariants I3 + I4 — legality check across full deck.
  const existingSectionRow = rows.find(
    (r) => r.card_key === identity.card_key && r.section === input.section,
  );
  const existingSectionCount = existingSectionRow?.quantity ?? 0;
  const existingTotal = rows
    .filter((r) => r.card_key === identity.card_key)
    .reduce((n, r) => n + r.quantity, 0);
  const decision = validatePlacement({
    section: input.section,
    frameType: identity.meta.frameType,
    fnlStatus: identity.meta.fnlStatus,
    existingSectionCount,
    existingTotalAcrossSections: existingTotal,
    deltaQty: delta,
  });
  if (!decision.ok) {
    return { ok: false, reason: 'failed', error: decision.reason ?? 'Cannot place card' };
  }

  const nextQty = existingSectionCount + delta;
  if (nextQty === 0) {
    // Remove the row.
    if (!existingSectionRow) return { ok: false, reason: 'failed', error: 'Nothing to remove' };
    const { error } = await supabase
      .from(DECK_CARDS).delete().eq('id', existingSectionRow.id);
    if (error) return { ok: false, reason: 'failed', error: error.message };
    await touchDeck(supabase, deckId, user.id);
    return { ok: true, value: { ...existingSectionRow, quantity: 0 } };
  }

  if (existingSectionRow) {
    // Update existing row's quantity + optionally the preferred printing.
    const patch: Record<string, unknown> = { quantity: nextQty };
    if (identity.preferred_tcg_printing_id !== null) {
      patch.preferred_tcg_printing_id = identity.preferred_tcg_printing_id;
    }
    const { data, error } = await supabase
      .from(DECK_CARDS)
      .update(patch)
      .eq('id', existingSectionRow.id)
      .select('*').single();
    if (error) return { ok: false, reason: 'failed', error: error.message };
    await touchDeck(supabase, deckId, user.id);
    return { ok: true, value: data as DeckCardRow };
  }

  const { data, error } = await supabase
    .from(DECK_CARDS)
    .insert({
      deck_id: deckId,
      card_key: identity.card_key,
      card_name: identity.card_name,
      preferred_tcg_printing_id: identity.preferred_tcg_printing_id,
      section: input.section,
      quantity: nextQty,
    })
    .select('*').single();
  if (error) return { ok: false, reason: 'failed', error: error.message };
  await touchDeck(supabase, deckId, user.id);
  return { ok: true, value: data as DeckCardRow };
}

export interface SetPreferredPrintingInput {
  card_key: string;                      // may come from client — but see below
  preferred_tcg_printing_id: string | null;
}

// Set (or clear) the preferred printing for every row of a given
// card family in this deck. Enforces I2 by re-resolving the identity
// from the printing side.
export async function setPreferredPrinting(
  deckId: string,
  input: SetPreferredPrintingInput,
): Promise<DeckResult<null>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };

  const { data: deck } = await supabase
    .from(DECKS).select('id, user_id').eq('id', deckId).maybeSingle();
  if (!deck || (deck as { user_id: string }).user_id !== user.id) {
    return { ok: false, reason: 'failed', error: 'Deck not found' };
  }

  let preferred_tcg_printing_id: string | null = null;
  if (input.preferred_tcg_printing_id) {
    const identity = await resolveGameplayIdentity(supabase, {
      card_name: input.card_key,
      preferred_tcg_printing_id: input.preferred_tcg_printing_id,
    });
    if (!identity.ok) return { ok: false, reason: 'failed', error: identity.error };
    if (identity.card_key !== normaliseCardKey(input.card_key)) {
      return { ok: false, reason: 'failed', error: 'Card / printing mismatch' };
    }
    preferred_tcg_printing_id = identity.preferred_tcg_printing_id;
  }
  // Use the normalised key from the client only to *find* rows; the
  // rows themselves store a server-normalised key (see upsertDeckCard).
  const clientKey = normaliseCardKey(input.card_key);
  const { error } = await supabase
    .from(DECK_CARDS)
    .update({ preferred_tcg_printing_id })
    .eq('deck_id', deckId)
    .eq('card_key', clientKey);
  if (error) return { ok: false, reason: 'failed', error: error.message };
  await touchDeck(supabase, deckId, user.id);
  return { ok: true, value: null };
}

async function touchDeck(supabase: SupabaseClient, deckId: string, userId: string) {
  // Explicit updated_at bump — the ygo_touch_updated_at trigger
  // covers ygo_deck_cards, but ygo_decks needs a bump on any child
  // mutation so the library ordering stays fresh.
  await supabase
    .from(DECKS)
    .update({ updated_at: new Date().toISOString() })
    .eq('id', deckId)
    .eq('user_id', userId);
}

// ── DangerZone / dashboard helpers ──────────────────────────────

export async function deleteAllDecksForCurrentUser(): Promise<DeckResult<number>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { data, error, count } = await supabase
    .from(DECKS).delete().eq('user_id', user.id).select('id');
  if (error) {
    if (isMissingTable(error)) return { ok: true, value: 0 };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: count ?? data?.length ?? 0 };
}

export async function getDeckCountForCurrentUser(): Promise<
  DeckResult<{ count: number; mostRecent: DeckRow | null }>
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true, value: { count: 0, mostRecent: null } };
  const { data, error, count } = await supabase
    .from(DECKS)
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingTable(error)) return { ok: true, value: { count: 0, mostRecent: null } };
    return { ok: false, reason: 'failed', error: error.message };
  }
  const rows = (data as DeckRow[] | null) ?? [];
  return { ok: true, value: { count: count ?? 0, mostRecent: rows[0] ?? null } };
}

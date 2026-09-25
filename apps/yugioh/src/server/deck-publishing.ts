// Slice G — publishing / sharing / anonymous-read layer.
//
// Owner mutations (setDeckVisibility, regenerateShareToken) run
// with the caller's Supabase session — RLS enforces they own the
// deck. Anonymous reads use two channels:
//
//   • getPublicDeckBySlug()   — uses the shared read client. The
//     Slice G anon SELECT policy scopes it to visibility='public'.
//     Enumeration is intentional here — that's the whole point.
//
//   • getUnlistedDeckByToken() — calls the SECURITY DEFINER RPCs
//     get_shared_deck_by_token + get_shared_deck_cards_by_token.
//     No anon SELECT policy ever returns an unlisted row, so the
//     RPCs are the only channel; wrong / short / missing tokens
//     return zero rows.
//
// No service-role usage anywhere.

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
  evaluateDeckLegality,
  type DeckCardInput,
  type LegalityResult,
} from '../lib/deck-legality';
import {
  normaliseCardKey,
  readFnlStatus,
  type FnlStatus,
} from '../lib/deck-identity';
import {
  generatePublicSlug,
  generateShareToken,
  isPlausibleShareToken,
  reslugifyKeepingSuffix,
  type Visibility,
} from '../lib/deck-sharing';
import { getYugiohClient } from './read';
import type {
  DeckCardHydrated,
  DeckDetail,
  DeckRow,
} from './decks';

const DECKS = 'ygo_decks';
const DECK_CARDS = 'ygo_deck_cards';

// ── Result types (mirror decks.ts) ──────────────────────────────

export interface Failure { ok: false; reason: 'failed'; error: string; }
export interface NotFound { ok: false; reason: 'not-found'; }
export interface Success<T> { ok: true; value: T; }
export type PublishingResult<T> = Success<T> | Failure | NotFound;

// ── Extended row types ─────────────────────────────────────────

export interface DeckRowWithSharing extends DeckRow {
  visibility: Visibility;
  public_slug: string | null;
  share_token: string | null;
  published_at: string | null;
}

// The shape we hand to the shared renderer. Never carries user_id
// or share_token so it is safe to serialise into a public page.
export interface PublicDeckView {
  id: string;
  name: string;
  description: string | null;
  format: string;
  visibility: Visibility;
  publicSlug: string | null;
  publishedAt: string | null;
  updatedAt: string;
  createdAt: string;
  cards: DeckCardHydrated[];
  legality: LegalityResult;
  totalValueUsd: number;
  mainValueUsd: number;
  extraValueUsd: number;
  sideValueUsd: number;
  missingPriceCount: number;
}

// ── Owner mutations ─────────────────────────────────────────────

export async function setDeckVisibility(
  deckId: string,
  next: Visibility,
): Promise<PublishingResult<DeckRowWithSharing>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };

  // Read existing sharing state so we can preserve slugs/tokens
  // across transitions (spec §4 — old URLs stop working when the
  // owner switches to private, but re-publishing may reuse the
  // same URL to keep links stable).
  const { data: existingRaw, error: existErr } = await supabase
    .from(DECKS)
    .select('*')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (existErr) return { ok: false, reason: 'failed', error: existErr.message };
  if (!existingRaw) return { ok: false, reason: 'not-found' };
  const existing = existingRaw as DeckRowWithSharing;

  const patch: Record<string, unknown> = { visibility: next };

  if (next === 'public') {
    // Preserve the immutable suffix if the deck was previously
    // public and got demoted; otherwise mint a new slug.
    patch.public_slug = existing.public_slug
      ? reslugifyKeepingSuffix(existing.name, existing.public_slug)
      : generatePublicSlug(existing.name);
    if (!existing.published_at) patch.published_at = new Date().toISOString();
  } else if (next === 'unlisted') {
    // Reuse existing token when present; owner has an explicit
    // Regenerate action for rotation.
    if (!existing.share_token) patch.share_token = generateShareToken();
    if (!existing.published_at) patch.published_at = new Date().toISOString();
  }
  // Transition to 'private': DO NOT clear slug/token — that lets
  // us re-publish under the same URL. The public route filters on
  // visibility='public' so the URL 404s immediately anyway.

  const { data, error } = await supabase
    .from(DECKS)
    .update(patch)
    .eq('id', deckId)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error) return { ok: false, reason: 'failed', error: error.message };
  return { ok: true, value: data as DeckRowWithSharing };
}

// Rotate the share token. Only affects unlisted decks.
export async function regenerateShareToken(
  deckId: string,
): Promise<PublishingResult<DeckRowWithSharing>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { data, error } = await supabase
    .from(DECKS)
    .update({ share_token: generateShareToken() })
    .eq('id', deckId)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error) return { ok: false, reason: 'failed', error: error.message };
  return { ok: true, value: data as DeckRowWithSharing };
}

// Slug regeneration is not exposed as an owner action — the whole
// point of the immutable suffix is URL stability. But if a rename
// happens while the deck is public, we keep the slug's suffix and
// refresh the human prefix so /deck/<slug> stays reasonable.
export async function syncPublicSlugAfterRename(
  deckId: string,
): Promise<PublishingResult<null>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true, value: null }; // silent no-op if signed out
  const { data: existingRaw } = await supabase
    .from(DECKS)
    .select('id, name, visibility, public_slug')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!existingRaw) return { ok: false, reason: 'not-found' };
  const existing = existingRaw as { name: string; visibility: Visibility; public_slug: string | null };
  if (existing.visibility !== 'public' || !existing.public_slug) return { ok: true, value: null };
  const updated = reslugifyKeepingSuffix(existing.name, existing.public_slug);
  if (updated === existing.public_slug) return { ok: true, value: null };
  const { error } = await supabase
    .from(DECKS)
    .update({ public_slug: updated })
    .eq('id', deckId)
    .eq('user_id', user.id);
  if (error) return { ok: false, reason: 'failed', error: error.message };
  return { ok: true, value: null };
}

// ── Anonymous reads: public ─────────────────────────────────────

export async function getPublicDeckBySlug(
  slug: string,
): Promise<PublishingResult<PublicDeckView>> {
  const supabase = getYugiohClient(); // anon
  const { data: deckRaw, error } = await supabase
    .from(DECKS)
    .select('id, name, description, format, visibility, public_slug, created_at, updated_at, published_at')
    .eq('public_slug', slug)
    .eq('visibility', 'public')
    .maybeSingle();
  if (error) return { ok: false, reason: 'failed', error: error.message };
  if (!deckRaw) return { ok: false, reason: 'not-found' };
  const deck = deckRaw as PublicMetaRow;
  return hydrateSharedDeck(supabase, deck);
}

// ── Anonymous reads: unlisted (RPC-only) ────────────────────────

export async function getUnlistedDeckByToken(
  token: string,
): Promise<PublishingResult<PublicDeckView>> {
  if (!isPlausibleShareToken(token)) return { ok: false, reason: 'not-found' };
  const supabase = getYugiohClient(); // anon
  const { data: deckRows, error: deckErr } = await supabase.rpc(
    'get_shared_deck_by_token',
    { p_token: token },
  );
  if (deckErr) return { ok: false, reason: 'failed', error: deckErr.message };
  const rows = (deckRows as PublicMetaRow[] | null) ?? [];
  const deck = rows[0];
  if (!deck) return { ok: false, reason: 'not-found' };

  const { data: cardRows, error: cardsErr } = await supabase.rpc(
    'get_shared_deck_cards_by_token',
    { p_token: token },
  );
  if (cardsErr) return { ok: false, reason: 'failed', error: cardsErr.message };
  const cards = (cardRows as Array<{
    id: string;
    deck_id: string;
    card_key: string;
    card_name: string;
    preferred_tcg_printing_id: string | null;
    section: 'main' | 'extra' | 'side';
    quantity: number;
    created_at: string;
    updated_at: string;
  }> | null) ?? [];
  return hydrateSharedDeck(supabase, deck, cards);
}

// ── Owned deck: sharing status for the builder ──────────────────

export async function getOwnedDeckSharing(
  deckId: string,
): Promise<PublishingResult<DeckRowWithSharing>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'not-found' };
  const { data, error } = await supabase
    .from(DECKS)
    .select('*')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { ok: false, reason: 'failed', error: error.message };
  if (!data) return { ok: false, reason: 'not-found' };
  return { ok: true, value: data as DeckRowWithSharing };
}

// ── Copy-to-my-decks (viewer initiates a private copy) ──────────
//
// Reads the source through the same shared-read channels used by
// the public/unlisted routes — so we never grant a copy-op cross-
// user visibility beyond what the viewer could already see. The
// new deck is always PRIVATE regardless of source visibility
// (spec §8).

export async function copySharedDeckToMyDecks(input: {
  source:
    | { kind: 'public'; slug: string }
    | { kind: 'unlisted'; token: string };
}): Promise<PublishingResult<{ id: string }>> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };

  const source =
    input.source.kind === 'public'
      ? await getPublicDeckBySlug(input.source.slug)
      : await getUnlistedDeckByToken(input.source.token);
  if (!source.ok) return source;
  const src = source.value;

  // Create the private copy.
  const { data: newDeck, error: dErr } = await supabase
    .from(DECKS)
    .insert({
      user_id: user.id,
      name: `${src.name} Copy`.slice(0, 120),
      description: src.description,
      format: src.format,
      visibility: 'private',
    })
    .select('id')
    .single();
  if (dErr) return { ok: false, reason: 'failed', error: dErr.message };

  if (src.cards.length > 0) {
    const rows = src.cards.map((c) => ({
      deck_id: (newDeck as { id: string }).id,
      card_key: c.row.card_key,
      card_name: c.row.card_name,
      // Preserve preferred printings — Slice F verified they belong
      // to the same identity server-side when they were set.
      preferred_tcg_printing_id: c.row.preferred_tcg_printing_id,
      section: c.row.section,
      quantity: c.row.quantity,
    }));
    const { error: bulkErr } = await supabase.from(DECK_CARDS).insert(rows);
    if (bulkErr) {
      // Roll back the empty parent — we can't leave a half-copied deck.
      await supabase.from(DECKS).delete().eq('id', (newDeck as { id: string }).id);
      return { ok: false, reason: 'failed', error: bulkErr.message };
    }
  }
  return { ok: true, value: { id: (newDeck as { id: string }).id } };
}

// ── Public discovery (used by sitemap only for now) ─────────────

export interface PublicDeckListItem {
  slug: string;
  name: string;
  publishedAt: string | null;
  updatedAt: string;
}

export async function listPublicDecksForSitemap(
  limit = 500,
): Promise<PublicDeckListItem[]> {
  const supabase = getYugiohClient();
  const { data, error } = await supabase
    .from(DECKS)
    .select('public_slug, name, published_at, updated_at')
    .eq('visibility', 'public')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[yugioh/sitemap] public decks: ${error.message}`);
  const rows = (data as Array<{
    public_slug: string;
    name: string;
    published_at: string | null;
    updated_at: string;
  }> | null) ?? [];
  return rows
    .filter((r) => !!r.public_slug)
    .map((r) => ({
      slug: r.public_slug,
      name: r.name,
      publishedAt: r.published_at,
      updatedAt: r.updated_at,
    }));
}

// ── Internals ───────────────────────────────────────────────────

interface PublicMetaRow {
  id: string;
  name: string;
  description: string | null;
  format: string;
  visibility: Visibility;
  public_slug: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

async function hydrateSharedDeck(
  supabase: SupabaseClient,
  deck: PublicMetaRow,
  presuppliedCards?: Array<{
    id: string;
    deck_id: string;
    card_key: string;
    card_name: string;
    preferred_tcg_printing_id: string | null;
    section: 'main' | 'extra' | 'side';
    quantity: number;
    created_at: string;
    updated_at: string;
  }>,
): Promise<PublishingResult<PublicDeckView>> {
  let cardRows = presuppliedCards;
  if (!cardRows) {
    const { data, error } = await supabase
      .from(DECK_CARDS)
      .select('*')
      .eq('deck_id', deck.id)
      .order('created_at', { ascending: true });
    if (error) return { ok: false, reason: 'failed', error: error.message };
    cardRows = (data as NonNullable<typeof presuppliedCards>) ?? [];
  }
  const rows = [...cardRows];

  const keys = Array.from(new Set(rows.map((c) => c.card_key)));
  const meta = await fetchRepresentativeCards(supabase, keys);
  const preferredIds = Array.from(
    new Set(
      rows
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

  const hydrated: DeckCardHydrated[] = rows.map((r) => {
    const m = meta.get(r.card_key);
    const priced = priceOne(r, meta, preferredById, repPrintings, priceByPrinting);
    const preferredPrinting = r.preferred_tcg_printing_id
      ? preferredById.get(r.preferred_tcg_printing_id) ?? null
      : null;
    const representativePrinting = m?.representative
      ? repPrintings.get(m.representative.id) ?? null
      : null;
    return {
      row: r,
      representative: m?.representative ?? null,
      preferredPrinting,
      representativePrinting,
      set: m?.representative ? setsById.get(m.representative.set_id) ?? null : null,
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
      id: deck.id,
      name: deck.name,
      description: deck.description,
      format: deck.format,
      visibility: deck.visibility,
      publicSlug: deck.public_slug,
      publishedAt: deck.published_at,
      updatedAt: deck.updated_at,
      createdAt: deck.created_at,
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

interface CardMeta {
  representative: TcgCard | null;
  frameType: string | null;
  fnlStatus: FnlStatus;
}

function escapeIlike(s: string): string {
  return s.replace(/[,()]/g, (m) => `\\${m}`);
}

async function fetchRepresentativeCards(
  supabase: SupabaseClient,
  cardKeys: readonly string[],
): Promise<Map<string, CardMeta>> {
  const out = new Map<string, CardMeta>();
  if (cardKeys.length === 0) return out;
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
    if (error) throw new Error(`[yugioh/deck-publishing] representatives: ${error.message}`);
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
      group.sort((a, b) => a.id.localeCompare(b.id));
      const rep = group[0]!;
      const gd = (rep.gamedata ?? {}) as Record<string, unknown>;
      const frame = typeof gd['frameType'] === 'string' ? (gd['frameType'] as string).toLowerCase() : null;
      out.set(key, { representative: rep, frameType: frame, fnlStatus: readFnlStatus(rep.gamedata) });
    }
  }
  return out;
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
    if (error) throw new Error(`[yugioh/deck-publishing] printings: ${error.message}`);
    for (const p of (data as TcgPrinting[] | null) ?? []) out.set(p.id, p);
  }
  return out;
}

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
    if (preferred?.price != null && preferred.currency === 'USD') out.set(pid, preferred.price);
  }
  return out;
}

function priceOne(
  r: { preferred_tcg_printing_id: string | null; card_key: string },
  meta: Map<string, CardMeta>,
  preferredById: Map<string, TcgPrinting>,
  repPrintings: Map<string, TcgPrinting>,
  priceByPrinting: Map<string, number>,
): { unitPriceUsd: number | null; unitPriceSource: DeckDetail['cards'][number]['unitPriceSource'] } {
  if (r.preferred_tcg_printing_id) {
    const p = preferredById.get(r.preferred_tcg_printing_id);
    if (p) {
      const price = priceByPrinting.get(p.id);
      if (price != null) return { unitPriceUsd: price, unitPriceSource: 'preferred-printing' };
    }
  }
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

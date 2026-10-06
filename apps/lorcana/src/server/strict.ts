import 'server-only';
import { cache } from 'react';
import {
  getPrintingsBySet,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
} from '@collector-network/database';
import { getLorcanaClient, getLorcanaGameId } from './client';
import { getSetBundle, type LcSetBundle } from './browse';
import {
  getCardBundleByCardId,
  getCardBundleByName,
  type LcCardBundle,
} from './read';
import { searchCards } from './search';
import { getPrintingHistory, type HistoryBundle } from './history';
import {
  getSetMarketForLorcana,
  type LcSetMarket,
} from './set-market';
import {
  getFinishSplitForSet,
  type FinishSplit,
} from './discovery';
import { slugifyCardName } from '../lib/lorcana/slug';
import { characterKeyFromName } from './characters';
import { toLcGamedata } from '../lib/lorcana/gamedata';
import type { TcgGradedRow } from './graded';
import type { InternalLinkTile } from './internal-links';
import type { LorcanaCurrency } from '../lib/currency';

// Strict + deduplicated factual helpers for ISR routes.
//
// Each helper is:
//   1. Wrapped in React.cache so generateMetadata and the page body
//      share one result per request (eliminates the pre-P1a duplicate
//      Supabase round-trips the audit found).
//   2. Retried on infrastructure failure (3 attempts, backoff
//      100/200/400 ms). A persistent failure throws rather than
//      silently returning an empty value, so the request bubbles an
//      error up to Next.js and is NEVER written to the ISR cache.
//      This is the cache-poisoning safety invariant: a transient DB
//      hiccup must not become a cached 404, empty price history, or
//      hollow card page.
//
// Legitimate "no row" results (e.g. slug didn't resolve, card_id
// doesn't exist) are preserved as `null`/`[]` — those ARE safely
// cacheable catalogue facts.
//
// Non-strict helpers (getSetBundle, getCardBundleByCardId, etc.)
// remain exported from their original modules for callers that still
// run inside Dynamic routes (/card/[slug], /character/[slug], etc.)
// where cache-poisoning is not a concern because the route is not
// cached.

const BACKOFF_MS = [100, 200, 400] as const;

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // Last attempt — fall through to the throw below.
      if (attempt < BACKOFF_MS.length - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`[lorcana/strict] ${label} failed after ${BACKOFF_MS.length} attempts: ${message}`);
}

/** React.cache + retry wrapper around getSetBundle. Preserves null
 *  for legitimate not-found; throws on persistent infra failure. */
export const getSetBundleStrict = cache(
  async (code: string): Promise<LcSetBundle | null> =>
    withRetry(`getSetBundle(${code})`, () => getSetBundle(code)),
);

/** React.cache + retry wrapper around getCardBundleByCardId. */
export const getCardBundleByCardIdStrict = cache(
  async (cardId: string): Promise<LcCardBundle | null> =>
    withRetry(`getCardBundleByCardId(${cardId})`, () => getCardBundleByCardId(cardId)),
);

/** React.cache + retry wrapper around getPrintingHistory. Underlying
 *  helper already throws on error — we just add retries + dedup. */
export const getPrintingHistoryStrict = cache(
  async (printingId: string): Promise<HistoryBundle> =>
    withRetry(`getPrintingHistory(${printingId})`, () => getPrintingHistory(printingId)),
);

interface GradedAnchor {
  printingId: string;
  cardId: string;
}

/** Strict graded reader. The non-strict getGradedRowsForAnchor
 *  swallows database errors and returns whatever partial rows came
 *  back — unsafe for ISR because a transient outage would be baked
 *  into the cache as an empty graded panel. This variant explicitly
 *  checks `error` on each result and retries on infra failure. */
async function _getGradedRowsForAnchorStrict(
  anchor: GradedAnchor,
  supabase: SupabaseClient = getLorcanaClient(),
): Promise<TcgGradedRow[]> {
  const columns =
    'tcg_printing_id, tcg_card_id, attribution, grader, grade, currency, price, card_sales_volume, updated_at';
  const [byPrinting, byCard] = await Promise.all([
    supabase
      .from('tcg_graded_prices_current')
      .select(columns)
      .eq('tcg_printing_id', anchor.printingId)
      .eq('attribution', 'printing')
      .not('price', 'is', null),
    supabase
      .from('tcg_graded_prices_current')
      .select(columns)
      .eq('tcg_card_id', anchor.cardId)
      .eq('attribution', 'card')
      .not('price', 'is', null),
  ]);
  if (byPrinting.error) {
    throw new Error(`graded-by-printing: ${byPrinting.error.message}`);
  }
  if (byCard.error) {
    throw new Error(`graded-by-card: ${byCard.error.message}`);
  }
  const rows: TcgGradedRow[] = [];
  for (const r of (byPrinting.data as TcgGradedRow[] | null) ?? []) rows.push(r);
  for (const r of (byCard.data as TcgGradedRow[] | null) ?? []) rows.push(r);
  return rows;
}

export const getGradedRowsForAnchorStrict = cache(
  async (anchor: GradedAnchor): Promise<TcgGradedRow[]> =>
    withRetry(`getGradedRowsForAnchor(${anchor.printingId})`, () =>
      _getGradedRowsForAnchorStrict(anchor),
    ),
);

// ─────────────────────────────────────────────────────────────────
// P1b: /set/[slug] strict helpers
// ─────────────────────────────────────────────────────────────────

/** React.cache + retry wrapper around getPrintingsBySet. The
 *  underlying helper already throws on error (via throwOnError in
 *  packages/database). The P1b page used to `.catch(() => [])` at
 *  call site — removing that at the page level and routing through
 *  this strict variant means a Supabase outage bubbles up as a 5xx
 *  rather than being baked into the ISR cache as "no printings". */
export const getPrintingsBySetStrict = cache(
  async (setId: string): Promise<TcgPrinting[]> =>
    withRetry(`getPrintingsBySet(${setId})`, () =>
      getPrintingsBySet(getLorcanaClient(), setId),
    ),
);

interface SetMarketOpts {
  setId: string;
  cards: readonly TcgCard[];
  currency: LorcanaCurrency;
  preloadedPrintings: readonly TcgPrinting[];
  topN?: number;
}

/** React.cache + retry wrapper around getSetMarketForLorcana. The
 *  underlying helper's retail-quote fetches already throw on error
 *  (Promise.all surfaces the first rejected batch). This variant
 *  adds a bounded retry loop so a transient Supabase blip doesn't
 *  surface as a cached zero-value set.
 *
 *  Keyed by setId + currency so a request that touches multiple
 *  currencies (e.g. hypothetical future preview tooling) does not
 *  share cached payloads across currencies. The current page only
 *  calls this once per request with DEFAULT_CURRENCY. */
export const getSetMarketForLorcanaStrict = cache(
  async (opts: SetMarketOpts): Promise<LcSetMarket> =>
    withRetry(`getSetMarketForLorcana(${opts.setId}, ${opts.currency})`, () =>
      getSetMarketForLorcana(opts.setId, opts.cards, {
        topN: opts.topN,
        currency: opts.currency,
        preloadedPrintings: opts.preloadedPrintings,
      }),
    ),
);

interface FinishSplitOpts {
  setId: string;
  cards: readonly TcgCard[];
  preloadedPrintings: readonly TcgPrinting[];
}

/** React.cache + retry wrapper around getFinishSplitForSet. Keyed
 *  by setId so the result is dedup'd within a request. The
 *  underlying helper's `priceLookup` throws on retail-quote error
 *  (Promise.all over chunked batches); we always pass preloaded
 *  printings so the swallowing fallback path is never reached. */
export const getFinishSplitForSetStrict = cache(
  async (opts: FinishSplitOpts): Promise<FinishSplit> =>
    withRetry(`getFinishSplitForSet(${opts.setId})`, () =>
      getFinishSplitForSet(opts.cards, opts.preloadedPrintings),
    ),
);

// ─────────────────────────────────────────────────────────────────
// P1c: /card/[slug] (logical card) strict helpers
// ─────────────────────────────────────────────────────────────────

/** React.cache + retry wrapper around getCardBundleByName. The
 *  underlying helper's inner reads already throw via
 *  throwOnError-wrapped @collector-network/database queries. */
export const getCardBundleByNameStrict = cache(
  async (name: string): Promise<LcCardBundle | null> =>
    withRetry(`getCardBundleByName(${name})`, () => getCardBundleByName(name)),
);

/** React.cache + retry wrapper around searchCards used by the
 *  logical card page's slug-fallback name resolution. */
export const searchCardsStrict = cache(
  async (query: string, limit: number): Promise<TcgCard[]> =>
    withRetry(`searchCards(${query},${limit})`, () => searchCards(query, limit)),
);

/** Resolve a URL slug to a canonical Lorcana card name. Dedup'd
 *  across generateMetadata + page body via React.cache keyed on the
 *  slug. Internally reuses getCardBundleByNameStrict (also cached)
 *  for the fast path, falling back to a bounded searchCards scan
 *  for slugs that do not translate cleanly to a name on the first
 *  try (apostrophes, dashes, punctuation). */
export const resolveCardNameStrict = cache(
  async (slug: string): Promise<string | null> => {
    const naive = slug.replace(/-/g, ' ');
    const bundle = await getCardBundleByNameStrict(naive);
    if (bundle) return bundle.name;
    const candidates = await searchCardsStrict(naive.slice(0, 40), 40);
    const hit = candidates.find((c) => slugifyCardName(c.name) === slug);
    return hit?.name ?? null;
  },
);

// ── Internal-link strict variants ────────────────────────────────
//
// The originals in internal-links.ts return [] when Supabase errors,
// which would silently poison the ISR cache for 24h. Strict variants
// re-check the error and throw so a transient blip surfaces as a
// 5xx instead of a cached "no related cards" sidebar.

const INTERNAL_COLUMNS =
  'id, name, rarity, collector_number, images, gamedata, set_id, tcg_sets(code)';

const INTERNAL_COLUMNS_WITH_RELEASED =
  'id, name, rarity, collector_number, images, gamedata, set_id, tcg_sets(code, released_at)';

interface InternalCardRow {
  id: string;
  name: string;
  rarity: string | null;
  collector_number: string | null;
  images: unknown;
  gamedata: unknown;
  set_id: string;
  tcg_sets?: { code: string | null; released_at?: string | null } | null;
}

function pickInternalImage(images: unknown): string | null {
  if (!images || typeof images !== 'object') return null;
  const o = images as Record<string, unknown>;
  for (const k of ['normal', 'small', 'large']) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function toInternalTile(row: InternalCardRow): InternalLinkTile {
  return {
    cardId: row.id,
    name: row.name,
    slug: slugifyCardName(row.name),
    imageUrl: pickInternalImage(row.images),
    setCode: row.tcg_sets?.code ?? null,
    rarity: row.rarity,
    collectorNumber: row.collector_number,
  };
}

export const getCardsInSameSetStrict = cache(
  async (setId: string, excludeCardId: string, limit = 8): Promise<InternalLinkTile[]> =>
    withRetry(`getCardsInSameSet(${setId})`, async () => {
      const sb = getLorcanaClient();
      const gameId = await getLorcanaGameId(sb);
      const { data, error } = await sb
        .from('tcg_cards')
        .select(INTERNAL_COLUMNS)
        .eq('game_id', gameId)
        .eq('set_id', setId)
        .neq('id', excludeCardId)
        .limit(limit);
      if (error) throw new Error(error.message);
      return ((data as unknown as InternalCardRow[]) ?? []).map(toInternalTile);
    }),
);

export const getOtherCharacterCardsStrict = cache(
  async (
    characterName: string,
    excludeCardId: string,
    limit = 8,
  ): Promise<InternalLinkTile[]> =>
    withRetry(`getOtherCharacterCards(${characterName})`, async () => {
      const sb = getLorcanaClient();
      const gameId = await getLorcanaGameId(sb);
      const base = characterKeyFromName(characterName);
      const targetSlug = slugifyCardName(base);
      if (!targetSlug) return [];
      const { data, error } = await sb
        .from('tcg_cards')
        .select(INTERNAL_COLUMNS)
        .eq('game_id', gameId)
        .ilike('name', `${base}%`)
        .limit(80);
      if (error) throw new Error(error.message);
      const rows = (data as unknown as InternalCardRow[]) ?? [];
      const out: InternalLinkTile[] = [];
      const seenSlugs = new Set<string>();
      for (const r of rows) {
        if (r.id === excludeCardId) continue;
        const gd = toLcGamedata(r.gamedata);
        if (gd.cardType !== 'character') continue;
        if (slugifyCardName(characterKeyFromName(r.name)) !== targetSlug) continue;
        const nameSlug = slugifyCardName(r.name);
        if (seenSlugs.has(nameSlug)) continue;
        seenSlugs.add(nameSlug);
        out.push(toInternalTile(r));
        if (out.length >= limit) break;
      }
      return out;
    }),
);

export const getCardsBySameRarityStrict = cache(
  async (
    rarity: string,
    excludeCardId: string,
    limit = 6,
  ): Promise<InternalLinkTile[]> =>
    withRetry(`getCardsBySameRarity(${rarity})`, async () => {
      const sb = getLorcanaClient();
      const gameId = await getLorcanaGameId(sb);
      const { data, error } = await sb
        .from('tcg_cards')
        .select(INTERNAL_COLUMNS_WITH_RELEASED)
        .eq('game_id', gameId)
        .eq('rarity', rarity)
        .neq('id', excludeCardId)
        .limit(Math.max(limit * 4, 24));
      if (error) throw new Error(error.message);
      const rows = (data as unknown as InternalCardRow[]) ?? [];
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
        out.push(toInternalTile(r));
        if (out.length >= limit) break;
      }
      return out;
    }),
);

export const getCardsBySameInkStrict = cache(
  async (
    ink: string,
    excludeCardId: string,
    limit = 6,
  ): Promise<InternalLinkTile[]> =>
    withRetry(`getCardsBySameInk(${ink})`, async () => {
      const sb = getLorcanaClient();
      const gameId = await getLorcanaGameId(sb);
      const inkLower = ink.toLowerCase();
      const { data, error } = await sb
        .from('tcg_cards')
        .select(INTERNAL_COLUMNS_WITH_RELEASED)
        .eq('game_id', gameId)
        .neq('id', excludeCardId)
        .limit(400);
      if (error) throw new Error(error.message);
      const rows = (data as unknown as InternalCardRow[]) ?? [];
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
        out.push(toInternalTile(r));
        if (out.length >= limit) break;
      }
      return out;
    }),
);

import 'server-only';
import { cache } from 'react';
import type { SupabaseClient } from '@collector-network/database';
import { getLorcanaClient } from './client';
import { getSetBundle, type LcSetBundle } from './browse';
import { getCardBundleByCardId, type LcCardBundle } from './read';
import { getPrintingHistory, type HistoryBundle } from './history';
import type { TcgGradedRow } from './graded';

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

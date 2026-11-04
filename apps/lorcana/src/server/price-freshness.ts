import 'server-only';
import { cache } from 'react';
import type {
  PrintingPricing,
  RetailQuote,
  GradedQuote,
} from '@collector-network/market-data';
import { getLorcanaClient } from './client';

// CN-06.01-P02 Lorcana freshness pilot (2026-11-04).
//
// Enriches a PrintingPricing map with `ingestStartedAt` on each quote
// by resolving `source_run_id` → `tcg_ingest_runs.started_at`.
// Operates under a server-only feature flag so the default behaviour
// is unchanged.
//
// Query shape:
//   - Collects the distinct non-null source_run_id values across all
//     quotes in all printings in the map.
//   - Single `.select('id, started_at').in('id', ids)` on tcg_ingest_runs
//     (PK indexed). Bounded by the number of distinct runs that wrote
//     to the printings on screen — typically 1 to 3 for a card page,
//     never more than low double digits.
//   - Wrapped in React.cache so repeated calls within the same request
//     reuse the lookup.
//
// Feature flag: LORCANA_FRESHNESS_PILOT (server-side env var, not
// NEXT_PUBLIC). NOT a hot-reload switch: env var changes require a
// redeploy for new ISR cache entries to pick them up. Existing
// cached pages revalidate on their natural ISR cycle (24h on
// /card/[slug]). Rollback: unset the env var and redeploy, or revert
// the PR.
//
// Null safety:
//   - If the flag is not set, enrichPricingMap returns the map
//     unchanged.
//   - If source_run_id is null on a row, ingestStartedAt stays null
//     (no fabrication).
//   - If tcg_ingest_runs lookup errors, we log and return the map
//     unchanged — never block the page.

const FLAG_ENV = 'LORCANA_FRESHNESS_PILOT';

function isPilotEnabled(): boolean {
  const v = process.env[FLAG_ENV];
  if (!v) return false;
  return v === '1' || v.toLowerCase() === 'true';
}

// React.cache memoises the fetch per server-rendering pass. Multiple
// callers that pass the same sorted-ids array within a request share
// one query.
const fetchRunStarts = cache(async (idsJoined: string): Promise<Record<string, string>> => {
  if (!idsJoined) return {};
  const ids = idsJoined.split(',');
  if (ids.length === 0) return {};
  const supabase = getLorcanaClient();
  const { data, error } = await supabase
    .from('tcg_ingest_runs')
    .select('id, started_at')
    .in('id', ids);
  if (error) {
    console.warn('[lorcana.price-freshness] ingest-runs lookup failed:', error.message);
    return {};
  }
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.id && row.started_at) out[row.id] = row.started_at;
  }
  return out;
});

async function resolveRunStarts(sourceRunIds: Set<string>): Promise<Record<string, string>> {
  if (sourceRunIds.size === 0) return {};
  // Sort for cache key stability.
  const idsJoined = Array.from(sourceRunIds).sort().join(',');
  return fetchRunStarts(idsJoined);
}

function enrichQuote<T extends RetailQuote | GradedQuote>(
  q: T,
  runStarts: Record<string, string>,
): T {
  const rid = q.sourceRunId ?? null;
  if (!rid) return { ...q, ingestStartedAt: null };
  const started = runStarts[rid] ?? null;
  return { ...q, ingestStartedAt: started };
}

/**
 * Enriches a PrintingPricing map in place-ish (returns a new map)
 * with `ingestStartedAt` on every quote. No-op when the pilot flag is
 * off.
 */
export async function enrichPricingMap(
  pricingMap: Map<string, PrintingPricing>,
): Promise<Map<string, PrintingPricing>> {
  if (!isPilotEnabled()) return pricingMap;
  if (pricingMap.size === 0) return pricingMap;

  const sourceRunIds = new Set<string>();
  for (const p of pricingMap.values()) {
    for (const q of p.market) if (q.sourceRunId) sourceRunIds.add(q.sourceRunId);
    for (const q of p.raw) if (q.sourceRunId) sourceRunIds.add(q.sourceRunId);
    for (const q of p.graded) if (q.sourceRunId) sourceRunIds.add(q.sourceRunId);
  }
  if (sourceRunIds.size === 0) return pricingMap;

  const runStarts = await resolveRunStarts(sourceRunIds);

  const out = new Map<string, PrintingPricing>();
  for (const [key, p] of pricingMap.entries()) {
    out.set(key, {
      ...p,
      market: p.market.map((q) => enrichQuote(q, runStarts)),
      raw:    p.raw.map((q) => enrichQuote(q, runStarts)),
      graded: p.graded.map((q) => enrichQuote(q, runStarts)),
    });
  }
  return out;
}

// Exported for tests + for callers that need to probe the flag at a
// decision point (e.g. to skip other pilot-only branches).
export const __internal = { isPilotEnabled, FLAG_ENV };

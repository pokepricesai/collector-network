// Pure, dependency-free price-freshness classifier.
// CN-06.01-P02 (2026-11-04) — Lorcana pilot.
//
// Separates two distinct time axes that the previous audit had
// conflated:
//
//   1. INGEST AGE — time since WE last pulled the row from the
//      provider. Resolved from `tcg_market_prices_current.source_run_id`
//      → `tcg_ingest_runs.started_at` by the caller BEFORE invoking
//      this classifier. Pass that timestamp as `ingestStartedAt`.
//
//   2. PROVIDER-REPORTED AGE — time since the provider itself last
//      reported this quote. Set on the row as `updated_at` straight
//      from the TCGGraph payload (ingest-core.mjs:335 → `pr.updatedAt`).
//      We do NOT claim this means "the price changed on that date";
//      we only know the provider reported this timestamp.
//
// Conservative treatment of nulls:
//   - A missing `ingestStartedAt` is treated as "unknown"; the
//     classifier does not assume freshness.
//   - A missing `updatedAt` is treated as "unknown"; the classifier
//     does not assume staleness either.
//   - Both null → `unknown` state. Callers show the price without
//     a timestamp label.
//
// Thresholds:
//   - RETAIL  FRESH when ingestAge ≤ 48h AND providerAge ≤ 14d.
//   - GRADED  FRESH when ingestAge ≤ 48h AND providerAge ≤ 90d.
//     (graded ingest cadence is daily; provider quote movement is
//     intrinsically slower for slabbed cards.)
//
// States:
//   fresh                 — within both thresholds; no label needed.
//   recently_confirmed    — ingest recent, provider updatedAt older.
//                           We re-pulled; provider still lists this
//                           quote at the same value.
//   not_recently_refreshed — ingest older than threshold, within the
//                           long-tail window. We have not re-pulled
//                           recently; last-known price preserved.
//   long_tail             — ingest older than the long-tail window.
//                           Still show the price value, label the
//                           observation date. Do NOT describe as
//                           "abandoned" or "discontinued" — those
//                           claims require evidence across multiple
//                           complete catalogue runs that this file
//                           cannot establish.
//   unknown               — missing or malformed timestamps. Show
//                           the price without a label (conservative).

export type FreshnessKind = 'retail' | 'graded';

export type FreshnessState =
  | 'fresh'
  | 'recently_confirmed'
  | 'not_recently_refreshed'
  | 'long_tail'
  | 'unknown';

export interface FreshnessInput {
  // Provider-reported timestamp (e.g. tcg_market_prices_current.updated_at).
  providerUpdatedAt: string | null | undefined;
  // Ingest-run start timestamp. Resolve from source_run_id →
  // tcg_ingest_runs.started_at BEFORE calling. Null when the row's
  // source_run_id was not looked up (feature flag off) or the
  // corresponding ingest_runs row was not found.
  ingestStartedAt: string | null | undefined;
  kind: FreshnessKind;
}

export interface FreshnessResult {
  state: FreshnessState;
  ingestAgeHours: number | null;
  providerAgeHours: number | null;
  // Short, neutral wording suitable for a discreet subtext line.
  // Null when no label should be shown.
  label: string | null;
}

// Thresholds (hours). Named so a future per-game tuning is explicit.
const INGEST_FRESH_HOURS = 48;
const RETAIL_PROVIDER_FRESH_HOURS = 14 * 24;   // 14 days
const GRADED_PROVIDER_FRESH_HOURS = 90 * 24;   // 90 days
const LONG_TAIL_INGEST_HOURS = 60 * 24;        // 60 days — after this,
                                                // only the provider date
                                                // is shown.

function toTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function hoursAgo(iso: string | null | undefined, now: number): number | null {
  const t = toTime(iso);
  return t === null ? null : (now - t) / 3_600_000;
}

function daysAgo(hours: number): number {
  return Math.max(0, Math.round(hours / 24));
}

function neutralLabel(providerAgeHours: number | null): string | null {
  // Always framed as an OBSERVATION, never as a claim about change.
  if (providerAgeHours === null) return 'Provider timestamp unavailable';
  const d = daysAgo(providerAgeHours);
  if (d <= 0) return 'Last observed today';
  if (d === 1) return 'Last observed 1 day ago';
  return `Last observed ${d} days ago`;
}

export function classifyFreshness(
  input: FreshnessInput,
  now: number = Date.now(),
): FreshnessResult {
  const ingestAgeHours = hoursAgo(input.ingestStartedAt, now);
  const providerAgeHours = hoursAgo(input.providerUpdatedAt, now);

  // Both timestamps missing — be conservative. Show no label.
  if (ingestAgeHours === null && providerAgeHours === null) {
    return { state: 'unknown', ingestAgeHours: null, providerAgeHours: null, label: null };
  }

  const providerFreshCap =
    input.kind === 'retail' ? RETAIL_PROVIDER_FRESH_HOURS : GRADED_PROVIDER_FRESH_HOURS;

  // When ingest timestamp is available, use both axes.
  if (ingestAgeHours !== null) {
    if (ingestAgeHours > LONG_TAIL_INGEST_HOURS) {
      return {
        state: 'long_tail',
        ingestAgeHours, providerAgeHours,
        label: neutralLabel(providerAgeHours),
      };
    }
    if (ingestAgeHours > INGEST_FRESH_HOURS) {
      return {
        state: 'not_recently_refreshed',
        ingestAgeHours, providerAgeHours,
        label: neutralLabel(providerAgeHours),
      };
    }
    // Ingest is fresh.
    if (providerAgeHours === null) {
      // Ingest fresh, provider timestamp missing — unusual but safe.
      return { state: 'unknown', ingestAgeHours, providerAgeHours: null, label: null };
    }
    if (providerAgeHours <= providerFreshCap) {
      return { state: 'fresh', ingestAgeHours, providerAgeHours, label: null };
    }
    // Ingest fresh but provider updatedAt is old. We re-pulled; the
    // provider still lists this value. Neutral subtext — we do not
    // claim the price is unchanged.
    return {
      state: 'recently_confirmed',
      ingestAgeHours, providerAgeHours,
      label: neutralLabel(providerAgeHours),
    };
  }

  // Ingest timestamp unavailable (null sourceRunId OR feature flag
  // off). Fall back to provider-updatedAt-only treatment, labelling
  // anything beyond the fresh cap. Still neutral wording.
  if (providerAgeHours !== null && providerAgeHours > providerFreshCap) {
    return {
      state: 'not_recently_refreshed',
      ingestAgeHours: null,
      providerAgeHours,
      label: neutralLabel(providerAgeHours),
    };
  }
  // Within provider fresh cap — no label needed.
  return {
    state: 'fresh',
    ingestAgeHours: null,
    providerAgeHours,
    label: null,
  };
}

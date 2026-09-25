// Slice E — shared watchlist types + validators + movement math.
//
// Pure. No DB, no server-only imports. Safe to reuse from client
// forms, server helpers and tests.

// Same currencies allowed on target prices as Slice D collection
// purchase currencies. Never FX-converted.
export const TARGET_CURRENCIES = ['USD', 'EUR'] as const;
export type TargetCurrency = (typeof TARGET_CURRENCIES)[number];

// Row shape as it comes back from Postgres. tcg_printing_id is
// NOT NULL at the DB layer — every watch pins to an exact printing.
export interface WatchlistItemRow {
  id: string;
  user_id: string;
  tcg_card_id: string;
  tcg_printing_id: string;
  target_price: number | null;
  target_currency: TargetCurrency | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// Shape used by the Add-to-Watchlist form.
export interface AddWatchInput {
  tcg_card_id: string;
  tcg_printing_id: string;
  target_price?: number | null;
  target_currency?: TargetCurrency | null;
  note?: string | null;
}

// Update-target patch. `null` explicitly clears the target.
export interface UpdateTargetInput {
  target_price: number | null;
  target_currency: TargetCurrency | null;
  note?: string | null;
}

// ── Validators ───────────────────────────────────────────────────

export function isTargetCurrency(v: unknown): v is TargetCurrency {
  return typeof v === 'string' && (TARGET_CURRENCIES as readonly string[]).includes(v);
}

export interface ValidationResult<T> { ok: true; value: T; }
export interface ValidationErrors { ok: false; errors: string[]; }

export function validateAddWatchInput(
  raw: Partial<AddWatchInput>,
): ValidationResult<AddWatchInput> | ValidationErrors {
  const errors: string[] = [];
  const tcg_card_id = typeof raw.tcg_card_id === 'string' ? raw.tcg_card_id.trim() : '';
  const tcg_printing_id =
    typeof raw.tcg_printing_id === 'string' ? raw.tcg_printing_id.trim() : '';
  if (!tcg_card_id) errors.push('Missing card');
  if (!tcg_printing_id) errors.push('Choose a printing');
  const targetValidation = validateTargetShape(raw.target_price, raw.target_currency);
  if (!targetValidation.ok) errors.push(...targetValidation.errors);
  const note = normaliseNote(raw.note);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      tcg_card_id,
      tcg_printing_id,
      target_price: targetValidation.ok ? targetValidation.price : null,
      target_currency: targetValidation.ok ? targetValidation.currency : null,
      note,
    },
  };
}

export function validateUpdateTargetInput(
  raw: Partial<UpdateTargetInput>,
): ValidationResult<UpdateTargetInput> | ValidationErrors {
  const targetValidation = validateTargetShape(raw.target_price, raw.target_currency);
  if (!targetValidation.ok) return { ok: false, errors: targetValidation.errors };
  return {
    ok: true,
    value: {
      target_price: targetValidation.price,
      target_currency: targetValidation.currency,
      note: normaliseNote(raw.note),
    },
  };
}

interface TargetShapeOk {
  ok: true;
  price: number | null;
  currency: TargetCurrency | null;
}
interface TargetShapeFail { ok: false; errors: string[]; }
function validateTargetShape(
  rawPrice: unknown,
  rawCurrency: unknown,
): TargetShapeOk | TargetShapeFail {
  const errors: string[] = [];
  const priceProvided =
    rawPrice != null && !(typeof rawPrice === 'string' && rawPrice === '');
  const price = priceProvided ? Number(rawPrice) : null;
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    errors.push('Target price must be a positive number');
  }
  const currency = isTargetCurrency(rawCurrency) ? rawCurrency : null;
  // DB shape rule mirrored: a numeric target requires a currency.
  if (price != null && currency == null) {
    errors.push('Choose a target currency');
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, price, currency };
}

function normaliseNote(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim().slice(0, 500)
    : null;
}

// ── Price-movement math (pure) ──────────────────────────────────
//
// A "watchable series" is per printing × currency × source. When we
// compute a 7D / 30D / 90D delta we NEVER mix currencies, we NEVER
// mix retail sources within a comparison, and we NEVER treat a
// missing observation as zero. If either endpoint is absent the
// movement is `null` and the UI shows "Not enough history".

export interface PriceObservation {
  observedOn: string; // YYYY-MM-DD
  price: number;
  currency: string;
  source: string; // e.g. 'tcggraph.tcgplayer'
}

export type MovementWindow = 7 | 30 | 90;

export interface MovementResult {
  window: MovementWindow;
  currency: string;
  latestOn: string;
  latestPrice: number;
  baselineOn: string | null;
  baselinePrice: number | null;
  absolute: number | null;
  percent: number | null;
}

// Pick the movement for one (printing, currency, source) series.
// Baseline is the observation closest to (latest − window days) but
// still on-or-before that boundary; we do not "look forward" for a
// baseline (that would smuggle news into the historical price).
export function computeMovement(
  observations: readonly PriceObservation[],
  window: MovementWindow,
  today: Date = new Date(),
): MovementResult | null {
  if (observations.length === 0) return null;
  const sorted = [...observations].sort((a, b) =>
    a.observedOn.localeCompare(b.observedOn),
  );
  // Enforce single-currency and single-source series — the caller
  // must have split by (currency × source). If mixed, refuse.
  const currency = sorted[0]!.currency;
  const source = sorted[0]!.source;
  for (const o of sorted) {
    if (o.currency !== currency || o.source !== source) return null;
  }
  const latest = sorted.at(-1)!;
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - window);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  // Baseline = latest observation at-or-before cutoffStr. If none
  // exists (data doesn't reach back that far), return null so the UI
  // shows "not enough history" — never fabricate.
  let baseline: PriceObservation | null = null;
  for (const o of sorted) {
    if (o.observedOn <= cutoffStr) baseline = o;
    else break;
  }
  if (!baseline) {
    return {
      window,
      currency,
      latestOn: latest.observedOn,
      latestPrice: latest.price,
      baselineOn: null,
      baselinePrice: null,
      absolute: null,
      percent: null,
    };
  }
  const absolute = latest.price - baseline.price;
  const percent =
    baseline.price === 0 ? null : (absolute / baseline.price) * 100;
  return {
    window,
    currency,
    latestOn: latest.observedOn,
    latestPrice: latest.price,
    baselineOn: baseline.observedOn,
    baselinePrice: baseline.price,
    absolute,
    percent,
  };
}

// Slice the current price + all three windows for a single series.
export interface MovementBundle {
  currency: string;
  source: string;
  currentPrice: number | null;
  windows: {
    d7: MovementResult | null;
    d30: MovementResult | null;
    d90: MovementResult | null;
  };
}

export function buildMovementBundle(
  observations: readonly PriceObservation[],
  today: Date = new Date(),
): MovementBundle | null {
  if (observations.length === 0) return null;
  const currency = observations[0]!.currency;
  const source = observations[0]!.source;
  const latest = [...observations]
    .sort((a, b) => a.observedOn.localeCompare(b.observedOn))
    .at(-1)!;
  return {
    currency,
    source,
    currentPrice: latest.price,
    windows: {
      d7: computeMovement(observations, 7, today),
      d30: computeMovement(observations, 30, today),
      d90: computeMovement(observations, 90, today),
    },
  };
}

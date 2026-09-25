// Slice D — shared collection types + validators.
//
// Pure. No DB, no server-only imports. Safe to reuse from client
// forms, server helpers and tests.

// Structured condition values. Deliberately short — collectors
// disagree on the finer distinctions and the graded market covers
// the top end anyway.
export const CONDITION_VALUES = [
  'mint',
  'near-mint',
  'lightly-played',
  'moderately-played',
  'heavily-played',
  'damaged',
] as const;
export type Condition = (typeof CONDITION_VALUES)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  'mint': 'Mint',
  'near-mint': 'Near Mint',
  'lightly-played': 'Lightly Played',
  'moderately-played': 'Moderately Played',
  'heavily-played': 'Heavily Played',
  'damaged': 'Damaged',
};

// Graders that a real slab can carry. `any` exists in the market-
// price data (as a filter / rollup value) but is NOT a real grader
// for an owned card — never allow it on a stored holding.
export const GRADER_VALUES = ['psa', 'bgs', 'cgc', 'sgc'] as const;
export type Grader = (typeof GRADER_VALUES)[number];

// Currencies allowed on purchase records. Never converted — display
// in the recorded currency + label the current-market price in its
// own currency. Matches settings.preferred_currency options.
export const PURCHASE_CURRENCIES = ['USD', 'EUR'] as const;
export type PurchaseCurrency = (typeof PURCHASE_CURRENCIES)[number];

// Row shape as it comes back from Postgres (snake_case).
// `tcg_printing_id` is NOT NULL at the DB layer — every holding is
// pinned to an exact printing. The DB blocks deletion of a printing
// referenced by any collection row (`on delete restrict`).
export interface CollectionItemRow {
  id: string;
  user_id: string;
  tcg_card_id: string;
  tcg_printing_id: string;
  quantity: number;
  is_graded: boolean;
  grader: Grader | null;
  grade: string | null;
  condition: Condition | null;
  purchase_price: number | null;
  purchase_currency: PurchaseCurrency | null;
  purchase_date: string | null; // YYYY-MM-DD
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Shape used by the Add-to-Collection form. `printingId` is required
// at write time — the client picker on family (/card/[slug]) pages
// forces the user to choose before enabling the button.
export interface AddCollectionInput {
  tcg_card_id: string;
  tcg_printing_id: string;
  quantity: number;
  is_graded: boolean;
  grader?: Grader | null;
  grade?: string | null;
  condition?: Condition | null;
  purchase_price?: number | null;
  purchase_currency?: PurchaseCurrency | null;
  purchase_date?: string | null;
  notes?: string | null;
}

// ── Validators ───────────────────────────────────────────────────

export function isCondition(v: unknown): v is Condition {
  return typeof v === 'string' && (CONDITION_VALUES as readonly string[]).includes(v);
}
export function isGrader(v: unknown): v is Grader {
  return typeof v === 'string' && (GRADER_VALUES as readonly string[]).includes(v);
}
export function isPurchaseCurrency(v: unknown): v is PurchaseCurrency {
  return typeof v === 'string' && (PURCHASE_CURRENCIES as readonly string[]).includes(v);
}

// Full validator run on any incoming write. Never trusts the client.
// Returns either the coerced/normalised input or a list of field
// errors — the caller renders them inline.
export interface ValidationResult<T> {
  ok: true;
  value: T;
}
export interface ValidationErrors {
  ok: false;
  errors: string[];
}

export function validateAddCollectionInput(
  raw: Partial<AddCollectionInput>,
): ValidationResult<AddCollectionInput> | ValidationErrors {
  const errors: string[] = [];
  const tcg_card_id = typeof raw.tcg_card_id === 'string' ? raw.tcg_card_id.trim() : '';
  const tcg_printing_id =
    typeof raw.tcg_printing_id === 'string' ? raw.tcg_printing_id.trim() : '';
  if (!tcg_card_id) errors.push('Missing card');
  if (!tcg_printing_id) errors.push('Choose a printing');
  const quantity = Number.isInteger(raw.quantity) ? (raw.quantity as number) : 1;
  if (quantity < 1 || quantity > 999)
    errors.push('Quantity must be between 1 and 999');
  const is_graded = !!raw.is_graded;
  let grader: Grader | null = null;
  let grade: string | null = null;
  if (is_graded) {
    if (!isGrader(raw.grader)) errors.push('Choose a grader');
    else grader = raw.grader;
    if (typeof raw.grade === 'string' && raw.grade.trim().length > 0) {
      grade = raw.grade.trim().slice(0, 8);
    } else {
      errors.push('Choose a grade');
    }
  }
  const condition = is_graded
    ? null
    : isCondition(raw.condition)
    ? raw.condition
    : 'near-mint';
  const purchase_price =
    raw.purchase_price == null ||
    (typeof raw.purchase_price === 'string' && raw.purchase_price === '')
      ? null
      : Number(raw.purchase_price);
  if (
    purchase_price != null &&
    (!Number.isFinite(purchase_price) || purchase_price < 0)
  ) {
    errors.push('Purchase price must be a positive number');
  }
  const purchase_currency = isPurchaseCurrency(raw.purchase_currency)
    ? raw.purchase_currency
    : null;
  // Shape rule mirrored in the DB: a recorded purchase price must
  // always name its currency (we never FX-convert, so a numeric
  // value alone is meaningless).
  if (purchase_price != null && purchase_currency == null) {
    errors.push('Choose a purchase currency');
  }
  const purchase_date = validateDate(raw.purchase_date ?? null);
  if (raw.purchase_date && !purchase_date)
    errors.push('Purchase date must be YYYY-MM-DD');
  const notes =
    typeof raw.notes === 'string' && raw.notes.trim().length > 0
      ? raw.notes.trim().slice(0, 500)
      : null;
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      tcg_card_id,
      tcg_printing_id,
      quantity,
      is_graded,
      grader,
      grade,
      condition,
      purchase_price,
      purchase_currency,
      purchase_date,
      notes,
    },
  };
}

function validateDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

// ── Analytics helpers (pure) ────────────────────────────────────

export interface PricedItem {
  row: CollectionItemRow;
  unitValueUsd: number | null;
  valueUsdSource: 'printing-graded' | 'card-graded-family' | 'printing-retail' | 'none';
  currency: 'USD';
}

export interface CollectionSummary {
  totalCurrentUsd: number;
  totalAcquisitionUsd: number | null; // null unless every priced row has USD acquisition
  unrealisedUsd: number | null;
  totalCopies: number;
  uniqueHoldings: number;
  uniqueCards: number;
  rawCount: number;
  gradedCount: number;
  rawValueUsd: number;
  gradedValueUsd: number;
  missingPriceCount: number;
}

export function summarise(items: readonly PricedItem[]): CollectionSummary {
  let totalCurrentUsd = 0;
  let totalAcquisitionUsd = 0;
  let acquisitionCovered = true;
  let unrealisedCovered = true;
  let totalCopies = 0;
  const cardIds = new Set<string>();
  let rawCount = 0;
  let gradedCount = 0;
  let rawValueUsd = 0;
  let gradedValueUsd = 0;
  let missingPriceCount = 0;

  for (const p of items) {
    const q = p.row.quantity;
    totalCopies += q;
    cardIds.add(p.row.tcg_card_id);
    if (p.row.is_graded) gradedCount += q;
    else rawCount += q;

    if (p.unitValueUsd == null) {
      missingPriceCount += 1;
      unrealisedCovered = false;
      // A missing price is NOT counted as zero — stays out of totals.
      // acquisition still contributes when the user recorded USD.
    } else {
      const holdingValue = p.unitValueUsd * q;
      totalCurrentUsd += holdingValue;
      if (p.row.is_graded) gradedValueUsd += holdingValue;
      else rawValueUsd += holdingValue;
    }

    if (
      p.row.purchase_price != null &&
      p.row.purchase_currency === 'USD'
    ) {
      totalAcquisitionUsd += p.row.purchase_price * q;
    } else if (p.row.purchase_price != null) {
      // Non-USD acquisition (EUR) exists — since we never FX-convert,
      // acquisition cost cannot be reduced to a single scalar. The
      // total stays null for the whole collection.
      acquisitionCovered = false;
      unrealisedCovered = false;
    }
  }

  const acquisition = acquisitionCovered ? totalAcquisitionUsd : null;
  const unrealised =
    acquisitionCovered && unrealisedCovered
      ? totalCurrentUsd - totalAcquisitionUsd
      : null;

  return {
    totalCurrentUsd,
    totalAcquisitionUsd: acquisition,
    unrealisedUsd: unrealised,
    totalCopies,
    uniqueHoldings: items.length,
    uniqueCards: cardIds.size,
    rawCount,
    gradedCount,
    rawValueUsd,
    gradedValueUsd,
    missingPriceCount,
  };
}

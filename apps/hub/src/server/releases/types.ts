import 'server-only';

// CN-05 Growth Intelligence · TCG Release Tracker types.
//
// Shared between the admin curation UI, the Intelligence inbox
// compact view, and the readiness detector. v1 is manual-curation
// first; see migrations/20261029000000_tcg_releases.sql for the
// authoritative schema.

export type Tcg = 'pokemon' | 'mtg' | 'ygo' | 'onepiece' | 'lorcana';
export type ProductType =
  | 'expansion' | 'booster' | 'starter_deck' | 'structure_deck'
  | 'special_collection' | 'premium' | 'promo' | 'other';
export type Language = 'en' | 'ja' | 'other';
export type ReleaseDatePrecision = 'day' | 'month' | 'quarter' | 'tbc';
export type ConfirmationStatus =
  | 'confirmed' | 'announced_tbc' | 'rumoured'
  | 'postponed' | 'released' | 'cancelled';
export type VerificationMode = 'manual' | 'automated';
export type ReviewStatus = 'pending_review' | 'approved' | 'rejected';

export interface TcgReleaseRow {
  id: string;
  tcg: Tcg;
  site_slug: Tcg;
  set_name: string;
  set_name_original: string | null;
  set_name_translated: string | null;
  translation_official: boolean;
  set_code: string | null;
  product_type: ProductType;
  language: Language;
  region: string | null;
  release_date: string | null;              // date-only ISO (YYYY-MM-DD)
  release_date_precision: ReleaseDatePrecision;
  prerelease_date: string | null;
  confirmation_status: ConfirmationStatus;
  source_url: string | null;
  source_notes: string | null;
  source_verified_at: string | null;        // full ISO
  verification_mode: VerificationMode;
  // CN-06.06 corrections: separates automated discovery from
  // operator approval. Rows are invisible on the public feed
  // until review_status='approved'.
  review_status: ReviewStatus;
  site_set_url: string | null;
  previous_release_date: string | null;
  date_changed_at: string | null;
  // Reviewable date-change proposal. When the ingester detects a
  // shift on an already-approved row it writes here, not to
  // release_date. The operator explicitly accepts or rejects.
  proposed_release_date: string | null;
  proposed_release_date_precision: ReleaseDatePrecision | null;
  proposed_change_at: string | null;
  proposed_change_source: string | null;
  // Sub-products (Scryfall Star Trek Commander/Stardates under
  // the Star Trek expansion) point at a parent primary release
  // event. The public feed returns parent rows only.
  parent_release_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const REVIEW_STATUS_TONE: Record<ReviewStatus, 'success' | 'info' | 'warning' | 'failed' | 'disabled'> = {
  pending_review: 'warning',
  approved: 'success',
  rejected: 'failed',
};

export const TCG_LABEL: Record<Tcg, string> = {
  pokemon: 'Pokémon',
  mtg: 'Magic: The Gathering',
  ygo: 'Yu-Gi-Oh!',
  onepiece: 'One Piece',
  lorcana: 'Disney Lorcana',
};

export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  expansion: 'Expansion',
  booster: 'Booster',
  starter_deck: 'Starter deck',
  structure_deck: 'Structure deck',
  special_collection: 'Special collection',
  premium: 'Premium set',
  promo: 'Promo',
  other: 'Other',
};

export const CONFIRMATION_LABEL: Record<ConfirmationStatus, string> = {
  confirmed: 'Confirmed',
  announced_tbc: 'Announced · TBC',
  rumoured: 'Rumoured',
  postponed: 'Postponed',
  released: 'Released',
  cancelled: 'Cancelled',
};

export const CONFIRMATION_TONE: Record<ConfirmationStatus, 'success' | 'info' | 'warning' | 'failed' | 'disabled'> = {
  confirmed: 'success',
  announced_tbc: 'info',
  rumoured: 'warning',
  postponed: 'warning',
  released: 'disabled',
  cancelled: 'failed',
};

/** How many days from today until the release. Negative = past.
 *  Null when the date is TBC *or* when precision is coarser than a
 *  day (month / quarter) — a day-precision countdown on a
 *  quarter-precision entry would fabricate specificity the
 *  publisher never advertised. Uses date-only math (no timezone
 *  drift). */
export function daysUntilRelease(row: Pick<TcgReleaseRow, 'release_date' | 'release_date_precision'>, today: Date = new Date()): number | null {
  if (!row.release_date) return null;
  if (row.release_date_precision === 'tbc') return null;
  if (row.release_date_precision === 'month') return null;
  if (row.release_date_precision === 'quarter') return null;
  const todayIso = today.toISOString().slice(0, 10);
  const t = Date.parse(todayIso + 'T00:00:00Z');
  const r = Date.parse(row.release_date + 'T00:00:00Z');
  if (!Number.isFinite(r) || !Number.isFinite(t)) return null;
  return Math.round((r - t) / 86400000);
}

/** Which quarter a YYYY-MM-DD string falls into. Q1 = Jan–Mar,
 *  Q2 = Apr–Jun, Q3 = Jul–Sep, Q4 = Oct–Dec. */
function quarterOf(isoDate: string): { quarter: 1 | 2 | 3 | 4; year: number } | null {
  const m = isoDate.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const quarter = (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  return { quarter, year };
}

/** Human-readable release label honouring the precision field. */
export function formatReleaseDate(row: Pick<TcgReleaseRow, 'release_date' | 'release_date_precision'>): string {
  if (!row.release_date || row.release_date_precision === 'tbc') return 'TBC';
  if (row.release_date_precision === 'quarter') {
    // Render "Q2 2027" without implying a month or day. The stored
    // release_date is the quarter anchor (Q1→Jan 1, Q2→Apr 1,
    // Q3→Jul 1, Q4→Oct 1) used for chronological sort.
    const q = quarterOf(row.release_date);
    return q ? `Q${q.quarter} ${q.year}` : 'TBC';
  }
  if (row.release_date_precision === 'month') {
    // Render month-only ("Oct 2026") without implying a day.
    const d = new Date(row.release_date + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const d = new Date(row.release_date + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

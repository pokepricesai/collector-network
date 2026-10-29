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
export type ReleaseDatePrecision = 'day' | 'month' | 'tbc';
export type ConfirmationStatus =
  | 'confirmed' | 'announced_tbc' | 'rumoured'
  | 'postponed' | 'released' | 'cancelled';
export type VerificationMode = 'manual' | 'automated';

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
  site_set_url: string | null;
  previous_release_date: string | null;
  date_changed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

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
 *  Null when the date is TBC. Uses date-only math (no timezone drift). */
export function daysUntilRelease(row: Pick<TcgReleaseRow, 'release_date' | 'release_date_precision'>, today: Date = new Date()): number | null {
  if (!row.release_date) return null;
  if (row.release_date_precision === 'tbc') return null;
  const todayIso = today.toISOString().slice(0, 10);
  const t = Date.parse(todayIso + 'T00:00:00Z');
  const r = Date.parse(row.release_date + 'T00:00:00Z');
  if (!Number.isFinite(r) || !Number.isFinite(t)) return null;
  return Math.round((r - t) / 86400000);
}

/** Human-readable release label honouring the precision field. */
export function formatReleaseDate(row: Pick<TcgReleaseRow, 'release_date' | 'release_date_precision'>): string {
  if (!row.release_date || row.release_date_precision === 'tbc') return 'TBC';
  if (row.release_date_precision === 'month') {
    // Render month-only ("Oct 2026") without implying a day.
    const d = new Date(row.release_date + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const d = new Date(row.release_date + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

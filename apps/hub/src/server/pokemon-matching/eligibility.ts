// Pure classification logic for the Pokémon → TCGGraph matching
// workbench. These functions are the single source of truth for
// deciding:
//
//   • What TCGGraph printing-key a PokePrices `[Variant]` tag maps to.
//   • What pricing-eligibility class a mapping belongs to
//     (bulk_safe vs market_only vs identity_only vs not_eligible).
//
// No I/O. No side effects. The admin page, the seed script and the
// Vitest suite all import from here, so there is one canonical table
// of what's safe to activate for pricing and what isn't.

/** PokePrices `[Variant]` tag strings that have a direct TCGGraph
 *  printing-key equivalent. Keep this list conservative — unknown
 *  variants fall through to NO_TCG_PRINTING_KEY. */
export const PP_TAG_TO_PRINTING_KEY: Readonly<Record<string, string>> = Object.freeze({
  '1st Edition':      '1st-edition',
  '1st Edition Foil': '1st-edition-foil',
  'Shadowless':       'shadowless',
  'Reverse Holo':     'reverse-holo',
  'Reverse':          'reverse-holo',
  'Holo':             'foil',
  'Foil':             'foil',
  'Cosmos Holo':      'cosmos-holo',
  'Master Ball':      'masterball',
  'Poke Ball':        'pokeball',
  'Pokeball':         'pokeball',
  'Dusk Ball':        'duskball',
  'Love Ball':        'loveball',
  'Friend Ball':      'friendball',
  'Quick Ball':       'quickball',
  'Team Rocket':      'team-rocket',
  'Staff':            'staff',
  'Prerelease':       'prerelease',
  'League':           'league',
  'Pokemon Center':   'pokemon-center',
  'Energy Symbol':    'energy-symbol',
  'Cracked Ice':      'cracked-ice',
});

/** PokePrices variant tags that have no TCGGraph printing-key
 *  equivalent and therefore can never be price-safe from aggregate
 *  graded quotes. These rows get `identity_only`. */
export const KNOWN_UNSUPPORTED_VARIANT_TAGS: ReadonlySet<string> = new Set([
  'Mirror Holo',
  'Jumbo',
  'Prize Pack',
  'Rainbow Foil',
  'Stamped',
  'Prism',
  'Gold Star',
  'Sparkle',
  'Tekno',
  'Prize Pack Cosmos Holo',
  'Glossy Prism',
  'Holo Prism',
  'Silver Foil',
]);

/** Regex that flags TCGGraph card ids whose set membership strongly
 *  suggests a promo/reprint. Approving these rows is fine; applying
 *  their aggregate graded prices is NOT, because the graded aggregate
 *  may be contaminated by sales of the base card. */
export const PROMO_REPRINT_CARD_ID = /_promo|wcd\d|_jumbo|_prize|_sparkle|_tekno/i;

/** Extract the first `[Variant]` tag from a PokePrices card_name. */
export function extractVariantTag(ppCardName: string | null | undefined): string | null {
  if (!ppCardName) return null;
  const m = ppCardName.match(/\[([^\]]+)\]/);
  return m && m[1] ? m[1].trim() : null;
}

/** Normalise a PP language code to the TCGGraph side. */
export function ppLangToTcgLang(ppLang: string | null | undefined): string {
  if (ppLang === 'jp' || ppLang === 'ja') return 'ja';
  return 'en';
}

export type PricingEligibility =
  | 'bulk_safe'
  | 'market_only'
  | 'identity_only'
  | 'not_eligible'
  | 'uncertain';

export interface EligibilityInput {
  review_status: string;
  confidence: string | null;
  tcg_card_id: string | null;
  tcg_printing_key: string | null;
  tcg_language: string | null;
  pp_language: string | null;
  pp_card_name: string | null;
  /** Whether another PP mapping already points to the same
   *  (tcg_card_id, tcg_printing_key). Caller supplies after a
   *  group-by pass. */
  shares_tcg_target_with_other_pp_slug?: boolean;
}

export interface EligibilityVerdict {
  eligibility: PricingEligibility;
  reasons: string[];                 // operator-readable
  expected_printing_key: string | null;
}

/** Decide the pricing_eligibility class for a mapping row.
 *
 *  Rules:
 *  1. If the mapping is unmatched / rejected / no_tcg_equivalent →
 *     `not_eligible`.
 *  2. If confidence is below `verified` → `uncertain`.
 *  3. If PP has a `[Variant]` tag that TCGGraph does not expose as a
 *     printing-key → `identity_only` (can approve mapping, cannot
 *     use any TCG price).
 *  4. If PP has a `[Variant]` tag with a known printing-key AND the
 *     matcher assigned the matching printing-key → `market_only`
 *     (per-finish TCGplayer / Cardmarket only; graded is aggregate).
 *  5. If PP has a `[Variant]` tag but the matcher assigned a
 *     non-matching printing-key → `identity_only`.
 *  6. If the languages don't match → `identity_only`.
 *  7. If the TCG card id has a promo/reprint marker → `identity_only`.
 *  8. If another PP mapping shares the same TCG target → `identity_only`.
 *  9. Otherwise (no variant, normal printing, languages match, no
 *     clashes, no promo markers) → `bulk_safe`.
 */
export function classifyEligibility(input: EligibilityInput): EligibilityVerdict {
  const reasons: string[] = [];

  if (
    input.review_status === 'rejected' ||
    input.review_status === 'no_tcg_equivalent' ||
    input.review_status === 'unmatched' ||
    !input.tcg_card_id
  ) {
    return { eligibility: 'not_eligible', reasons: ['no_identity_mapping'], expected_printing_key: null };
  }

  const tag = extractVariantTag(input.pp_card_name);
  const expectedKey =
    tag
      ? (KNOWN_UNSUPPORTED_VARIANT_TAGS.has(tag) ? null : (PP_TAG_TO_PRINTING_KEY[tag] ?? null))
      : 'normal';

  if (input.confidence !== 'verified') {
    reasons.push(`confidence_${input.confidence ?? 'null'}`);
    return { eligibility: 'uncertain', reasons, expected_printing_key: expectedKey };
  }

  // Variant tag + no TCG printing-key equivalent
  if (tag && KNOWN_UNSUPPORTED_VARIANT_TAGS.has(tag)) {
    reasons.push(`tcg_has_no_printing_key_for:${tag}`);
    return { eligibility: 'identity_only', reasons, expected_printing_key: null };
  }
  if (tag && !PP_TAG_TO_PRINTING_KEY[tag]) {
    reasons.push(`unmapped_pp_variant_tag:${tag}`);
    return { eligibility: 'identity_only', reasons, expected_printing_key: null };
  }

  // Variant tag + matcher chose a different printing-key than expected
  if (tag && expectedKey && input.tcg_printing_key && input.tcg_printing_key !== expectedKey) {
    reasons.push(`variant_tag_but_printing_mismatch:pp_tag=${tag} expected=${expectedKey} got=${input.tcg_printing_key}`);
    return { eligibility: 'identity_only', reasons, expected_printing_key: expectedKey };
  }

  const expectedTcgLang = ppLangToTcgLang(input.pp_language);
  if (input.tcg_language && input.tcg_language !== expectedTcgLang) {
    reasons.push(`language_mismatch:pp=${input.pp_language} tcg=${input.tcg_language}`);
    return { eligibility: 'identity_only', reasons, expected_printing_key: expectedKey };
  }

  if (PROMO_REPRINT_CARD_ID.test(input.tcg_card_id)) {
    reasons.push('tcg_card_is_promo_reprint');
    return { eligibility: 'identity_only', reasons, expected_printing_key: expectedKey };
  }

  if (input.shares_tcg_target_with_other_pp_slug) {
    reasons.push('shares_tcg_target_with_other_pp_slug');
    return { eligibility: 'identity_only', reasons, expected_printing_key: expectedKey };
  }

  // Variant with a legitimate TCG printing-key — market quotes only
  if (tag && expectedKey && expectedKey !== 'normal') {
    reasons.push(`variant_market_only:${tag}→${expectedKey}`);
    return { eligibility: 'market_only', reasons, expected_printing_key: expectedKey };
  }

  // Clean normal printing — fully bulk-safe
  return { eligibility: 'bulk_safe', reasons: [], expected_printing_key: 'normal' };
}

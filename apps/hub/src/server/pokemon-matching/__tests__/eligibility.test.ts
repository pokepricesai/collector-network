import { describe, it, expect } from 'vitest';
import {
  classifyEligibility,
  extractVariantTag,
  ppLangToTcgLang,
  PP_TAG_TO_PRINTING_KEY,
  KNOWN_UNSUPPORTED_VARIANT_TAGS,
  PROMO_REPRINT_CARD_ID,
} from '../eligibility';

// Regression tests for the single source of truth that decides which
// PokePrices → TCGGraph mappings are safe to bulk-approve for pricing.
// The matcher accepts a card-identity match quickly; this layer stops
// us treating that as a free pass on price applicability.

describe('extractVariantTag', () => {
  it('returns null for names without a bracketed tag', () => {
    expect(extractVariantTag('Charizard')).toBeNull();
    expect(extractVariantTag('Charizard #4')).toBeNull();
    expect(extractVariantTag('')).toBeNull();
    expect(extractVariantTag(null)).toBeNull();
  });

  it('extracts the first bracketed tag, stripping whitespace', () => {
    expect(extractVariantTag('Charizard [1st Edition] #4')).toBe('1st Edition');
    expect(extractVariantTag('Seel [ Shadowless ] #41')).toBe('Shadowless');
    expect(extractVariantTag('Pikachu [Sparkle] #150')).toBe('Sparkle');
  });

  it('ignores later brackets when there are multiple', () => {
    expect(extractVariantTag('Mewtwo [Jumbo] [Promo]')).toBe('Jumbo');
  });
});

describe('ppLangToTcgLang', () => {
  it('maps PP jp/ja to TCG ja', () => {
    expect(ppLangToTcgLang('jp')).toBe('ja');
    expect(ppLangToTcgLang('ja')).toBe('ja');
  });

  it('defaults everything else to en', () => {
    expect(ppLangToTcgLang('en')).toBe('en');
    expect(ppLangToTcgLang(null)).toBe('en');
    expect(ppLangToTcgLang(undefined)).toBe('en');
    expect(ppLangToTcgLang('fr')).toBe('en');
  });
});

describe('variant tag → printing key tables', () => {
  it('known supported variants map to a stable TCGGraph printing key', () => {
    expect(PP_TAG_TO_PRINTING_KEY['1st Edition']).toBe('1st-edition');
    expect(PP_TAG_TO_PRINTING_KEY['Shadowless']).toBe('shadowless');
    expect(PP_TAG_TO_PRINTING_KEY['Reverse Holo']).toBe('reverse-holo');
    expect(PP_TAG_TO_PRINTING_KEY['Cosmos Holo']).toBe('cosmos-holo');
    expect(PP_TAG_TO_PRINTING_KEY['Master Ball']).toBe('masterball');
  });

  it('known unsupported variants are flagged', () => {
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('Mirror Holo')).toBe(true);
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('Jumbo')).toBe(true);
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('Prize Pack')).toBe(true);
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('Rainbow Foil')).toBe(true);
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('Stamped')).toBe(true);
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('Prism')).toBe(true);
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('Gold Star')).toBe(true);
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('Sparkle')).toBe(true);
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('Tekno')).toBe(true);
  });

  it('normal / unknown tag is not in either map', () => {
    expect(PP_TAG_TO_PRINTING_KEY['Sparkle']).toBeUndefined();
    expect(KNOWN_UNSUPPORTED_VARIANT_TAGS.has('1st Edition')).toBe(false);
  });
});

describe('PROMO_REPRINT_CARD_ID', () => {
  it('flags championship, promo, jumbo, prize, sparkle, tekno ids', () => {
    expect(PROMO_REPRINT_CARD_ID.test('pkm_wcd2015_patrick_martinez_91_119')).toBe(true);
    expect(PROMO_REPRINT_CARD_ID.test('pkm_wcd2024_charizard')).toBe(true);
    expect(PROMO_REPRINT_CARD_ID.test('pkm_sv1_promo_42')).toBe(true);
    expect(PROMO_REPRINT_CARD_ID.test('pkm_svb1_jumbo')).toBe(true);
    expect(PROMO_REPRINT_CARD_ID.test('pkm_svb1_prize')).toBe(true);
    expect(PROMO_REPRINT_CARD_ID.test('pkm_sv_sparkle_pikachu')).toBe(true);
    expect(PROMO_REPRINT_CARD_ID.test('pkm_sv_tekno_charizard')).toBe(true);
  });

  it('does not flag normal set ids', () => {
    expect(PROMO_REPRINT_CARD_ID.test('pkm_base1_41')).toBe(false);
    expect(PROMO_REPRINT_CARD_ID.test('pkm_sv2_125')).toBe(false);
    expect(PROMO_REPRINT_CARD_ID.test('pkm_jungle_17')).toBe(false);
  });
});

// -------- classifyEligibility: the business logic --------

const baseVerifiedInput = {
  review_status: 'pending_review',
  confidence: 'verified',
  tcg_card_id: 'pkm_sv2_125',
  tcg_printing_key: 'normal',
  tcg_language: 'en',
  pp_language: 'en',
  pp_card_name: 'Mimikyu #125',
  shares_tcg_target_with_other_pp_slug: false,
};

describe('classifyEligibility — bulk_safe path', () => {
  it('clean English normal printing with verified match → bulk_safe', () => {
    const v = classifyEligibility(baseVerifiedInput);
    expect(v.eligibility).toBe('bulk_safe');
    expect(v.expected_printing_key).toBe('normal');
    expect(v.reasons).toHaveLength(0);
  });

  it('clean Japanese normal printing with verified match → bulk_safe', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_language: 'jp',
      tcg_language: 'ja',
      pp_card_name: 'ミミッキュ',
    });
    expect(v.eligibility).toBe('bulk_safe');
  });
});

describe('classifyEligibility — market_only variants', () => {
  it('[1st Edition] card with matching 1st-edition printing → market_only', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Seaking [1st Edition] #46',
      tcg_printing_key: '1st-edition',
      tcg_card_id: 'pkm_base2_46',
    });
    expect(v.eligibility).toBe('market_only');
    expect(v.expected_printing_key).toBe('1st-edition');
    expect(v.reasons.some(r => r.includes('variant_market_only'))).toBe(true);
  });

  it('[Shadowless] card with matching shadowless printing → market_only', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Seel [Shadowless] #41',
      tcg_printing_key: 'shadowless',
      tcg_card_id: 'pkm_base1_41',
    });
    expect(v.eligibility).toBe('market_only');
    expect(v.expected_printing_key).toBe('shadowless');
  });

  it('[Reverse Holo] card with matching reverse-holo printing → market_only', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Charizard [Reverse Holo] #15',
      tcg_printing_key: 'reverse-holo',
      tcg_card_id: 'pkm_sv2_15',
    });
    expect(v.eligibility).toBe('market_only');
  });
});

describe('classifyEligibility — identity_only cases', () => {
  it('[Mirror Holo] (no TCG printing key) → identity_only', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Pikachu [Mirror Holo] #58',
      tcg_printing_key: 'normal',
    });
    expect(v.eligibility).toBe('identity_only');
    expect(v.expected_printing_key).toBeNull();
    expect(v.reasons.some(r => r.includes('tcg_has_no_printing_key_for:Mirror Holo'))).toBe(true);
  });

  it('[Jumbo] (no TCG printing key) → identity_only', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: "Rocket's Mewtwo [Jumbo] #8",
    });
    expect(v.eligibility).toBe('identity_only');
  });

  it('[Sparkle] (no TCG printing key) → identity_only', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Aerodactyl [Sparkle] #142',
    });
    expect(v.eligibility).toBe('identity_only');
  });

  it('[1st Edition] + matcher gave normal printing → identity_only (printing mismatch)', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Charizard [1st Edition] #4',
      tcg_printing_key: 'normal',   // matcher mis-selected
      tcg_card_id: 'pkm_base1_4',
    });
    expect(v.eligibility).toBe('identity_only');
    expect(v.reasons.some(r => r.includes('variant_tag_but_printing_mismatch'))).toBe(true);
  });

  it('language mismatch → identity_only', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_language: 'en',
      tcg_language: 'ja',
    });
    expect(v.eligibility).toBe('identity_only');
    expect(v.reasons.some(r => r.includes('language_mismatch'))).toBe(true);
  });

  it('promo-reprint TCG id → identity_only', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      tcg_card_id: 'pkm_wcd2015_charizard',
    });
    expect(v.eligibility).toBe('identity_only');
    expect(v.reasons).toContain('tcg_card_is_promo_reprint');
  });

  it('shared TCG target with another PP slug → identity_only', () => {
    const v = classifyEligibility({ ...baseVerifiedInput, shares_tcg_target_with_other_pp_slug: true });
    expect(v.eligibility).toBe('identity_only');
    expect(v.reasons).toContain('shares_tcg_target_with_other_pp_slug');
  });

  it('[Rainbow Foil] (no TCG printing key) → identity_only, not market_only', () => {
    // Regression: Rainbow Foil must not be mis-approved as market_only
    // just because 'Foil' alone maps to a key.
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Charizard [Rainbow Foil] #4',
    });
    expect(v.eligibility).toBe('identity_only');
    expect(v.reasons.some(r => r.includes('tcg_has_no_printing_key_for:Rainbow Foil'))).toBe(true);
  });
});

describe('classifyEligibility — not_eligible / uncertain', () => {
  it('unmatched status → not_eligible', () => {
    const v = classifyEligibility({ ...baseVerifiedInput, review_status: 'unmatched', tcg_card_id: null });
    expect(v.eligibility).toBe('not_eligible');
  });

  it('rejected status → not_eligible', () => {
    const v = classifyEligibility({ ...baseVerifiedInput, review_status: 'rejected' });
    expect(v.eligibility).toBe('not_eligible');
  });

  it('no_tcg_equivalent → not_eligible', () => {
    const v = classifyEligibility({ ...baseVerifiedInput, review_status: 'no_tcg_equivalent' });
    expect(v.eligibility).toBe('not_eligible');
  });

  it('medium confidence → uncertain', () => {
    const v = classifyEligibility({ ...baseVerifiedInput, confidence: 'medium' });
    expect(v.eligibility).toBe('uncertain');
  });

  it('low confidence → uncertain', () => {
    const v = classifyEligibility({ ...baseVerifiedInput, confidence: 'low' });
    expect(v.eligibility).toBe('uncertain');
  });

  it('null confidence → uncertain', () => {
    const v = classifyEligibility({ ...baseVerifiedInput, confidence: null });
    expect(v.eligibility).toBe('uncertain');
  });
});

describe('classifyEligibility — base vs first edition vs shadowless invariants', () => {
  const base = 'pkm_base1_4'; // Charizard, Base Set

  it('base-set unlimited Charizard → bulk_safe', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Charizard #4',
      tcg_card_id: base,
      tcg_printing_key: 'normal',
    });
    expect(v.eligibility).toBe('bulk_safe');
  });

  it('1st edition Charizard → market_only (variant printing key matched)', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Charizard [1st Edition] #4',
      tcg_card_id: base,
      tcg_printing_key: '1st-edition',
    });
    expect(v.eligibility).toBe('market_only');
    expect(v.expected_printing_key).toBe('1st-edition');
  });

  it('shadowless Charizard → market_only', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Charizard [Shadowless] #4',
      tcg_card_id: base,
      tcg_printing_key: 'shadowless',
    });
    expect(v.eligibility).toBe('market_only');
    expect(v.expected_printing_key).toBe('shadowless');
  });

  it('1st edition Charizard WITHOUT the 1st-edition printing key → identity_only (unsafe)', () => {
    const v = classifyEligibility({
      ...baseVerifiedInput,
      pp_card_name: 'Charizard [1st Edition] #4',
      tcg_card_id: base,
      tcg_printing_key: 'normal',  // wrong — would charge unlimited price for 1st Ed
    });
    expect(v.eligibility).toBe('identity_only');
  });
});

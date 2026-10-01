// eBay affiliate URL builder — LorcanaPrices.
//
// Thin adapter over @collector-network/affiliate. Shared package
// handles EPN campaign wiring, marketplace routing and customid
// sanitisation. Campaign ID 5339215010 comes from EBAY_EPN_CAMPAIGN_ID
// on the lorcana-web Vercel project.
//
// The query terminator "Disney Lorcana" matches how collectors list
// the game on eBay — "Lorcana" alone collides with crafting listings.

import {
  buildEbaySearchLink,
  type EbayGameConfig,
  type EbayLink,
  type EbayMarketplace,
} from '@collector-network/affiliate';
import type { LorcanaCurrency } from '../currency';

const LORCANA_CONFIG: EbayGameConfig = {
  gameTerminator: 'Disney Lorcana',
};

// ── Regional marketplace resolution ───────────────────────────────
//
// Preference order:
//   1. explicit `country` ISO code when it maps to a supported eBay
//      marketplace (via a conservative allow-list)
//   2. currency hint (weak — EUR does NOT imply .de or .fr)
//   3. ebay.com
//
// We never request precise geolocation. The `country` input is
// typically Vercel's `x-vercel-ip-country` header, which is an
// approximate ISO country code. Browser GPS is never used.

const SUPPORTED_COUNTRIES: Record<string, EbayMarketplace> = {
  US: 'US',
  GB: 'GB',
  UK: 'GB',   // some edge headers emit UK; map to GB
  DE: 'DE',
  FR: 'FR',
  IT: 'IT',
  ES: 'ES',
  AU: 'AU',
  CA: 'CA',
};

function marketplaceFromCurrencyFallback(
  currency: LorcanaCurrency | null | undefined,
): EbayMarketplace {
  // Deliberately conservative. EUR tells us the collector reads
  // prices in EUR; it does NOT tell us they live in Germany or
  // France. ebay.com is the safe default.
  if (currency === 'EUR') return 'US';
  return 'US';
}

export function resolveLorcanaMarketplace(
  country: string | null | undefined,
  currency: LorcanaCurrency | null | undefined,
): EbayMarketplace {
  if (country) {
    const key = country.trim().toUpperCase();
    const mapped = SUPPORTED_COUNTRIES[key];
    if (mapped) return mapped;
  }
  return marketplaceFromCurrencyFallback(currency);
}

// ── Link builder ──────────────────────────────────────────────────

export interface EbayLinkParams {
  cardName: string;
  setName?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  /** Only pass real finish values that live on the printing (e.g.
   *  "foil", "nonfoil"). Never fabricate. The shared builder
   *  interprets 'foil' and omits 'nonfoil'. */
  finish?: string | null;
  /** Only pass when the collectible genuinely has this rarity label
   *  (e.g. "Enchanted", "Iconic", "Promo", "Super rare"). Appended
   *  to the search query verbatim; shared builder quotes the whole
   *  string. */
  rarity?: string | null;
  /** Legacy param — some callers used `treatmentLabel`/`finishOrTreatment`.
   *  Prefer `rarity`. If both are given, rarity wins. */
  treatmentLabel?: string | null;
  /** @deprecated Use rarity or finish separately. */
  finishOrTreatment?: string | null;
  marketplace?: EbayMarketplace;
  /** EPN customid for analytics granularity. Examples:
   *  "lorcana-card", "lorcana-card-exact", "lorcana-character",
   *  "lorcana-set". */
  source?: string | null;
}

export function buildLorcanaEbayLink(params: EbayLinkParams): EbayLink {
  // Only pass a rarity modifier when it was explicitly supplied by
  // the caller — never invent "Enchanted" / "Foil" from the UI.
  const modifier =
    params.rarity?.trim() ||
    params.treatmentLabel?.trim() ||
    params.finishOrTreatment?.trim() ||
    undefined;
  return buildEbaySearchLink(
    {
      cardName: params.cardName,
      setName: params.setName ?? null,
      setCode: params.setCode ?? null,
      collectorNumber: params.collectorNumber ?? null,
      finish: params.finish ?? null,
      modifier,
      marketplace: params.marketplace,
      source: params.source ?? null,
    },
    LORCANA_CONFIG,
  );
}

export function buildEbaySearchUrl(params: EbayLinkParams): string {
  return buildLorcanaEbayLink(params).href;
}

// eBay affiliate URL builder — LorcanaPrices.
//
// Thin adapter over @collector-network/affiliate. Shared package
// handles EPN campaign wiring, marketplace routing and customid
// sanitisation.

import {
  buildEbaySearchLink,
  type EbayLink,
  type EbayMarketplace,
} from '@collector-network/affiliate';

const LORCANA_CONFIG = {
  gameTerminator: 'Disney Lorcana',
} as const;

export interface EbayLinkParams {
  cardName: string;
  setName?: string | null;
  collectorNumber?: string | null;
  treatmentLabel?: string | null;
  /** Any of: Enchanted, Iconic, Epic, Legendary, Promo, Foil, etc. */
  finishOrTreatment?: string | null;
  marketplace?: EbayMarketplace;
  source?: string | null;
}

export function buildLorcanaEbayLink(params: EbayLinkParams): EbayLink {
  return buildEbaySearchLink(
    {
      cardName: params.cardName,
      setName: params.setName ?? null,
      collectorNumber: params.collectorNumber ?? null,
      modifier: params.treatmentLabel ?? undefined,
      finish: params.finishOrTreatment ?? null,
      marketplace: params.marketplace,
      source: params.source ?? null,
    },
    LORCANA_CONFIG,
  );
}

export function buildEbaySearchUrl(params: EbayLinkParams): string {
  return buildLorcanaEbayLink(params).href;
}

// packages/affiliate/src/ebay.ts
// Shared eBay Partner Network (EPN) link builder.
//
// Design:
//   * ONE EPN campaign per specialist site, set via env
//     EBAY_EPN_CAMPAIGN_ID. Sites are attributed by campaign id.
//   * Marketplaces (US/GB/DE/FR/IT/ES/AU/CA) each have their own
//     stable mkrid published by EPN, hardcoded below.
//   * `customid` carries a caller-provided sub-id for placement/card
//     granularity in EPN analytics without leaking secrets.
//   * If the master switch is off or no campaign id is configured
//     the builder still returns a valid eBay search URL, just without
//     tracking params.
//
// Each site passes its own game vocabulary through EbayGameConfig so
// the query text and eBay category are game-appropriate.

export type EbayMarketplace = 'US' | 'GB' | 'DE' | 'FR' | 'IT' | 'ES' | 'AU' | 'CA';

const HOST_BY_MARKETPLACE: Record<EbayMarketplace, string> = {
  US: 'www.ebay.com',
  GB: 'www.ebay.co.uk',
  DE: 'www.ebay.de',
  FR: 'www.ebay.fr',
  IT: 'www.ebay.it',
  ES: 'www.ebay.es',
  AU: 'www.ebay.com.au',
  CA: 'www.ebay.ca',
};

// Public EPN MKCID/MKRID pairs. Constants published by eBay Partner
// Network, safe to hardcode. `mkcid=1` is the "search" event class.
const MK_IDS: Record<EbayMarketplace, { mkcid: string; mkrid: string }> = {
  US: { mkcid: '1', mkrid: '711-53200-19255-0' },
  GB: { mkcid: '1', mkrid: '710-53481-19255-0' },
  DE: { mkcid: '1', mkrid: '707-53477-19255-0' },
  FR: { mkcid: '1', mkrid: '709-53476-19255-0' },
  IT: { mkcid: '1', mkrid: '724-53478-19255-0' },
  ES: { mkcid: '1', mkrid: '1185-53479-19255-0' },
  AU: { mkcid: '1', mkrid: '705-53470-19255-0' },
  CA: { mkcid: '1', mkrid: '706-53473-19255-0' },
};

// eBay category id. 38292 is "Collectible Card Games" (parent) — the
// safe default for network-wide searches. Games that want a narrower
// sub-category can override via EbayGameConfig.categoryId.
export const CCG_CATEGORY_ID = '38292';

export interface EbayGameConfig {
  /** Terminator appended to the search query, e.g. "Yu-Gi-Oh!" or
   *  "One Piece Card Game" or "Disney Lorcana". */
  gameTerminator: string;
  /** eBay _sacat category id. Defaults to Collectible Card Games. */
  categoryId?: string;
  /** Optional customid prefix so multiple sites sharing a campaign
   *  (not our current setup, but future-proof) stay attributable. */
  customIdPrefix?: string;
}

export interface EbaySearchInput {
  cardName: string;
  setName?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  /** Optional finish signal. Callers pass the concrete finish string
   *  they use internally (e.g. 'foil', 'holo', 'enchanted'). We only
   *  append it to the query text — no interpretation. */
  finish?: string | null;
  /** Optional language hint e.g. 'jp'. Appends "japanese" when jp. */
  language?: string | null;
  marketplace?: EbayMarketplace;
  /** Additional descriptive text (e.g. treatment label, rarity). */
  modifier?: string;
  /** Origin identifier used as `customid` in EPN analytics. Sanitised
   *  down to [a-z0-9-] and capped at 40 chars. Prefer stable short
   *  values like "card-overview" or "treatment-panel". */
  source?: string | null;
}

export interface EbayLink {
  href: string;
  marketplace: EbayMarketplace;
  /** true when EPN tracking params were attached. */
  affiliate: boolean;
  /** Sensible default UI label for the link. */
  label: string;
}

function defaultMarketplace(): EbayMarketplace {
  const raw = (process.env['EBAY_DEFAULT_MARKETPLACE'] ?? 'US').toUpperCase();
  return (raw in HOST_BY_MARKETPLACE ? raw : 'US') as EbayMarketplace;
}

/** Pick a marketplace from an ISO 3166 alpha-2 country hint. */
export function marketplaceFor(country?: string | null): EbayMarketplace {
  if (!country) return defaultMarketplace();
  const key = country.toUpperCase() as EbayMarketplace;
  return HOST_BY_MARKETPLACE[key] ? key : defaultMarketplace();
}

/** Returns the site's EPN campaign id, or null when unset. */
export function epnCampaignId(): string | null {
  const v = (process.env['EBAY_EPN_CAMPAIGN_ID'] ?? '').trim();
  return v ? v : null;
}

/** Master switch. Tracking only appears when both this and the
 *  campaign id are configured. */
export function ebayAffiliateEnabled(): boolean {
  return process.env['EBAY_AFFILIATE_ENABLED'] === 'true';
}

function sanitiseCustomId(raw: string | null | undefined, prefix?: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  if (!cleaned) return null;
  if (!prefix) return cleaned;
  const combined = `${prefix}-${cleaned}`.replace(/-+/g, '-').slice(0, 40);
  return combined;
}

function buildQuery(input: EbaySearchInput, config: EbayGameConfig): string {
  const parts: string[] = [input.cardName];
  if (input.setName) parts.push(input.setName);
  if (input.collectorNumber) parts.push(String(input.collectorNumber));
  if (input.finish) parts.push(input.finish);
  if (input.language && input.language.toLowerCase() === 'jp') parts.push('japanese');
  if (input.modifier) parts.push(input.modifier);
  parts.push(config.gameTerminator);
  return parts.filter(Boolean).join(' ');
}

function defaultLabel(input: EbaySearchInput): string {
  if (input.finish && /foil|holo/i.test(input.finish)) return `Find foil copies on eBay`;
  if (input.setName && input.collectorNumber) return `Find this printing on eBay`;
  if (input.setName) return `Find ${input.setName} copies on eBay`;
  return `Search this card on eBay`;
}

/** Build the search URL. Adds EPN tracking params when configured. */
export function buildEbaySearchLink(
  input: EbaySearchInput,
  config: EbayGameConfig,
): EbayLink {
  const marketplace = input.marketplace ?? defaultMarketplace();
  const host = HOST_BY_MARKETPLACE[marketplace];

  const url = new URL(`https://${host}/sch/i.html`);
  url.searchParams.set('_nkw', buildQuery(input, config));
  url.searchParams.set('_sacat', config.categoryId ?? CCG_CATEGORY_ID);

  const campid = epnCampaignId();
  const enabled = ebayAffiliateEnabled();
  const affiliate = Boolean(campid) && enabled;

  if (affiliate && campid) {
    const ids = MK_IDS[marketplace];
    url.searchParams.set('mkevt', '1');
    url.searchParams.set('mkcid', ids.mkcid);
    url.searchParams.set('mkrid', ids.mkrid);
    url.searchParams.set('campid', campid);
    url.searchParams.set('toolid', '10001');
    const custom = sanitiseCustomId(input.source, config.customIdPrefix);
    if (custom) url.searchParams.set('customid', custom);
  }

  return {
    href: url.toString(),
    marketplace,
    affiliate,
    label: defaultLabel(input),
  };
}

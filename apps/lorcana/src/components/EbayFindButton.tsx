// EbayFindButton — LorcanaPrices
//
// Prominent affiliate CTA reused on card / printing / set surfaces.
// Underlying URL built by @collector-network/affiliate via
// apps/lorcana/src/lib/lorcana/ebay.ts. Silent when the campaign env
// is absent — still returns a working search link so the user gets a
// useful outbound in every environment.
//
// Server-rendered. Callers pass:
//   - the collectible identity (cardName, setName, setCode, cn)
//   - the exact rarity ONLY when the collectible truly has that
//     rarity (Enchanted, Iconic, Promo, etc.) — never fabricated
//   - the exact finish ONLY when the printing is actually that
//     finish (foil / nonfoil) — see TreatmentPanel for conservative
//     invocation
//   - a `marketplace` prop resolved on the server from request
//     country + currency via resolveLorcanaMarketplace()

import type { EbayMarketplace } from '@collector-network/affiliate';
import { buildLorcanaEbayLink } from '../lib/lorcana/ebay';

export type EbayFindButtonSize = 'sm' | 'md' | 'lg';

export interface EbayFindButtonProps {
  cardName?: string;
  setName?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  /** Lorcana rarity label — ONLY pass when the collectible actually
   *  has it. Appended to the search query verbatim. */
  rarity?: string | null;
  /** 'foil' | 'nonfoil' | null. */
  finish?: string | null;
  /** @deprecated, prefer the explicit `rarity` + `finish` pair. */
  finishOrTreatment?: string | null;
  /** Server-resolved regional marketplace (see
   *  resolveLorcanaMarketplace in lib/lorcana/ebay.ts). */
  marketplace?: EbayMarketplace;
  /** For sealed / set-scope buttons; overrides cardName in query. */
  sealedSearchTerm?: string;
  /** EPN customid analytics origin. */
  source: string;
  size?: EbayFindButtonSize;
  label?: string;
}

const SIZES: Record<EbayFindButtonSize, { padding: string; fontSize: number; borderRadius: number }> = {
  sm: { padding: '8px 12px',  fontSize: 12, borderRadius: 8 },
  md: { padding: '11px 16px', fontSize: 13, borderRadius: 10 },
  lg: { padding: '14px 22px', fontSize: 15, borderRadius: 12 },
};

export default function EbayFindButton(props: EbayFindButtonProps) {
  const link = buildLorcanaEbayLink({
    cardName: props.sealedSearchTerm ?? props.cardName ?? 'Disney Lorcana',
    setName: props.setName ?? null,
    setCode: props.setCode ?? null,
    collectorNumber: props.collectorNumber ?? null,
    rarity: props.rarity ?? null,
    finish: props.finish ?? null,
    finishOrTreatment: props.finishOrTreatment ?? null,
    marketplace: props.marketplace,
    source: props.source,
  });
  const size = SIZES[props.size ?? 'sm'];
  const baseLabel = props.label ?? (props.sealedSearchTerm
    ? `Find sealed ${props.setName ?? 'Lorcana'} on eBay`
    : props.rarity
    ? `Find ${props.rarity} copies on eBay`
    : props.finishOrTreatment
    ? `Find ${props.finishOrTreatment} copies on eBay`
    : props.cardName
    ? `Find ${props.cardName} on eBay`
    : 'Find on eBay');
  return (
    <a
      href={link.href}
      target="_blank"
      rel="sponsored nofollow noopener noreferrer"
      data-affiliate={link.affiliate ? '1' : '0'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: size.padding,
        borderRadius: size.borderRadius,
        background: 'linear-gradient(180deg, #f5c518 0%, #e0b21b 100%)',
        color: '#1a1a1a',
        fontWeight: 700,
        fontSize: size.fontSize,
        letterSpacing: '0.01em',
        textDecoration: 'none',
        border: '1px solid rgba(0, 0, 0, 0.15)',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
        whiteSpace: 'nowrap',
      }}
    >
      <span>{baseLabel}<sup style={{ fontSize: '0.8em', marginLeft: 2 }}>*</sup></span>
      <span aria-hidden style={{ fontSize: '0.85em', opacity: 0.7 }}>↗</span>
    </a>
  );
}

/** Small unobtrusive affiliate disclosure. Reused on card + set + any
 *  page that renders an EbayFindButton. */
export function EbayAffiliateDisclosure() {
  return (
    <p
      style={{
        marginTop: 32,
        marginBottom: 0,
        fontSize: 11,
        lineHeight: 1.55,
        color: 'var(--text-subtle, #7a6a4a)',
        textAlign: 'center',
      }}
    >
      * Affiliate link. LorcanaPrices may earn a commission from
      qualifying purchases at no additional cost to you. LorcanaPrices
      is not affiliated with, endorsed by, or sponsored by eBay or
      Disney.
    </p>
  );
}

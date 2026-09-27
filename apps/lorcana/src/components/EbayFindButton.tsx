// EbayFindButton — LorcanaPrices
//
// Prominent affiliate CTA reused on card / printing / set surfaces.
// Underlying URL built by @collector-network/affiliate via
// apps/lorcana/src/lib/lorcana/ebay.ts. Silent when the campaign env
// is absent — still returns a working search link so the user gets a
// useful outbound in every environment.

import { buildLorcanaEbayLink } from '../lib/lorcana/ebay';

export type EbayFindButtonSize = 'sm' | 'md' | 'lg';

export interface EbayFindButtonProps {
  cardName?: string;
  setName?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  finishOrTreatment?: string | null;
  /** For sealed / set-scope buttons; overrides cardName in query. */
  sealedSearchTerm?: string;
  /** EPN customid analytics origin. */
  source: string;
  size?: EbayFindButtonSize;
  label?: string;
  /** Show short affiliate disclosure inline (small, muted). */
  disclose?: boolean;
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
    collectorNumber: props.collectorNumber ?? null,
    finishOrTreatment: props.finishOrTreatment ?? null,
    source: props.source,
  });
  // Default to 'sm' — the previous 'lg' was visually overpowering
  // the primary Add-to-Collection action. Callers who want a bigger
  // treatment can still request it.
  const size = SIZES[props.size ?? 'sm'];
  const baseLabel = props.label ?? (props.sealedSearchTerm
    ? `Find sealed ${props.setName ?? 'Lorcana'} on eBay`
    : (props.finishOrTreatment ? `Find ${props.finishOrTreatment} copies on eBay` : `Find on eBay`));
  // Single asterisk footnote marker per launch brief. Long disclosure
  // now lives in the page footer (EbayAffiliateDisclosure component).
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
      qualifying purchases at no additional cost to you.
    </p>
  );
}

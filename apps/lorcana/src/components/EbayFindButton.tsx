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
  const size = SIZES[props.size ?? 'md'];
  const label = props.label ?? (props.sealedSearchTerm
    ? `Find sealed ${props.setName ?? 'Lorcana'} on eBay`
    : (props.finishOrTreatment ? `Find ${props.finishOrTreatment} copies on eBay` : `Find on eBay`));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <a
        href={link.href}
        target="_blank"
        rel="sponsored nofollow noopener noreferrer"
        data-affiliate={link.affiliate ? '1' : '0'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: size.padding,
          borderRadius: size.borderRadius,
          background: 'linear-gradient(180deg, #f5c518 0%, #e0b21b 100%)',
          color: '#1a1a1a',
          fontWeight: 700,
          fontSize: size.fontSize,
          letterSpacing: '0.02em',
          textDecoration: 'none',
          border: '1px solid rgba(0, 0, 0, 0.15)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{label}</span>
        <span aria-hidden style={{ fontSize: '0.85em', opacity: 0.7 }}>↗</span>
      </a>
      {props.disclose && (
        <span style={{ fontSize: 11, color: 'var(--text-muted, #6a5a41)' }}>
          Affiliate. We may earn a commission from qualifying eBay purchases.
        </span>
      )}
    </span>
  );
}

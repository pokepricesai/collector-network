// TcgplayerFindButton — LorcanaPrices
//
// CN-05 Sprint 4 — second buying CTA alongside EbayFindButton on the
// exact-collectible action strip. Uses the Impact share-link deep-
// link pattern verified in Sprint 4. Exact-product URL when the
// printing row carries a numeric `tcg_printings.tcgplayer_id`;
// search fallback with an honest "Find on TCGplayer" label otherwise.
//
// Outlined styling to visually balance with the eBay primary fill.
// Same inline-style approach as EbayFindButton so there's no new
// CSS module and no layout shift.
//
// Click tracking: the shared @collector-network/affiliate-tracking/
// client beacon (wired in Lorcana layout) sees `data-affiliate="1"`
// and emits a GA4 `affiliate_click` event with the surrounding
// data-* attributes. No per-click Supabase write.

import { buildLorcanaTcgplayerLink } from '../lib/tcgplayerAffiliate';

export type TcgplayerFindButtonSize = 'sm' | 'md' | 'lg';

export interface TcgplayerFindButtonProps {
  cardName: string;
  collectorNumber?: string | null;
  /** `tcg_printings.tcgplayer_id`; when numeric, resolves to the
   *  exact product URL rather than a search. */
  productId?: number | null;
  /** Origin identifier for Impact SubID + GA4 placement. */
  source: string;
  size?: TcgplayerFindButtonSize;
  label?: string;
}

const SIZES: Record<TcgplayerFindButtonSize, { padding: string; fontSize: number; borderRadius: number }> = {
  sm: { padding: '8px 12px',  fontSize: 12, borderRadius: 8 },
  md: { padding: '11px 16px', fontSize: 13, borderRadius: 10 },
  lg: { padding: '14px 22px', fontSize: 15, borderRadius: 12 },
};

export default function TcgplayerFindButton(props: TcgplayerFindButtonProps) {
  const link = buildLorcanaTcgplayerLink({
    cardName: props.cardName,
    collectorNumber: props.collectorNumber ?? null,
    productId: props.productId ?? null,
    subid: `lor:${props.source}:${(props.collectorNumber ?? '').toString().slice(0, 40)}`,
  });
  const size = SIZES[props.size ?? 'sm'];
  const label = props.label ?? link.label;
  return (
    <a
      href={link.href}
      target="_blank"
      rel="sponsored nofollow noopener noreferrer"
      data-affiliate="1"
      data-placement={props.source}
      data-component="TcgplayerFindButton"
      data-page-type="card"
      data-intent={link.isExact ? 'exact' : 'search'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: size.padding,
        borderRadius: size.borderRadius,
        background: 'var(--surface, #fff)',
        color: 'var(--text, #1a1a1a)',
        fontWeight: 700,
        fontSize: size.fontSize,
        letterSpacing: '0.01em',
        textDecoration: 'none',
        border: '1px solid var(--border, rgba(0, 0, 0, 0.3))',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
        whiteSpace: 'nowrap',
      }}
    >
      <span>{label}<sup style={{ fontSize: '0.8em', marginLeft: 2 }}>*</sup></span>
      <span aria-hidden style={{ fontSize: '0.85em', opacity: 0.7 }}>↗</span>
    </a>
  );
}

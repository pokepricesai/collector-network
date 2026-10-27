// TcgplayerLinkButton — YGO
//
// CN-05 Sprint 4 — second buying CTA alongside EbayLinkButton. Uses
// the Impact share-link deep-link pattern (verified in Sprint 4).
// When the printing row carries a verified `tcg_printings.tcgplayer_id`
// the link resolves to an exact TCGplayer product page; otherwise it
// falls back to a search URL and the label changes to "Find on
// TCGplayer" so the search nature is explicit.
//
// GA4 `affiliate_click` events are emitted by the shared
// @collector-network/affiliate-tracking/client capture-phase beacon
// (already wired in apps/yugioh/src/app/layout.tsx). This component
// just needs the standard data-affiliate attribute set so the beacon
// picks it up. No per-click Supabase write.

import { buildYugiohTcgplayerLink } from '../../lib/tcgplayerAffiliate';
import styles from './TcgplayerLinkButton.module.css';

export interface TcgplayerLinkButtonProps {
  cardName: string;
  /** Collector number from the printing row; appended to the search
   *  query when there's no exact productId. */
  collectorNumber?: string | null;
  /** `tcg_printings.tcgplayer_id` for this printing. If null, the
   *  button renders a search-URL fallback instead of hiding — users
   *  still have a working outbound path. */
  productId?: number | null;
  /** Origin identifier for Impact SubID and GA4 placement. */
  source: string;
  /** Optional CTA override. Defaults to the honest label. */
  label?: string;
}

export function TcgplayerLinkButton(props: TcgplayerLinkButtonProps) {
  const link = buildYugiohTcgplayerLink({
    cardName: props.cardName,
    collectorNumber: props.collectorNumber ?? null,
    productId: props.productId ?? null,
    subid: `ygo:${props.source}:${(props.collectorNumber ?? '').toString().slice(0, 40)}`,
  });

  return (
    <a
      href={link.href}
      target="_blank"
      rel="sponsored nofollow noopener noreferrer"
      className={styles.tcgBtn}
      data-affiliate="1"
      data-placement={props.source}
      data-component="TcgplayerLinkButton"
      data-page-type="printing"
      data-intent={link.isExact ? 'exact' : 'search'}
    >
      <span aria-hidden>🏷️</span>
      <span className={styles.tcgText}>{props.label ?? link.label}</span>
      <span className={styles.tcgArrow} aria-hidden>↗</span>
    </a>
  );
}

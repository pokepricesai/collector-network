// EbayLinkButton — YGO
//
// Renders an outbound eBay affiliate CTA on printing / card pages. The
// underlying URL is built via @collector-network/affiliate (shared
// EPN wiring) → apps/yugioh/src/lib/ebay.ts adapter. The button is
// silent when affiliate mode is off — we still render a search link
// so users get a working search either way.

import { buildYugiohEbayLink } from '../../lib/ebay';
import styles from './EbayLinkButton.module.css';

export interface EbayLinkButtonProps {
  cardName: string;
  setName?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  edition?: string | null;
  rarity?: string | null;
  /** For graded panels ("PSA 10", etc). */
  gradedLabel?: string | null;
  /** Origin identifier for EPN customid analytics. */
  source: string;
  /** Optional override for the CTA text. */
  label?: string;
}

export function EbayLinkButton(props: EbayLinkButtonProps) {
  const link = buildYugiohEbayLink({
    cardName: props.cardName,
    setName: props.setName ?? null,
    setCode: props.setCode ?? null,
    collectorNumber: props.collectorNumber ?? null,
    edition: props.edition ?? null,
    rarity: props.rarity ?? null,
    gradedLabel: props.gradedLabel ?? null,
    source: props.source,
  });
  return (
    <a
      href={link.href}
      target="_blank"
      rel="sponsored nofollow noopener noreferrer"
      className={styles.ebayBtn}
      data-affiliate={link.affiliate ? '1' : '0'}
      data-placement={props.source}
      data-component="EbayLinkButton"
      data-intent={props.gradedLabel ? 'graded' : (props.rarity ? 'rarity' : 'raw')}
    >
      <span className={styles.ebayText}>{props.label ?? link.label}</span>
      <span className={styles.ebayArrow} aria-hidden>↗</span>
    </a>
  );
}

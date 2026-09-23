import Link from 'next/link';
import { EditionBadge } from '../EditionBadge';
import { RarityBadge } from '../RarityBadge';
import type { PrintingVariant } from '../../server/card';
import styles from './CardIdentity.module.css';

interface VariantsTableProps {
  variants: PrintingVariant[];
  cardSlug: string;
  highlightPrintingId?: string;
}

// Full-printings table used by both the card page and the printing
// page. Every row links to its own printing page unless the row is
// the currently-viewed printing (highlighted, non-link).
export function VariantsTable({
  variants,
  cardSlug,
  highlightPrintingId,
}: VariantsTableProps) {
  if (variants.length === 0) {
    return <div className={styles.emptyState}>No other printings indexed for this card family yet.</div>;
  }
  return (
    <table className={styles.variantsTable}>
      <thead>
        <tr>
          <th>Set</th>
          <th>Card #</th>
          <th>Rarity</th>
          <th>Edition</th>
          <th>Finish / lang</th>
          <th style={{ textAlign: 'right' }}>USD</th>
          <th style={{ textAlign: 'right' }}>EUR</th>
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => {
          const isActive = highlightPrintingId === v.printing.id;
          const href = `/card/${cardSlug}/printing/${encodeURIComponent(
            v.printing.collector_number ?? '',
          )}/${encodeURIComponent(v.printingKey)}`;
          const releaseYear = v.set?.released_at
            ? v.set.released_at.slice(0, 4)
            : '';
          return (
            <tr key={v.printing.id} className={isActive ? styles.variantRowActive : ''}>
              <td>
                {isActive ? (
                  <span>{v.set?.name ?? v.printing.set_id}</span>
                ) : (
                  <Link className={styles.variantLink} href={href}>
                    {v.set?.name ?? v.printing.set_id}
                  </Link>
                )}
                {releaseYear && (
                  <span className={styles.dim} style={{ marginLeft: 8, fontSize: 11 }}>
                    {releaseYear}
                  </span>
                )}
              </td>
              <td>
                <span className={styles.setCode}>
                  {v.printing.collector_number ?? '—'}
                </span>
              </td>
              <td>
                <RarityBadge rarity={v.card.rarity} />
              </td>
              <td>
                <EditionBadge edition={v.printing.edition} />
              </td>
              <td>
                <span className={styles.dim}>
                  {[v.printing.finish, v.printing.language?.toUpperCase()]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                {v.bestUsdRetail?.price != null ? (
                  <span className={styles.priceNum}>
                    ${v.bestUsdRetail.price.toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                ) : (
                  <span className={styles.dim}>—</span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                {v.bestEurRetail?.price != null ? (
                  <span className={styles.priceNum}>
                    €{v.bestEurRetail.price.toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                ) : (
                  <span className={styles.dim}>—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

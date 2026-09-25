import Link from 'next/link';
import { CardMiniThumb } from '../card-visual/CardMiniThumb';
import { EditionBadge } from '../EditionBadge';
import { RarityBadge } from '../RarityBadge';
import type { PrintingVariant } from '../../server/card';
import styles from './CardIdentity.module.css';
import mobile from '../market/MarketRankingRow.module.css';

interface VariantsTableProps {
  variants: PrintingVariant[];
  cardSlug: string;
  highlightPrintingId?: string;
}

// Full-printings table used by both the card page and the printing
// page. Every row links to its own printing page unless the row is
// the currently-viewed printing (highlighted, non-link).
//
// Emits BOTH the desktop table (wrapped in the shared .tableScroll
// container so any intermediate-viewport overflow stays inside the
// component) and a mobile stacked list. CSS at ≤ 767px hides the
// table and shows the list — same responsive pattern as
// MarketRankingTable, GradedRankingTable and the F&L page.
export function VariantsTable({
  variants,
  cardSlug,
  highlightPrintingId,
}: VariantsTableProps) {
  if (variants.length === 0) {
    return <div className={styles.emptyState}>No other printings indexed for this card family yet.</div>;
  }
  return (
    <>
      <div className={mobile.tableScroll}>
      <table className={`${styles.variantsTable} ${mobile.desktopTable}`}>
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
                    {v.printing.collector_number ?? '-'}
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
                    <span className={styles.dim}>-</span>
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
                    <span className={styles.dim}>-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* Mobile stacked list - hidden ≥ 768px via CSS. Preserves
          every column from the desktop table but stacks them so no
          column can push the document horizontally. Thumbnail is
          included when the underlying card image is available. */}
      <ol className={mobile.list} aria-label="Printings">
        {variants.map((v) => {
          const isActive = highlightPrintingId === v.printing.id;
          const href = `/card/${cardSlug}/printing/${encodeURIComponent(
            v.printing.collector_number ?? '',
          )}/${encodeURIComponent(v.printingKey)}`;
          const releaseYear = v.set?.released_at
            ? v.set.released_at.slice(0, 4)
            : '';
          const finishLang = [v.printing.finish, v.printing.language?.toUpperCase()]
            .filter(Boolean)
            .join(' · ');
          return (
            <li
              key={v.printing.id}
              className={mobile.item}
              aria-current={isActive ? 'true' : undefined}
              style={
                isActive
                  ? { borderColor: 'rgba(201, 162, 74, 0.5)' }
                  : undefined
              }
            >
              {/* Rank slot omitted - variants have no rank; empty span
                  keeps the shared grid columns aligned. */}
              <span />
              {isActive ? (
                <span className={mobile.thumb} aria-label="Currently viewing">
                  <CardMiniThumb
                    src={
                      v.card.images?.small ?? v.card.images?.normal ?? null
                    }
                    alt={v.card.name}
                    size="md"
                  />
                </span>
              ) : (
                <Link href={href} className={mobile.thumb} aria-label={v.set?.name ?? v.printing.set_id}>
                  <CardMiniThumb
                    src={
                      v.card.images?.small ?? v.card.images?.normal ?? null
                    }
                    alt={v.card.name}
                    size="md"
                  />
                </Link>
              )}
              <div className={mobile.body}>
                {isActive ? (
                  <span className={mobile.name}>
                    {v.set?.name ?? v.printing.set_id}
                  </span>
                ) : (
                  <Link href={href} className={mobile.name}>
                    {v.set?.name ?? v.printing.set_id}
                  </Link>
                )}
                <span className={mobile.metaLine}>
                  <span className={mobile.setCode}>
                    {v.printing.collector_number ?? '-'}
                  </span>
                  {releaseYear && (
                    <>
                      <span className={mobile.metaDot}>·</span>
                      <span>{releaseYear}</span>
                    </>
                  )}
                </span>
                <span className={mobile.metaLine}>
                  <RarityBadge rarity={v.card.rarity} />
                  <EditionBadge edition={v.printing.edition} />
                  {finishLang && (
                    <>
                      <span className={mobile.metaDot}>·</span>
                      <span>{finishLang}</span>
                    </>
                  )}
                </span>
              </div>
              <div className={mobile.priceCol}>
                {v.bestUsdRetail?.price != null ? (
                  <span className={mobile.price}>
                    $
                    {v.bestUsdRetail.price.toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                ) : (
                  <span className={styles.dim}>-</span>
                )}
                {v.bestEurRetail?.price != null && (
                  <span className={mobile.priceSuffix}>
                    €
                    {v.bestEurRetail.price.toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

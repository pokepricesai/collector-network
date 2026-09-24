import Link from 'next/link';
import { EditionBadge } from '../EditionBadge';
import { RarityBadge } from '../RarityBadge';
import type { GradedRankingEntry, RetailRankingEntry } from '../../server/market';
import { toCardSlug } from '../../lib/slug';
import { normalisePrintingKey } from '../../lib/slug';
import styles from '../browse/Browse.module.css';

interface RetailTableProps {
  entries: RetailRankingEntry[];
  showRank?: boolean;
  currency: 'USD' | 'EUR';
}

// Shared table for retail rankings — /market, /market/most-valuable,
// /market/vintage all use it.
export function RetailRankingTable({ entries, showRank = true, currency }: RetailTableProps) {
  const symbol = currency === 'USD' ? '$' : '€';
  return (
    <table className={styles.cardsTable}>
      <thead>
        <tr>
          {showRank && <th style={{ width: 48 }}>#</th>}
          <th>Card</th>
          <th>Set</th>
          <th>Rarity</th>
          <th>Edition</th>
          <th style={{ textAlign: 'right' }}>{currency}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => {
          const cardSlug = toCardSlug(entry.card.name);
          const printingHref = `/card/${cardSlug}/printing/${encodeURIComponent(
            entry.printing.collector_number ?? '',
          )}/${encodeURIComponent(normalisePrintingKey(entry.printing.tcggraph_printing_key))}`;
          return (
            <tr key={entry.printing.id}>
              {showRank && (
                <td>
                  <span
                    style={{
                      fontFamily: 'var(--ygo-font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--ygo-text-quiet)',
                    }}
                  >
                    {i + 1}
                  </span>
                </td>
              )}
              <td>
                <Link href={printingHref} className={styles.cardLink}>
                  {entry.card.name}
                </Link>
                <div
                  style={{
                    fontFamily: 'var(--ygo-font-mono)',
                    fontSize: 11,
                    color: 'var(--ygo-text-quiet)',
                    marginTop: 2,
                  }}
                >
                  {entry.printing.collector_number}
                </div>
              </td>
              <td>
                {entry.set ? (
                  <Link
                    href={`/set/${encodeURIComponent(entry.set.code.toLowerCase())}`}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {entry.set.name}
                    <span
                      className={styles.dim}
                      style={{ marginLeft: 8, fontSize: 11 }}
                    >
                      {entry.set.released_at?.slice(0, 4)}
                    </span>
                  </Link>
                ) : (
                  <span className={styles.dim}>—</span>
                )}
              </td>
              <td>
                <RarityBadge rarity={entry.card.rarity} />
              </td>
              <td>
                <EditionBadge edition={entry.printing.edition} />
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className={styles.priceNum}>
                  {symbol}
                  {entry.quote.price!.toLocaleString('en-US', {
                    maximumFractionDigits: 2,
                  })}
                </span>
                <div
                  className={styles.dim}
                  style={{ fontSize: 10, textAlign: 'right' }}
                >
                  {entry.quote.source.split('.').pop()}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface GradedTableProps {
  entries: GradedRankingEntry[];
}

// Graded rankings. Explicitly labels the "printing-scoped" attribution
// (the query already filters attribution='printing') so the reader
// can trust the row belongs to the exact printing named.
export function GradedRankingTable({ entries }: GradedTableProps) {
  return (
    <table className={styles.cardsTable}>
      <thead>
        <tr>
          <th style={{ width: 48 }}>#</th>
          <th>Card</th>
          <th>Set</th>
          <th>Rarity</th>
          <th>Grader / grade</th>
          <th style={{ textAlign: 'right' }}>USD</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => {
          const cardSlug = toCardSlug(entry.card.name);
          const printingHref = `/card/${cardSlug}/printing/${encodeURIComponent(
            entry.printing.collector_number ?? '',
          )}/${encodeURIComponent(normalisePrintingKey(entry.printing.tcggraph_printing_key))}`;
          return (
            <tr key={entry.printing.id + entry.quote.grader}>
              <td>
                <span
                  style={{
                    fontFamily: 'var(--ygo-font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--ygo-text-quiet)',
                  }}
                >
                  {i + 1}
                </span>
              </td>
              <td>
                <Link href={printingHref} className={styles.cardLink}>
                  {entry.card.name}
                </Link>
                <div
                  style={{
                    fontFamily: 'var(--ygo-font-mono)',
                    fontSize: 11,
                    color: 'var(--ygo-text-quiet)',
                    marginTop: 2,
                  }}
                >
                  {entry.printing.collector_number}
                </div>
              </td>
              <td>
                {entry.set ? (
                  <Link
                    href={`/set/${encodeURIComponent(entry.set.code.toLowerCase())}`}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {entry.set.name}
                  </Link>
                ) : (
                  <span className={styles.dim}>—</span>
                )}
              </td>
              <td>
                <RarityBadge rarity={entry.card.rarity} />
              </td>
              <td>
                <span
                  style={{
                    fontFamily: 'var(--ygo-font-mono)',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--ygo-text-muted)',
                  }}
                >
                  {entry.quote.grader} · {entry.quote.grade}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className={styles.priceNum}>
                  $
                  {entry.quote.price!.toLocaleString('en-US', {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

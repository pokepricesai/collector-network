import Link from 'next/link';
import { CardMiniThumb } from '../card-visual/CardMiniThumb';
import { EditionBadge } from '../EditionBadge';
import { RarityBadge } from '../RarityBadge';
import type { GradedRankingEntry, RetailRankingEntry } from '../../server/market';
import { toCardSlug } from '../../lib/slug';
import { normalisePrintingKey } from '../../lib/slug';
import styles from '../browse/Browse.module.css';
import mobile from './MarketRankingRow.module.css';

// A single ranking component that emits both the desktop table and a
// mobile stacked list. CSS toggles visibility at 767px so we ship
// one server-rendered payload and let the client render the right
// variant without any JS.

interface RetailTableProps {
  entries: RetailRankingEntry[];
  showRank?: boolean;
  currency: 'USD' | 'EUR';
}

function printingHrefFor(entry: RetailRankingEntry | GradedRankingEntry): string {
  const cardSlug = toCardSlug(entry.card.name);
  return `/card/${cardSlug}/printing/${encodeURIComponent(
    entry.printing.collector_number ?? '',
  )}/${encodeURIComponent(normalisePrintingKey(entry.printing.tcggraph_printing_key))}`;
}

// Shared table for retail rankings — /market, /market/most-valuable,
// /market/vintage all use it.
export function RetailRankingTable({ entries, showRank = true, currency }: RetailTableProps) {
  const symbol = currency === 'USD' ? '$' : '€';
  return (
    <>
      <div className={mobile.tableScroll}>
      <table className={`${styles.cardsTable} ${mobile.desktopTable}`}>
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
            const printingHref = printingHrefFor(entry);
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
                  <div className={styles.thumbCell}>
                    <Link href={printingHref} aria-label={entry.card.name}>
                      <CardMiniThumb
                        src={
                          entry.card.images?.small ??
                          entry.card.images?.normal ??
                          null
                        }
                        alt={entry.card.name}
                        size="sm"
                      />
                    </Link>
                    <div className={styles.thumbCellText}>
                      <Link href={printingHref} className={styles.cardLink}>
                        {entry.card.name}
                      </Link>
                      <span
                        style={{
                          fontFamily: 'var(--ygo-font-mono)',
                          fontSize: 11,
                          color: 'var(--ygo-text-quiet)',
                        }}
                      >
                        {entry.printing.collector_number}
                      </span>
                    </div>
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
                    <span className={styles.dim}>-</span>
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
      </div>

      {/* Mobile stacked list - hidden ≥ 768px via CSS. */}
      <ol className={mobile.list} aria-label={`Top ${entries.length} by ${currency} retail`}>
        {entries.map((entry, i) => {
          const printingHref = printingHrefFor(entry);
          return (
            <li key={entry.printing.id} className={mobile.item}>
              {showRank ? (
                <span className={mobile.rank}>{i + 1}</span>
              ) : (
                <span />
              )}
              <Link
                href={printingHref}
                className={mobile.thumb}
                aria-label={entry.card.name}
              >
                <CardMiniThumb
                  src={
                    entry.card.images?.small ??
                    entry.card.images?.normal ??
                    null
                  }
                  alt={entry.card.name}
                  size="md"
                />
              </Link>
              <div className={mobile.body}>
                <Link href={printingHref} className={mobile.name}>
                  {entry.card.name}
                </Link>
                <span className={mobile.metaLine}>
                  {entry.set ? (
                    <Link
                      href={`/set/${encodeURIComponent(entry.set.code.toLowerCase())}`}
                      className={mobile.setLink}
                    >
                      <span className={mobile.setCode}>
                        {entry.set.code.toUpperCase()}
                      </span>
                    </Link>
                  ) : null}
                  {entry.printing.collector_number && (
                    <>
                      <span className={mobile.metaDot}>·</span>
                      <span>{entry.printing.collector_number}</span>
                    </>
                  )}
                </span>
                <span className={mobile.metaLine}>
                  <RarityBadge rarity={entry.card.rarity} />
                  <EditionBadge edition={entry.printing.edition} />
                </span>
              </div>
              <div className={mobile.priceCol}>
                <span className={mobile.price}>
                  {symbol}
                  {entry.quote.price!.toLocaleString('en-US', {
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className={mobile.priceSuffix}>
                  {entry.quote.source.split('.').pop()}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </>
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
    <>
      <div className={mobile.tableScroll}>
      <table className={`${styles.cardsTable} ${mobile.desktopTable}`}>
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
            const printingHref = printingHrefFor(entry);
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
                  <div className={styles.thumbCell}>
                    <Link href={printingHref} aria-label={entry.card.name}>
                      <CardMiniThumb
                        src={
                          entry.card.images?.small ??
                          entry.card.images?.normal ??
                          null
                        }
                        alt={entry.card.name}
                        size="sm"
                      />
                    </Link>
                    <div className={styles.thumbCellText}>
                      <Link href={printingHref} className={styles.cardLink}>
                        {entry.card.name}
                      </Link>
                      <span
                        style={{
                          fontFamily: 'var(--ygo-font-mono)',
                          fontSize: 11,
                          color: 'var(--ygo-text-quiet)',
                        }}
                      >
                        {entry.printing.collector_number}
                      </span>
                    </div>
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
                    <span className={styles.dim}>-</span>
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
      </div>

      {/* Mobile stacked list - hidden ≥ 768px via CSS. */}
      <ol className={mobile.list} aria-label={`Top ${entries.length} graded`}>
        {entries.map((entry, i) => {
          const printingHref = printingHrefFor(entry);
          return (
            <li key={entry.printing.id + entry.quote.grader} className={mobile.item}>
              <span className={mobile.rank}>{i + 1}</span>
              <Link
                href={printingHref}
                className={mobile.thumb}
                aria-label={entry.card.name}
              >
                <CardMiniThumb
                  src={
                    entry.card.images?.small ??
                    entry.card.images?.normal ??
                    null
                  }
                  alt={entry.card.name}
                  size="md"
                />
              </Link>
              <div className={mobile.body}>
                <Link href={printingHref} className={mobile.name}>
                  {entry.card.name}
                </Link>
                <span className={mobile.metaLine}>
                  {entry.set ? (
                    <Link
                      href={`/set/${encodeURIComponent(entry.set.code.toLowerCase())}`}
                      className={mobile.setLink}
                    >
                      <span className={mobile.setCode}>
                        {entry.set.code.toUpperCase()}
                      </span>
                    </Link>
                  ) : null}
                  {entry.printing.collector_number && (
                    <>
                      <span className={mobile.metaDot}>·</span>
                      <span>{entry.printing.collector_number}</span>
                    </>
                  )}
                </span>
                <span className={mobile.metaLine}>
                  <RarityBadge rarity={entry.card.rarity} />
                  <span
                    style={{
                      fontFamily: 'var(--ygo-font-mono)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--ygo-text-muted)',
                    }}
                  >
                    {entry.quote.grader} · {entry.quote.grade}
                  </span>
                </span>
              </div>
              <div className={mobile.priceCol}>
                <span className={mobile.price}>
                  $
                  {entry.quote.price!.toLocaleString('en-US', {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

import Link from 'next/link';
import Image from 'next/image';
import type {
  AnalyticsResult,
  BreakdownBucket,
  GainLossHolding,
  PortfolioDepthCheck,
  TopHolding,
} from '../../lib/collection-analytics';
import type { CollectionListItem } from '../../server/collection';
import styles from './CollectionAnalytics.module.css';

// Server component (no interactivity) — pure formatting over the
// analytics result computed by lib/collection-analytics.ts.

interface Props {
  analytics: AnalyticsResult;
  depth: PortfolioDepthCheck;
}

export function CollectionAnalytics({ analytics, depth }: Props) {
  const { breakdowns, topMostValuable, topGains, topLosses, missingPrice, hasNonUsdAcquisition } =
    analytics;

  return (
    <div className={styles.wrap}>
      <div className={styles.grid2}>
        <BreakdownSection
          title="Value by set"
          caption="Grouped by the printing's set. Missing prices are excluded from the value bar and reported separately."
          buckets={breakdowns.bySet}
        />
        <BreakdownSection
          title="Value by rarity"
          caption="Grouped by card rarity. Same currency assumptions as everywhere else — USD only, never FX-converted."
          buckets={breakdowns.byRarity}
        />
      </div>

      <div className={styles.grid2}>
        <BreakdownSection
          title="Raw vs graded"
          caption="Both value and copy counts side-by-side. Graded copies are valued using the printing-graded price where available."
          buckets={breakdowns.byRawGraded}
        />
        <BreakdownSection
          title="By grader"
          caption="Only graded holdings contribute. Grader values are literal — PSA, BGS, CGC, SGC."
          buckets={breakdowns.byGrader}
          emptyLabel="No graded holdings yet."
        />
      </div>

      <div className={styles.grid2}>
        <TopValuableSection topMostValuable={topMostValuable} />
        <GainLossSection
          topGains={topGains}
          topLosses={topLosses}
          hasNonUsdAcquisition={hasNonUsdAcquisition}
        />
      </div>

      <MissingPriceSection items={missingPrice} />

      <PortfolioHistoryDecision depth={depth} />
    </div>
  );
}

function BreakdownSection({
  title,
  caption,
  buckets,
  emptyLabel,
}: {
  title: string;
  caption: string;
  buckets: BreakdownBucket[];
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.valueUsd));
  if (buckets.length === 0) {
    return (
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        <p className={styles.sectionCaption}>{caption}</p>
        <div className={styles.emptyList}>{emptyLabel ?? 'Nothing to summarise yet.'}</div>
      </div>
    );
  }
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <p className={styles.sectionCaption}>{caption}</p>
      <div className={styles.breakdown}>
        {buckets.slice(0, 10).map((b) => (
          <div key={b.key}>
            <div className={styles.barLabelRow}>
              <span className={styles.barLabel}>{b.label}</span>
              <span className={styles.barValue}>
                ${b.valueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <span className={styles.barValueLine} aria-hidden>
              <span
                className={styles.barFill}
                style={{ width: `${(b.valueUsd / max) * 100}%` }}
              />
            </span>
            <div className={styles.barMeta}>
              {b.holdings} holding{b.holdings === 1 ? '' : 's'} · {b.copies} cop
              {b.copies === 1 ? 'y' : 'ies'}
              {b.missingPriceRows > 0 && ` · ${b.missingPriceRows} without price`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopValuableSection({ topMostValuable }: { topMostValuable: TopHolding[] }) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Top 10 most valuable</h3>
      <p className={styles.sectionCaption}>
        Ranked by <em>current</em> unit price × quantity. USD only.
      </p>
      {topMostValuable.length === 0 ? (
        <div className={styles.emptyList}>No priced holdings yet.</div>
      ) : (
        <div className={styles.topList}>
          {topMostValuable.map((t, i) => (
            <TopHoldingRow
              key={t.item.row.id}
              rank={i + 1}
              item={t.item}
              amount={
                <span className={styles.topAmount}>
                  ${t.totalValueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GainLossSection({
  topGains,
  topLosses,
  hasNonUsdAcquisition,
}: {
  topGains: GainLossHolding[];
  topLosses: GainLossHolding[];
  hasNonUsdAcquisition: boolean;
}) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Unrealised gains &amp; losses</h3>
      <p className={styles.sectionCaption}>
        Only shown for USD-priced holdings where both current market price and
        acquisition cost are known.
        {hasNonUsdAcquisition && ' Non-USD purchases exist but are not compared — YGOPrices never FX-converts.'}
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <p className={styles.barMeta}>Largest unrealised gains</p>
          {topGains.length === 0 ? (
            <div className={styles.emptyList}>No comparable gains yet.</div>
          ) : (
            <div className={styles.topList}>
              {topGains.slice(0, 5).map((t, i) => (
                <TopHoldingRow
                  key={t.item.row.id}
                  rank={i + 1}
                  item={t.item}
                  amount={
                    <span className={`${styles.topAmount} ${styles.gainPositive}`}>
                      +${t.gainUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </div>
        <div>
          <p className={styles.barMeta}>Largest unrealised losses</p>
          {topLosses.length === 0 ? (
            <div className={styles.emptyList}>No comparable losses yet.</div>
          ) : (
            <div className={styles.topList}>
              {topLosses.slice(0, 5).map((t, i) => (
                <TopHoldingRow
                  key={t.item.row.id}
                  rank={i + 1}
                  item={t.item}
                  amount={
                    <span className={`${styles.topAmount} ${styles.gainNegative}`}>
                      −${Math.abs(t.gainUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MissingPriceSection({ items }: { items: CollectionListItem[] }) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        Missing-price holdings ({items.length})
      </h3>
      <p className={styles.sectionCaption}>
        These rows have no current market price to compare against. They are
        excluded from totals rather than being counted as zero.
      </p>
      {items.length === 0 ? (
        <div className={styles.emptyList}>Every holding has a current price. Nice.</div>
      ) : (
        <div className={styles.topList}>
          {items.slice(0, 20).map((it) => (
            <TopHoldingRow key={it.row.id} item={it} amount={<span className={styles.topAmount}>—</span>} />
          ))}
          {items.length > 20 && (
            <p className={styles.barMeta}>
              + {items.length - 20} more with no current market price
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TopHoldingRow({
  rank,
  item,
  amount,
}: {
  rank?: number;
  item: CollectionListItem;
  amount: React.ReactNode;
}) {
  const { card, printing, set, row } = item;
  const thumb =
    card?.images?.small ?? card?.images?.normal ?? card?.images?.large ?? null;
  const cardHref =
    card && printing && printing.tcggraph_printing_key && printing.collector_number
      ? `/card/${toSlug(card.name)}/printing/${encodeURIComponent(printing.collector_number)}/${encodeURIComponent(printing.tcggraph_printing_key)}`
      : card
      ? `/card/${toSlug(card.name)}`
      : undefined;
  const editionLabel =
    printing?.edition === '1st_edition'
      ? '1st Ed.'
      : printing?.edition === 'limited'
      ? 'Limited'
      : 'Unlimited';
  return (
    <div className={styles.topRow}>
      <span className={styles.rank}>{rank ?? ''}</span>
      {thumb ? (
        <Image src={thumb} alt="" width={44} height={62} className={styles.topThumb} unoptimized />
      ) : (
        <div className={styles.topThumb} aria-hidden />
      )}
      <div className={styles.topBody}>
        {cardHref ? (
          <Link href={cardHref} className={styles.topName}>
            {card?.name ?? '(unknown card)'}
          </Link>
        ) : (
          <span className={styles.topName}>(unknown card)</span>
        )}
        <div className={styles.topMeta}>
          {[set?.code?.toUpperCase(), printing?.collector_number, card?.rarity, editionLabel, row.is_graded ? `${row.grader?.toUpperCase()} ${row.grade}` : 'Raw']
            .filter(Boolean)
            .join(' · ')}
          {' · '}
          ×{row.quantity}
        </div>
      </div>
      {amount}
    </div>
  );
}

function PortfolioHistoryDecision({ depth }: { depth: PortfolioDepthCheck }) {
  if (depth.ok) {
    return (
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Collection value over time</h3>
        <p className={styles.sectionCaption}>
          Detected {depth.distinctDaysMax} days of usable per-printing history —
          enough to plot the portfolio trend. This section will render the chart
          in the next iteration; the analytics scaffolding is deliberately
          shipped first so we never fabricate a curve before the data supports
          one.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Collection value over time</h3>
      <div className={styles.historyNotice}>
        Collection history will appear as YGOPrices accumulates market
        observations. A portfolio chart needs at least {depth.requiredDays} distinct
        days of per-holding history in the same currency as the current
        valuation, plus matching (grader, grade) history for graded rows.
        Current depth: {depth.distinctDaysMax} day{depth.distinctDaysMax === 1 ? '' : 's'}.
        We show this note rather than a made-up chart because a fabricated
        portfolio curve would be worse than no chart at all.
      </div>
    </div>
  );
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

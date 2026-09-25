import type { Metadata } from 'next';
import Link from 'next/link';
import { AttributeChip } from '../../components/AttributeIcon';
import { CardClassBadge } from '../../components/CardClassBadge';
import { FnlBadge } from '../../components/FnlBadge';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { RarityBadge } from '../../components/RarityBadge';
import { Surface } from '../../components/Surface';
import { siteUrl } from '../../lib/site-url';
import { toCardSlug } from '../../lib/slug';
import { CardMiniThumb } from '../../components/card-visual/CardMiniThumb';
import type { FnlPageData, FnlSectionData } from '../../server/fnl';
import { getYugiohForbiddenLimited } from '../../server/fnl';
import { safe } from '../../server/safe';
import styles from '../../components/browse/Browse.module.css';
import mobile from '../../components/market/MarketRankingRow.module.css';

export const revalidate = 3600;

const SITE_URL = siteUrl();

export const metadata: Metadata = {
  title: 'Yu-Gi-Oh! Forbidden & Limited list - TCG + OCG restricted cards',
  description:
    'Every Yu-Gi-Oh! card currently marked Forbidden, Limited, or Semi-Limited in production catalogue metadata. TCG list rendered in full; OCG counts shown alongside. Cards link to full print histories and market values.',
  alternates: { canonical: `${SITE_URL}/forbidden-limited` },
  openGraph: {
    title: 'Yu-Gi-Oh! Forbidden & Limited - TCG + OCG',
    description:
      'Restricted Yu-Gi-Oh! cards per current catalogue metadata. TCG and OCG lists.',
    url: `${SITE_URL}/forbidden-limited`,
    type: 'article',
  },
};

const SECTION_META: Record<'forbidden' | 'limited' | 'semi_limited', {
  title: string;
  copy: string;
  fnlState: 'forbidden' | 'limited' | 'semi-limited';
}> = {
  forbidden: {
    title: 'Forbidden',
    copy: 'Cannot be included in the Main, Extra, or Side Deck.',
    fnlState: 'forbidden',
  },
  limited: {
    title: 'Limited',
    copy: 'Only one copy allowed across Main, Extra, and Side Deck combined.',
    fnlState: 'limited',
  },
  semi_limited: {
    title: 'Semi-Limited',
    copy: 'Up to two copies allowed across Main, Extra, and Side Deck combined.',
    fnlState: 'semi-limited',
  },
};

const EMPTY_SECTION: FnlSectionData = {
  state: 'forbidden',
  tcgCount: 0,
  ocgCount: 0,
  cards: [],
};

// F&L identity fetch uses a JSON-path filter that occasionally hits
// Supabase's statement_timeout under load. Wrap in safe() so the page
// renders a degraded panel instead of a 500 — the identity is what
// this page is about, so we surface a clear "temporarily unavailable"
// message rather than pretending we know nothing is restricted.
async function loadFnlDataFailSoft(): Promise<FnlPageData & { identityDegraded: boolean }> {
  const result = await safe('fnl-identity', () => getYugiohForbiddenLimited(), {
    timeoutMs: 25_000,
  });
  if (result.ok) {
    return { ...result.value, identityDegraded: false };
  }
  return {
    tcg: {
      forbidden: { ...EMPTY_SECTION, state: 'forbidden' },
      limited: { ...EMPTY_SECTION, state: 'limited' },
      semi_limited: { ...EMPTY_SECTION, state: 'semi_limited' },
    },
    ocgCounts: { forbidden: 0, limited: 0, semi_limited: 0, unlimited: 0 },
    fetchedAt: new Date().toISOString(),
    totalCardsScanned: 0,
    pricingDegraded: true,
    identityDegraded: true,
  };
}

export default async function ForbiddenLimitedPage() {
  const data = await loadFnlDataFailSoft();

  const totalTcg =
    data.tcg.forbidden.cards.length +
    data.tcg.limited.cards.length +
    data.tcg.semi_limited.cards.length;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Forbidden & Limited',
            item: `${SITE_URL}/forbidden-limited`,
          },
        ],
      },
      {
        '@type': 'CollectionPage',
        name: 'Yu-Gi-Oh! Forbidden & Limited list',
        url: `${SITE_URL}/forbidden-limited`,
        numberOfItems: totalTcg,
      },
    ],
  };

  return (
    <>
      <Header compactSearch />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.crumbs}>
            <Link href="/">Home</Link>
            <span className={styles.crumbSep}>·</span>
            <span>Forbidden &amp; Limited</span>
          </p>
          <h1 className={styles.title}>Forbidden &amp; Limited list</h1>
          <p className={styles.subtitle}>
            Every unique Yu-Gi-Oh! card whose current banlist metadata marks it
            Forbidden, Limited, or Semi-Limited. TCG list rendered in full
            below; equivalent OCG counts are shown alongside each section for
            comparison.
          </p>
          <div className={styles.identityGrid}>
            <span className={styles.metaValue}>
              TCG {totalTcg.toLocaleString('en-US')} unique cards
            </span>
            <span className={styles.metaValue}>
              OCG{' '}
              {(data.ocgCounts.forbidden +
                data.ocgCounts.limited +
                data.ocgCounts.semi_limited).toLocaleString('en-US')}{' '}
              variants
            </span>
          </div>
          <div className={styles.notice} style={{ marginTop: 16 }}>
            <strong>Data freshness caveat.</strong> Banlist state is
            snapshotted whenever the underlying data source is refreshed - this
            is not a live ingest of Konami&apos;s announcements. Use this page
            for browsing collector-relevant restricted cards, not for
            tournament-legality on the day of a new banlist announcement.
            Card counts reflect the catalogue&apos;s current state; multiple
            printings of the same card collapse to a single row.
          </div>
          {data.identityDegraded ? (
            <div className={styles.notice}>
              The Forbidden &amp; Limited list is temporarily unavailable -
              the identity query timed out against our data source. Refresh in
              a moment; the page auto-recovers as soon as the source responds.
            </div>
          ) : data.pricingDegraded ? (
            <div className={styles.notice}>
              Pricing lookups for this page are temporarily degraded - cards
              still render but USD prices may be missing. Retry in a moment.
            </div>
          ) : null}
        </header>

        <FnlSection
          section={data.tcg.forbidden}
          ocgCount={data.ocgCounts.forbidden}
          kind="forbidden"
        />
        <FnlSection
          section={data.tcg.limited}
          ocgCount={data.ocgCounts.limited}
          kind="limited"
        />
        <FnlSection
          section={data.tcg.semi_limited}
          ocgCount={data.ocgCounts.semi_limited}
          kind="semi_limited"
        />

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>OCG snapshot</h2>
            <p className={styles.sectionCaption}>
              Counts only - OCG full listing lives on the OCG-specific browse
              once we split game-scoped views. TCG differs from OCG in every
              cycle; the numbers below are for quick comparison.
            </p>
          </header>
          <div className={styles.breakdownGrid}>
            <Surface variant="card" className={styles.breakdownCell}>
              <span className={styles.breakdownLabel}>OCG Forbidden</span>
              <div className={styles.breakdownRow}>
                <FnlBadge state="forbidden" />
                <span className={styles.breakdownCount}>
                  {data.ocgCounts.forbidden.toLocaleString('en-US')}
                </span>
              </div>
            </Surface>
            <Surface variant="card" className={styles.breakdownCell}>
              <span className={styles.breakdownLabel}>OCG Limited</span>
              <div className={styles.breakdownRow}>
                <FnlBadge state="limited" />
                <span className={styles.breakdownCount}>
                  {data.ocgCounts.limited.toLocaleString('en-US')}
                </span>
              </div>
            </Surface>
            <Surface variant="card" className={styles.breakdownCell}>
              <span className={styles.breakdownLabel}>OCG Semi-Limited</span>
              <div className={styles.breakdownRow}>
                <FnlBadge state="semi-limited" />
                <span className={styles.breakdownCount}>
                  {data.ocgCounts.semi_limited.toLocaleString('en-US')}
                </span>
              </div>
            </Surface>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function FnlSection({
  section,
  ocgCount,
  kind,
}: {
  section: FnlSectionData;
  ocgCount: number;
  kind: 'forbidden' | 'limited' | 'semi_limited';
}) {
  const meta = SECTION_META[kind];
  const anchor = kind === 'semi_limited' ? 'semi-limited' : kind;
  return (
    <section className={styles.section} id={anchor}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>
            <FnlBadge state={meta.fnlState} />{' '}
            <span style={{ marginLeft: 8 }}>
              {meta.title} ({section.cards.length.toLocaleString('en-US')} cards)
            </span>
          </h2>
          <p className={styles.sectionCaption}>{meta.copy}</p>
        </div>
        <span className={styles.metaValue}>
          OCG {ocgCount.toLocaleString('en-US')}
        </span>
      </header>
      {section.cards.length === 0 ? (
        <div className={styles.notice}>No cards in this section.</div>
      ) : (
        <>
        {/* Desktop / tablet: existing full table, wrapped in a
            component-local scroll container so any residual overflow
            (7 columns is tight around 800-900 px) stays inside the
            component and never propagates to document-level. */}
        <div className={mobile.tableScroll}>
        <table className={`${styles.cardsTable} ${mobile.desktopTable}`}>
          <thead>
            <tr>
              <th>Card</th>
              <th>Type</th>
              <th>Attribute</th>
              <th>Set (first printing shown)</th>
              <th>Rarity</th>
              <th style={{ textAlign: 'right' }}>USD (best)</th>
            </tr>
          </thead>
          <tbody>
            {section.cards.map((entry) => (
              <tr key={entry.card.id}>
                <td>
                  <div className={styles.thumbCell}>
                    <Link
                      href={`/card/${toCardSlug(entry.card.name)}`}
                      aria-label={entry.card.name}
                    >
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
                      <Link
                        href={`/card/${toCardSlug(entry.card.name)}`}
                        className={styles.cardLink}
                      >
                        {entry.card.name}
                      </Link>
                      {entry.archetypes.length > 0 && (
                        <span
                          style={{
                            fontFamily: 'var(--ygo-font-body)',
                            fontSize: 11,
                            color: 'var(--ygo-text-quiet)',
                          }}
                        >
                          {entry.archetypes.slice(0, 2).join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  {entry.frameType ? (
                    <CardClassBadge cardClass={entry.frameType} />
                  ) : (
                    <span className={styles.dim}>-</span>
                  )}
                </td>
                <td>
                  {entry.attribute ? (
                    <AttributeChip attribute={entry.attribute} />
                  ) : (
                    <span className={styles.dim}>-</span>
                  )}
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
                <td style={{ textAlign: 'right' }}>
                  {entry.bestUsdRetail?.price != null ? (
                    <span className={styles.priceNum}>
                      $
                      {entry.bestUsdRetail.price.toLocaleString('en-US', {
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  ) : (
                    <span className={styles.dim}>-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {/* Mobile stacked list - reuses the market-ranking row layout
            (thumb + name + meta + price). Restriction status carried
            by the section badge above (Forbidden / Limited / Semi-
            Limited); no need to repeat it per-row. */}
        <ol className={mobile.list} aria-label={`${meta.title} cards`}>
          {section.cards.map((entry) => {
            const href = `/card/${toCardSlug(entry.card.name)}`;
            return (
              <li key={entry.card.id} className={mobile.item}>
                {/* Rank slot omitted - F&L rows are alphabetical, not
                    ranked. Empty span preserves grid columns. */}
                <span />
                <Link href={href} className={mobile.thumb} aria-label={entry.card.name}>
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
                  <Link href={href} className={mobile.name}>
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
                    {entry.card.collector_number && (
                      <>
                        <span className={mobile.metaDot}>·</span>
                        <span>{entry.card.collector_number}</span>
                      </>
                    )}
                  </span>
                  <span className={mobile.metaLine}>
                    <RarityBadge rarity={entry.card.rarity} />
                    {entry.frameType && (
                      <CardClassBadge cardClass={entry.frameType} />
                    )}
                    {entry.attribute && (
                      <AttributeChip attribute={entry.attribute} />
                    )}
                  </span>
                </div>
                <div className={mobile.priceCol}>
                  {entry.bestUsdRetail?.price != null ? (
                    <span className={mobile.price}>
                      $
                      {entry.bestUsdRetail.price.toLocaleString('en-US', {
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  ) : (
                    <span className={styles.dim}>-</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        </>
      )}
    </section>
  );
}

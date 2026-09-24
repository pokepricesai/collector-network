import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttributeChip } from '../../../../../../components/AttributeIcon';
import { CardClassBadge } from '../../../../../../components/CardClassBadge';
import { CardImageFrame } from '../../../../../../components/CardImageFrame';
import { EditionBadge } from '../../../../../../components/EditionBadge';
import { FnlBadge } from '../../../../../../components/FnlBadge';
import { Footer } from '../../../../../../components/Footer';
import { Header } from '../../../../../../components/Header';
import { PrintingFingerprint } from '../../../../../../components/PrintingFingerprint';
import { RarityBadge } from '../../../../../../components/RarityBadge';
import { Stat, StatRow } from '../../../../../../components/Stat';
import { Surface } from '../../../../../../components/Surface';
import { GradedStrip } from '../../../../../../components/card/GradedStrip';
import { VariantsTable } from '../../../../../../components/card/VariantsTable';
import { RarityRefractorLine } from '../../../../../../components/signature/RarityRefractorLine';
import { PriceHistoryChart } from '../../../../../../components/chart/PriceHistoryChart';
import {
  getYugiohPhysicalPrintingByRoute,
  type PhysicalPrintingData,
} from '../../../../../../server/card';
import {
  getYugiohCardScopedPriceHistory,
  getYugiohPrintingPriceHistory,
} from '../../../../../../server/history';
import { safe } from '../../../../../../server/safe';
import { normaliseFnl } from '../../../../../../lib/fnl';
import { normaliseRarity } from '../../../../../../lib/rarity';
import { siteUrl } from '../../../../../../lib/site-url';
import { toCardSlug } from '../../../../../../lib/slug';
import styles from '../../../../../../components/card/CardIdentity.module.css';

// /card/[slug]/printing/[collectorNumber]/[printingKey]
// Physical printing page. Retail + attribution='printing' graded live
// underneath the exact-printing heading. Card-scoped graded lives in
// its own labelled panel with an explicit caveat.

interface Params {
  slug: string;
  collectorNumber: string;
  printingKey: string;
}

interface Props {
  params: Promise<Params>;
}

export const revalidate = 1800;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, collectorNumber, printingKey } = await params;
  const data = await getYugiohPhysicalPrintingByRoute(
    slug,
    collectorNumber,
    printingKey,
  );
  if (!data) {
    return {
      title: 'Printing not found — YGOPrices',
      robots: { index: false, follow: true },
    };
  }
  const canonical = `${siteUrl()}/card/${data.logicalSlug}/printing/${encodeURIComponent(
    data.printing.collector_number ?? '',
  )}/${encodeURIComponent(data.printingKey)}`;
  const editionLabel =
    data.edition === '1st_edition'
      ? '1st Edition'
      : data.edition === 'limited'
      ? 'Limited Edition'
      : 'Unlimited / Unspecified';
  const description = `${data.card.name} — ${data.set?.name ?? data.card.set_id} ${data.printing.collector_number ?? ''} ${data.card.rarity ?? ''} ${editionLabel}. Live retail and graded market values.`;
  return {
    title: `${data.card.name} · ${data.printing.collector_number ?? ''} ${editionLabel}`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${data.card.name} — ${data.printing.collector_number ?? ''}`,
      description,
      url: canonical,
      type: 'article',
      images: data.card.images?.large
        ? [{ url: data.card.images.large }]
        : data.card.images?.normal
        ? [{ url: data.card.images.normal }]
        : undefined,
    },
  };
}

export default async function PrintingPage({ params }: Props) {
  const { slug, collectorNumber, printingKey } = await params;
  const data = await getYugiohPhysicalPrintingByRoute(
    slug,
    collectorNumber,
    printingKey,
  );
  if (!data) notFound();

  const jsonLd = buildPrintingJsonLd(data, siteUrl());

  const banlist = data.gamedata.banlist?.tcg;
  const fnlState = normaliseFnl(banlist);
  const gd = data.gamedata;
  const isMonster =
    gd.frameType !== 'spell' && gd.frameType !== 'trap' && gd.attribute != null;

  // Deduplicated: printing-scoped graded + retail live here. Card-
  // scoped data goes into its own labelled panel.
  const hasPrintingGraded = data.pricing.graded.length > 0;
  const hasCardScopedGraded = data.cardScopedPricing.graded.length > 0;

  // Slice A: fetch daily price history in parallel with the initial
  // page render. Both wrapped in safe() so a slow daily-table read
  // never keeps the page from rendering; the chart section shows a
  // "history temporarily unavailable" state instead.
  const [printingHistoryResult, cardScopedHistoryResult] = await Promise.all([
    safe('history-printing', () => getYugiohPrintingPriceHistory(data.printing.id)),
    hasCardScopedGraded
      ? safe('history-card-scoped', () =>
          getYugiohCardScopedPriceHistory(data.card.id),
        )
      : Promise.resolve({ ok: true as const, value: null, error: null }),
  ]);
  const printingHistory = printingHistoryResult.ok ? printingHistoryResult.value : null;
  const cardScopedHistory =
    cardScopedHistoryResult.ok && cardScopedHistoryResult.value
      ? cardScopedHistoryResult.value
      : null;

  return (
    <>
      <Header compactSearch />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px 64px' }}>
        <section className={styles.wrap}>
          <div className={styles.imageCol}>
            <CardImageFrame
              src={data.card.images?.large ?? data.card.images?.normal ?? null}
              alt={data.card.name}
              rarity={data.card.rarity}
              maxWidth={280}
            />
          </div>

          <div className={styles.header}>
            <p className={styles.eyebrow}>
              <Link href="/" className={styles.crumb}>
                YGOPrices
              </Link>{' '}
              <span className={styles.dot}>·</span>{' '}
              {data.set && (
                <>
                  <Link
                    href={`/set/${encodeURIComponent(data.set.code.toLowerCase())}`}
                    className={styles.crumb}
                  >
                    {data.set.name}
                  </Link>{' '}
                  <span className={styles.dot}>·</span>{' '}
                </>
              )}
              <Link href={`/card/${data.logicalSlug}`} className={styles.crumb}>
                {data.card.name}
              </Link>{' '}
              <span className={styles.dot}>·</span>{' '}
              <span>{data.printing.collector_number}</span>
            </p>
            <h1 className={styles.title}>{data.card.name}</h1>
            <RarityRefractorLine rarity={data.card.rarity} />
            <div>
              <PrintingFingerprint
                collectorNumber={data.printing.collector_number}
                rarity={data.card.rarity}
                edition={data.printing.edition}
                language={data.printing.language}
              />
            </div>
            <p className={styles.typeLine}>
              {gd.attribute && <AttributeChip attribute={gd.attribute} />}
              {gd.frameType && (
                <CardClassBadge
                  cardClass={
                    gd.frameType === 'normal'
                      ? 'normal'
                      : gd.frameType === 'effect'
                      ? 'effect'
                      : gd.frameType === 'fusion'
                      ? 'fusion'
                      : gd.frameType === 'synchro'
                      ? 'synchro'
                      : gd.frameType === 'xyz'
                      ? 'xyz'
                      : gd.frameType === 'pendulum'
                      ? 'pendulum'
                      : gd.frameType === 'link'
                      ? 'link'
                      : gd.frameType === 'ritual'
                      ? 'ritual'
                      : gd.frameType === 'spell'
                      ? 'spell'
                      : gd.frameType === 'trap'
                      ? 'trap'
                      : 'unknown'
                  }
                />
              )}
              {gd.race && <span>{gd.race}</span>}
              <span className={styles.dot}>·</span>
              <Link
                href={`/rarity/${normaliseRarity(data.card.rarity)}`}
                style={{ textDecoration: 'none' }}
              >
                <RarityBadge rarity={data.card.rarity} />
              </Link>
              <EditionBadge edition={data.printing.edition} />
              {data.printing.finish && (
                <span className={styles.dim}>{data.printing.finish}</span>
              )}
              {banlist && (
                <>
                  <span className={styles.dot}>·</span>
                  <FnlBadge state={fnlState} />
                </>
              )}
            </p>

            {gd.archetypes.length > 0 && (
              <p className={styles.typeLine}>
                <span
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--ygo-text-quiet)',
                  }}
                >
                  Archetype
                </span>
                {gd.archetypes.map((a) => (
                  <Link
                    key={a}
                    href={`/archetype/${toCardSlug(a)}`}
                    style={{
                      color: 'var(--ygo-accent-gold-strong)',
                      textDecoration: 'underline',
                      textUnderlineOffset: 3,
                    }}
                  >
                    {a}
                  </Link>
                ))}
              </p>
            )}

            {data.pricingDegraded && (
              <div className={styles.cardScopedNote}>
                Pricing is temporarily unavailable for this printing — retry
                in a moment. Card metadata is still displayed.
              </div>
            )}

            {isMonster && (
              <div className={styles.stats}>
                <StatRow>
                  <Stat label="ATK" value={gd.atk ?? '—'} kind="atk" size="lg" />
                  <Stat label="DEF" value={gd.def ?? '—'} kind="def" size="lg" />
                  {gd.linkRating != null ? (
                    <Stat label="Link" value={gd.linkRating} kind="link" />
                  ) : gd.level != null ? (
                    <Stat label="Level" value={gd.level} kind="level" />
                  ) : null}
                  {gd.pendulumScale != null && (
                    <Stat label="Pendulum" value={gd.pendulumScale} kind="pendulum" />
                  )}
                </StatRow>
              </div>
            )}

            {data.card.rules_text && (
              <p className={styles.rulesText}>{data.card.rules_text}</p>
            )}
          </div>
        </section>

        {/* Retail — exact printing */}
        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Retail — this exact printing
            </h2>
            <p className={styles.sectionCaption}>
              Live marketplace listings tied to <code>{data.printing.id}</code>. Currency shown as-is.
            </p>
          </header>
          {data.pricing.market.length === 0 ? (
            <div className={styles.emptyState}>
              No live retail listings for this printing right now.
            </div>
          ) : (
            <Surface variant="market" style={{ padding: 0 }}>
              {data.pricing.market.map((m, i) => (
                <div key={i} className={styles.marketRow}>
                  <span className={styles.marketSource}>
                    {m.source.split('.').pop() ?? m.source}
                  </span>
                  <span className={styles.dim} style={{ fontSize: 11 }}>
                    {m.region ?? ''}
                    {m.finish ? ` · ${m.finish}` : ''}
                    {m.listType ? ` · ${m.listType}` : ''}
                  </span>
                  <span className={styles.marketPrice}>
                    {m.currency === 'USD' ? '$' : m.currency === 'EUR' ? '€' : ''}
                    {m.price?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    <span className={styles.priceCurrency}>{m.currency}</span>
                  </span>
                </div>
              ))}
            </Surface>
          )}
        </section>

        {/* Slice A: price history for this exact printing. Retail
            series (always printing-scoped by nature) plus any
            attribution='printing' graded series. Card-scoped graded
            history lives in its own labelled panel below. */}
        {printingHistory && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Price history</h2>
              <p className={styles.sectionCaption}>
                Daily snapshots of retail plus any printing-scoped
                graded prices for this exact printing. Currency is never
                converted; each series preserves its source currency.
              </p>
            </header>
            <PriceHistoryChart
              title="Retail + printing-scoped graded"
              subtitle={
                printingHistory.gradedPrinting.length > 0
                  ? 'Both retail and graded series describe this exact printing.'
                  : 'Only retail history has printing-scoped observations for this printing.'
              }
              series={[
                ...printingHistory.retail.map((s, i) => ({
                  key: `retail:${s.key}`,
                  label: s.label,
                  currency: s.currency,
                  points: s.points,
                  colour: i === 0 ? '#e8c069' : undefined,
                })),
                ...printingHistory.gradedPrinting.map((s) => ({
                  key: `graded:${s.key}`,
                  label: s.label,
                  currency: s.currency,
                  points: s.points,
                })),
              ]}
              daysCovered={printingHistory.daysCovered}
              footerNote={
                printingHistory.firstObservation
                  ? `Available: ${printingHistory.firstObservation} to ${printingHistory.lastObservation}.`
                  : undefined
              }
            />
          </section>
        )}

        {/* Graded — exact printing (attribution='printing' only) */}
        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Graded — this exact printing
            </h2>
            <p className={styles.sectionCaption}>
              PSA / BGS / CGC / SGC / market-aggregate quotes provided
              specifically for this printing / edition / language. Raw
              observations are shown separately below.
            </p>
          </header>
          {hasPrintingGraded ? (
            <GradedStrip
              quotes={data.pricing.graded}
              emptyLabel="No printing-scoped graded quotes for this printing right now."
            />
          ) : (
            <div className={styles.emptyState}>
              No graded pricing yet identifies this exact printing.
              {hasCardScopedGraded &&
                ' Card-family-scoped graded data appears below in its own panel.'}
            </div>
          )}
          {data.pricing.raw.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p className={styles.priceLabel}>Raw sales observations · this printing</p>
              <Surface variant="raised" style={{ padding: 0, marginTop: 8 }}>
                {data.pricing.raw.map((q, i) => (
                  <div key={i} className={styles.marketRow}>
                    <span className={styles.marketSource}>raw · {q.grade}</span>
                    <span className={styles.dim} style={{ fontSize: 11 }}>
                      vol {q.cardSalesVolume ?? '—'}
                    </span>
                    <span className={styles.marketPrice}>
                      {q.currency === 'USD' ? '$' : ''}
                      {q.price?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      <span className={styles.priceCurrency}>{q.currency}</span>
                    </span>
                  </div>
                ))}
              </Surface>
            </div>
          )}
        </section>

        {/* Card-scoped graded panel — labelled and separated */}
        {hasCardScopedGraded && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                Graded market · card family · edition / variant unspecified
              </h2>
            </header>
            <div className={styles.cardScopedNote}>
              These graded observations apply to the wider{' '}
              <strong>{data.card.name}</strong> — {data.printing.collector_number}{' '}
              {data.card.rarity ?? ''} card family. The source data does
              not identify which physical edition, finish or language
              the graded slabs came from, so we do NOT attribute them
              to <em>this</em> exact printing. They are shown here for
              collector context only.
            </div>
            <GradedStrip
              quotes={data.cardScopedPricing.graded}
              emptyLabel="No card-scoped graded quotes right now."
            />
            {cardScopedHistory && cardScopedHistory.gradedCard.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <PriceHistoryChart
                  title="Graded history · card family"
                  subtitle="Card-scoped attribution — not tied to this exact printing."
                  series={cardScopedHistory.gradedCard.map((s) => ({
                    key: `card:${s.key}`,
                    label: s.label,
                    currency: s.currency,
                    points: s.points,
                  }))}
                  daysCovered={cardScopedHistory.daysCovered}
                  footerNote={
                    cardScopedHistory.firstObservation
                      ? `Available: ${cardScopedHistory.firstObservation} to ${cardScopedHistory.lastObservation}.`
                      : undefined
                  }
                />
              </div>
            )}
          </section>
        )}

        {/* Other printings */}
        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Other printings of {data.card.name} ({data.siblingVariants.length})
            </h2>
          </header>
          <VariantsTable
            variants={[...data.siblingVariants, buildActiveVariant(data)]}
            cardSlug={data.logicalSlug}
            highlightPrintingId={data.printing.id}
          />
        </section>
      </main>
      <Footer />
    </>
  );
}

// Build a variant row for the currently-viewed printing so the table
// includes it (highlighted, non-linked).
function buildActiveVariant(data: PhysicalPrintingData) {
  return {
    printing: data.printing,
    card: data.card,
    set: data.set,
    edition: data.edition,
    printingKey: data.printingKey,
    bestUsdRetail:
      data.pricing.market.find((q) => q.currency === 'USD' && q.price != null) ??
      null,
    bestEurRetail:
      data.pricing.market.find((q) => q.currency === 'EUR' && q.price != null) ??
      null,
    printingScopedGraded: data.pricing.graded,
    printingScopedRaw: data.pricing.raw,
    marketQuotes: data.pricing.market,
  };
}

function buildPrintingJsonLd(data: PhysicalPrintingData, siteUrl: string) {
  const url = `${siteUrl}/card/${data.logicalSlug}/printing/${encodeURIComponent(
    data.printing.collector_number ?? '',
  )}/${encodeURIComponent(data.printingKey)}`;
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      {
        '@type': 'ListItem',
        position: 2,
        name: data.card.name,
        item: `${siteUrl}/card/${data.logicalSlug}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: `${data.printing.collector_number} ${
          data.edition === '1st_edition' ? '1st Edition' : ''
        }`.trim(),
        item: url,
      },
    ],
  };
  const usdRetail = data.pricing.market.find(
    (q) => q.currency === 'USD' && q.price != null,
  );
  const eurRetail = data.pricing.market.find(
    (q) => q.currency === 'EUR' && q.price != null,
  );
  const offers = [usdRetail, eurRetail]
    .filter((q): q is NonNullable<typeof q> => q != null)
    .map((q) => ({
      '@type': 'Offer',
      priceCurrency: q.currency,
      price: q.price,
      availability: 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: q.source.split('.').pop() },
    }));
  const product = {
    '@type': 'Product',
    name: `${data.card.name} — ${data.printing.collector_number ?? ''}`,
    description: data.card.rules_text ?? undefined,
    image:
      data.card.images?.large ??
      data.card.images?.normal ??
      data.card.images?.small ??
      undefined,
    url,
    sku: data.printing.id,
    offers:
      offers.length === 1
        ? offers[0]
        : offers.length > 1
        ? {
            '@type': 'AggregateOffer',
            offerCount: offers.length,
            priceCurrency: offers[0]?.priceCurrency,
            lowPrice: Math.min(
              ...offers.map((o) => o.price ?? Infinity).filter((n) => Number.isFinite(n)),
            ),
            highPrice: Math.max(
              ...offers.map((o) => o.price ?? 0),
            ),
          }
        : undefined,
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [breadcrumb, product],
  };
}

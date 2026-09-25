import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttributeChip } from '../../../components/AttributeIcon';
import { CardClassBadge } from '../../../components/CardClassBadge';
import { CardImageFrame } from '../../../components/CardImageFrame';
import { FnlBadge } from '../../../components/FnlBadge';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { RarityBadge } from '../../../components/RarityBadge';
import { Stat, StatRow } from '../../../components/Stat';
import { Surface } from '../../../components/Surface';
import { AddToCollectionMount } from '../../../components/collection/AddToCollectionMount';
import type { PrintingOption } from '../../../components/collection/AddToCollection';
import { GradedStrip } from '../../../components/card/GradedStrip';
import { VariantsTable } from '../../../components/card/VariantsTable';
import { RarityRefractorLine } from '../../../components/signature/RarityRefractorLine';
import { PriceHistoryChart } from '../../../components/chart/PriceHistoryChart';
import { getYugiohLogicalCardBySlug, type LogicalCardData } from '../../../server/card';
import { getYugiohCardScopedPriceHistory } from '../../../server/history';
import { safe } from '../../../server/safe';
import { normaliseFnl } from '../../../lib/fnl';
import { normaliseRarity } from '../../../lib/rarity';
import { siteUrl } from '../../../lib/site-url';
import { toCardSlug } from '../../../lib/slug';
import styles from '../../../components/card/CardIdentity.module.css';

// /card/[slug] — the logical card page. Aggregates all tcg_cards rows
// that share the slug's name. Card-scoped graded pricing is displayed
// in its own labelled panel — NEVER attributed to a specific printing.

interface Params {
  slug: string;
}

interface Props {
  params: Promise<Params>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getYugiohLogicalCardBySlug(slug);
  if (!data) {
    return {
      title: 'Card not found — YGOPrices',
      robots: { index: false, follow: true },
    };
  }
  const canonical = `${siteUrl()}/card/${data.slug}`;
  const rarityBits =
    data.rarityRange.length > 0 ? ` · ${data.rarityRange.slice(0, 3).join(', ')}` : '';
  const description = `${data.name} — every printing, rarity and edition. Raw retail plus graded market values on the Yu-Gi-Oh! collector catalogue.${rarityBits}`;
  return {
    title: `${data.name} — printings, prices, graded values`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${data.name} — YGOPrices`,
      description,
      url: canonical,
      type: 'article',
      images: data.representativeImage ? [{ url: data.representativeImage }] : undefined,
    },
  };
}

// Card pages are ISR'd on request. Popular families (BEWD, DM etc)
// will bake at build eventually; for now revalidate every 30 min.
export const revalidate = 1800;

export default async function LogicalCardPage({ params }: Props) {
  const { slug } = await params;
  const data = await getYugiohLogicalCardBySlug(slug);
  if (!data) notFound();

  const jsonLd = buildCardJsonLd(data, siteUrl());

  const printingOptions: PrintingOption[] = data.variants.map((v) => ({
    id: v.printing.id,
    label: [
      v.printing.collector_number,
      v.card.rarity,
      v.edition === '1st_edition'
        ? '1st Edition'
        : v.edition === 'limited'
        ? 'Limited'
        : 'Unlimited',
      v.printing.language,
    ]
      .filter(Boolean)
      .join(' · '),
  }));

  const banlist = data.gamedata.banlist?.tcg;
  const fnlState = normaliseFnl(banlist);
  const gd = data.gamedata;
  const isMonster =
    gd.frameType !== 'spell' && gd.frameType !== 'trap' && gd.attribute != null;

  return (
    <>
      <Header compactSearch />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main
        style={{
          maxWidth: 1280,
          margin: '0 auto',
          padding: '32px 24px 64px',
        }}
      >
        <section className={styles.wrap}>
          <div className={styles.imageCol}>
            <CardImageFrame
              src={data.representativeImage}
              alt={data.name}
              rarity={data.rarityRange[0]}
              maxWidth={280}
            />
          </div>

          <div className={styles.header}>
            <p className={styles.eyebrow}>
              <Link href="/" className={styles.crumb}>
                YGOPrices
              </Link>{' '}
              <span className={styles.dot}>·</span>{' '}
              <span className={styles.crumb}>Cards</span>{' '}
              <span className={styles.dot}>·</span>{' '}
              <span>{data.name}</span>
            </p>
            <h1 className={styles.title}>{data.name}</h1>
            <RarityRefractorLine rarity={data.rarityRange[0]} />
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
              {banlist && (
                <>
                  <span className={styles.dot}>·</span>
                  <FnlBadge state={fnlState} />
                </>
              )}
            </p>

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

            <div className={styles.badges}>
              {data.rarityRange.slice(0, 6).map((r) => {
                const family = normaliseRarity(r);
                return (
                  <Link
                    key={r}
                    href={`/rarity/${family}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <RarityBadge rarity={r} />
                  </Link>
                );
              })}
              {data.rarityRange.length > 6 && (
                <span className={styles.dim}>+{data.rarityRange.length - 6} more</span>
              )}
            </div>

            {data.rulesText && (
              <p className={styles.rulesText}>{data.rulesText}</p>
            )}

            {gd.archetypes.length > 0 && (
              <div className={styles.gameGrid}>
                <span className={styles.gameLabel}>Archetype</span>
                <span className={styles.gameValue}>
                  {gd.archetypes.map((a) => (
                    <Link
                      key={a}
                      href={`/archetype/${toCardSlug(a)}`}
                      className={styles.crumb}
                      style={{
                        color: 'var(--ygo-accent-gold-strong)',
                        textDecoration: 'underline',
                        textUnderlineOffset: 3,
                      }}
                    >
                      {a}
                    </Link>
                  ))}
                </span>
              </div>
            )}

            {data.pricingDegraded && (
              <div className={styles.cardScopedNote}>
                Pricing is temporarily unavailable for parts of this card —
                retry in a moment. Card metadata is still displayed.
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <AddToCollectionMount
                currentPathname={`/card/${data.slug}`}
                cardId={data.variants[0]?.card.id ?? data.slug}
                cardName={data.name}
                availablePrintings={printingOptions}
              />
            </div>
          </div>
        </section>

        {/* Pricing summary — card level */}
        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Retail market · this card family</h2>
            <p className={styles.sectionCaption}>
              Range across every indexed printing. Currency is never converted.
            </p>
          </header>
          <div className={styles.pricingGrid}>
            <Surface variant="market" className={styles.priceCell}>
              <span className={styles.priceLabel}>USD retail range</span>
              <div>
                {data.usdPriceLow != null && data.usdPriceHigh != null ? (
                  <>
                    <span className={styles.priceValue}>
                      ${data.usdPriceLow.toLocaleString('en-US', {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                    {data.usdPriceHigh > data.usdPriceLow && (
                      <>
                        <span className={styles.priceCurrency}>to</span>
                        <span className={styles.priceValue}>
                          ${data.usdPriceHigh.toLocaleString('en-US', {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </>
                    )}
                    <span className={styles.priceCurrency}>USD</span>
                  </>
                ) : (
                  <span className={styles.dim}>no live USD retail</span>
                )}
              </div>
              <p className={styles.priceMeta}>
                {data.variants.length} printings · {data.rarityRange.length} rarities
              </p>
            </Surface>
            <Surface variant="market" className={styles.priceCell}>
              <span className={styles.priceLabel}>Editions in this family</span>
              <div className={styles.badges}>
                {data.editionRange.map((e) => (
                  <span key={e}>
                    <EditionBadgeLabel edition={e} />
                  </span>
                ))}
              </div>
              <p className={styles.priceMeta}>
                Select a specific printing below for per-printing pricing.
              </p>
            </Surface>
          </div>
        </section>

        {/* Card-scoped graded market — ALWAYS in its own labelled panel */}
        <CardScopedGradedSection data={data} />

        {/* All printings */}
        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              All printings ({data.variants.length})
            </h2>
            <p className={styles.sectionCaption}>
              Every distinct set × rarity × edition combination. Click a set
              to open that printing&rsquo;s page with its own pricing.
            </p>
          </header>
          <VariantsTable variants={data.variants} cardSlug={data.slug} />
        </section>
      </main>
      <Footer />
    </>
  );
}

async function CardScopedGradedSection({ data }: { data: LogicalCardData }) {
  const totalCardScopedQuotes = data.cardScopedPricing.reduce(
    (n, cs) => n + cs.graded.length + cs.raw.length,
    0,
  );
  if (totalCardScopedQuotes === 0) return null;

  // Flatten across all tcg_cards rows in the family.
  const graded = data.cardScopedPricing.flatMap((cs) => cs.graded);

  // Slice A: fetch card-scoped daily history for each tcg_cards row
  // in the family, in parallel. Wrapped in safe() so a slow read
  // never blocks the page. Series arrive grouped by grader/grade so
  // the chart handles them without knowing about the underlying
  // per-tcg_cards fan-out.
  const historyResults = await Promise.all(
    data.cardScopedPricing.map((cs) =>
      safe('card-scoped-history', () =>
        getYugiohCardScopedPriceHistory(cs.cardId),
      ),
    ),
  );
  const seriesByKey = new Map<
    string,
    { key: string; label: string; currency: string; points: { date: string; price: number }[] }
  >();
  let daysCovered = 0;
  const firsts: string[] = [];
  const lasts: string[] = [];
  for (const result of historyResults) {
    if (!result.ok || !result.value) continue;
    for (const s of result.value.gradedCard) {
      const existing = seriesByKey.get(s.key);
      if (existing) {
        existing.points.push(...s.points);
      } else {
        seriesByKey.set(s.key, {
          key: s.key,
          label: s.label,
          currency: s.currency,
          points: [...s.points],
        });
      }
    }
    daysCovered = Math.max(daysCovered, result.value.daysCovered);
    if (result.value.firstObservation) firsts.push(result.value.firstObservation);
    if (result.value.lastObservation) lasts.push(result.value.lastObservation);
  }
  const firstObs = firsts.length ? firsts.sort()[0]! : null;
  const lastObs = lasts.length ? lasts.sort().at(-1)! : null;
  const chartSeries = Array.from(seriesByKey.values()).map((s) => ({
    ...s,
    points: s.points.sort((a, b) => a.date.localeCompare(b.date)),
  }));

  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>
          Graded market · edition / variant unspecified
        </h2>
        <p className={styles.sectionCaption}>
          These graded observations apply to the wider {data.name} card
          family. The source data does not identify which physical
          edition / finish / language the slabs came from — they are shown
          here for context and never attributed to a specific printing.
        </p>
      </header>
      <GradedStrip
        quotes={graded}
        emptyLabel="No card-scoped graded quotes right now."
      />
      {chartSeries.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <PriceHistoryChart
            title="Graded price history · card family"
            subtitle="Card-scoped attribution — not tied to any specific printing."
            series={chartSeries}
            daysCovered={daysCovered}
            footerNote={
              firstObs ? `Available: ${firstObs} to ${lastObs}.` : undefined
            }
          />
        </div>
      )}
    </section>
  );
}

// Small display helper that mirrors EditionBadge's label choice —
// used inline here so we don't reach into that component's styles.
function EditionBadgeLabel({ edition }: { edition: string }) {
  const label =
    edition === '1st_edition'
      ? '1st Edition'
      : edition === 'limited'
      ? 'Limited Edition'
      : 'Unlimited / Unspecified';
  return <span style={{ fontFamily: 'var(--ygo-font-body)', fontSize: 12 }}>{label}</span>;
}

// ── JSON-LD ──────────────────────────────────────────────────────

function buildCardJsonLd(data: LogicalCardData, siteUrl: string) {
  const url = `${siteUrl}/card/${data.slug}`;
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: data.name, item: url },
    ],
  };
  const product = {
    '@type': 'Product',
    name: data.name,
    description: data.rulesText ?? undefined,
    image: data.representativeImage ?? undefined,
    url,
    offers:
      data.usdPriceLow != null && data.usdPriceHigh != null
        ? {
            '@type': 'AggregateOffer',
            priceCurrency: 'USD',
            lowPrice: data.usdPriceLow,
            highPrice: data.usdPriceHigh,
            offerCount: data.variants.filter((v) => v.bestUsdRetail?.price != null).length,
          }
        : undefined,
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [breadcrumb, product],
  };
}

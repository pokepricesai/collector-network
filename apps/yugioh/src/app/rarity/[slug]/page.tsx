import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CardBrowseTile } from '../../../components/card-visual/CardBrowseTile';
import { CardMiniThumb } from '../../../components/card-visual/CardMiniThumb';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { Surface } from '../../../components/Surface';
import { RarityRefractorLine } from '../../../components/signature/RarityRefractorLine';
import {
  RARITY_FAMILIES,
  RARITY_FAMILY_LABELS,
  type RarityFamily,
} from '../../../design/tokens';
import { siteUrl } from '../../../lib/site-url';
import { toCardSlug } from '../../../lib/slug';
import {
  getYugiohRarityBySlug,
  type RarityPageData,
} from '../../../server/browse';
import styles from '../../../components/browse/Browse.module.css';

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

function isValidFamily(slug: string): slug is RarityFamily {
  return (RARITY_FAMILIES as readonly string[]).includes(slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidFamily(slug)) {
    return {
      title: 'Rarity family not found - YGOPrices',
      robots: { index: false, follow: true },
    };
  }
  const data = await getYugiohRarityBySlug(slug);
  if (!data) {
    return {
      title: 'Rarity family not found - YGOPrices',
      robots: { index: false, follow: true },
    };
  }
  const canonical = `${siteUrl()}/rarity/${slug}`;
  const label = RARITY_FAMILY_LABELS[slug];
  const description = `${label} - ${data.totalCards.toLocaleString('en-US')} Yu-Gi-Oh! card variants across ${data.rarities.length} distinct rarity names. Cards, sets and representative market values on the collector catalogue.`;
  return {
    title: `${label} Yu-Gi-Oh! rarity - cards, sets, prices`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${label} - Yu-Gi-Oh! rarity`,
      description,
      url: canonical,
      type: 'article',
    },
  };
}

export default async function RarityPage({ params }: Props) {
  const { slug } = await params;
  if (!isValidFamily(slug)) notFound();
  const data = await getYugiohRarityBySlug(slug);
  if (!data) notFound();

  const jsonLd = buildJsonLd(data, siteUrl());
  const label = RARITY_FAMILY_LABELS[data.family];

  return (
    <>
      <Header compactSearch />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.crumbs}>
            <Link href="/">Home</Link>
            <span className={styles.crumbSep}>·</span>
            <Link href="/rarities">Rarities</Link>
            <span className={styles.crumbSep}>·</span>
            <span>{label}</span>
          </p>
          <h1 className={styles.title}>{label}</h1>
          <RarityRefractorLine rarity={data.rarities[0]} />
          <div className={styles.identityGrid}>
            <span className={styles.metaValue}>
              {data.totalCards.toLocaleString('en-US')} indexed cards
            </span>
            <span className={styles.metaValue}>
              {data.rarities.length} distinct rarity names
            </span>
            <span className={styles.metaValue}>
              {data.latestSets.length} sets represented (sample)
            </span>
          </div>
          {data.rarities.length > 1 && (
            <p className={styles.subtitle}>
              Names in this family: {data.rarities.join(' · ')}
            </p>
          )}
          {data.pricingDegraded && (
            <div className={styles.notice}>
              Pricing is temporarily unavailable for parts of this rarity - retry in a moment.
            </div>
          )}
          {data.truncated && (
            <div className={styles.notice}>
              Showing the first {data.cards.length.toLocaleString('en-US')} cards
              - this rarity has {data.totalCards.toLocaleString('en-US')} total.
              Browse full lists via individual set pages.
            </div>
          )}
        </header>

        {data.topByUsdPrice.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Highest-value examples</h2>
              <p className={styles.sectionCaption}>
                Top USD retail prices in the sample.
              </p>
            </header>
            <div className={styles.topGrid}>
              {data.topByUsdPrice.map((entry) => (
                <Link
                  key={entry.card.id}
                  href={`/card/${toCardSlug(entry.card.name)}`}
                  style={{ textDecoration: 'none' }}
                >
                  <Surface variant="premium" className={styles.topTile}>
                    <CardMiniThumb
                      src={
                        entry.card.images?.small ??
                        entry.card.images?.normal ??
                        null
                      }
                      alt={entry.card.name}
                      size="md"
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className={styles.topName}>{entry.card.name}</p>
                      <p className={styles.topMeta}>
                        {entry.set?.code.toUpperCase()} · {entry.card.collector_number}
                      </p>
                      <p className={styles.topPrice}>
                        ${entry.bestUsdRetail!.price!.toLocaleString('en-US', {
                          maximumFractionDigits: 0,
                        })}
                      </p>
                    </div>
                  </Surface>
                </Link>
              ))}
            </div>
          </section>
        )}

        {data.latestSets.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Recently indexed sets</h2>
              <p className={styles.sectionCaption}>
                Sets that contain {label} cards, most recent first.
              </p>
            </header>
            <div className={styles.directoryGrid}>
              {data.latestSets.map((entry) => (
                <Link
                  key={entry.set.id}
                  href={`/set/${encodeURIComponent(entry.set.code.toLowerCase())}`}
                  style={{ textDecoration: 'none' }}
                >
                  <Surface variant="card" className={styles.directoryTile}>
                    <h3 className={styles.tileTitle}>{entry.set.name}</h3>
                    <div className={styles.tileMeta}>
                      <span className={styles.setCode}>
                        {entry.set.code.toUpperCase()}
                      </span>
                      <span className={styles.tileMetaValue}>
                        {entry.set.released_at
                          ? new Date(entry.set.released_at).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                            })
                          : '-'}
                      </span>
                    </div>
                    <div className={styles.tileMeta}>
                      <span>Cards in this family</span>
                      <span className={styles.tileMetaValue}>
                        {entry.count.toLocaleString('en-US')}
                      </span>
                    </div>
                  </Surface>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Sample cards ({Math.min(data.cards.length, 60)})
            </h2>
            <p className={styles.sectionCaption}>
              A visual cross-section of cards in this rarity family. Click
              any tile to see every printing across every set.
            </p>
          </header>
          <div className={styles.setCardGrid}>
            {data.cards.slice(0, 60).map((entry) => (
              <CardBrowseTile
                key={entry.card.id}
                href={`/card/${toCardSlug(entry.card.name)}`}
                name={entry.card.name}
                rarity={entry.card.rarity}
                image={
                  entry.card.images?.small ?? entry.card.images?.normal ?? null
                }
                collectorNumber={entry.card.collector_number}
                setLine={entry.set?.code?.toUpperCase() ?? null}
                bestUsdRetail={entry.bestUsdRetail?.price ?? null}
                bestEurRetail={entry.bestEurRetail?.price ?? null}
              />
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function buildJsonLd(data: RarityPageData, siteOrigin: string) {
  const url = `${siteOrigin}/rarity/${data.family}`;
  const label = RARITY_FAMILY_LABELS[data.family];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteOrigin },
          { '@type': 'ListItem', position: 2, name: 'Rarities', item: `${siteOrigin}/rarities` },
          { '@type': 'ListItem', position: 3, name: label, item: url },
        ],
      },
      {
        '@type': 'CollectionPage',
        name: `${label} - Yu-Gi-Oh! rarity`,
        url,
        numberOfItems: data.totalCards,
      },
    ],
  };
}

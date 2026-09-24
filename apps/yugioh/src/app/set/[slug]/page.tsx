import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EditionBadge } from '../../../components/EditionBadge';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { RarityBadge } from '../../../components/RarityBadge';
import { Surface } from '../../../components/Surface';
import { normaliseRarity } from '../../../lib/rarity';
import { siteUrl } from '../../../lib/site-url';
import { toCardSlug } from '../../../lib/slug';
import {
  getYugiohSetBySlug,
  type SetPageData,
} from '../../../server/browse';
import styles from '../../../components/browse/Browse.module.css';

export const revalidate = 1800;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getYugiohSetBySlug(slug);
  if (!data) {
    return {
      title: 'Set not found — Duelist Prices',
      robots: { index: false, follow: true },
    };
  }
  const canonical = `${siteUrl()}/set/${encodeURIComponent(data.set.code.toLowerCase())}`;
  const released = data.set.released_at
    ? ` · released ${new Date(data.set.released_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
    : '';
  const description = `${data.set.name} (${data.set.code.toUpperCase()}) — ${data.uniqueCardCount} unique cards across ${data.variantCount} rarity variants${released}. Full checklist, rarity breakdown and market values on the Yu-Gi-Oh! collector catalogue.`;
  return {
    title: `${data.set.name} (${data.set.code.toUpperCase()}) — set checklist & prices`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${data.set.name} — ${data.set.code.toUpperCase()}`,
      description,
      url: canonical,
      type: 'article',
    },
  };
}

export default async function SetPage({ params }: Props) {
  const { slug } = await params;
  const data = await getYugiohSetBySlug(slug);
  if (!data) notFound();

  const jsonLd = buildSetJsonLd(data, siteUrl());
  const sortedCards = [...data.cards].sort((a, b) => {
    const cnA = a.card.collector_number ?? '';
    const cnB = b.card.collector_number ?? '';
    return cnA.localeCompare(cnB, undefined, { numeric: true });
  });

  return (
    <>
      <Header compactSearch />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.crumbs}>
            <Link href="/">Home</Link>
            <span className={styles.crumbSep}>·</span>
            <Link href="/sets">Sets</Link>
            <span className={styles.crumbSep}>·</span>
            <span>{data.set.code.toUpperCase()}</span>
          </p>
          <h1 className={styles.title}>{data.set.name}</h1>
          <div className={styles.identityGrid}>
            <span className={styles.setCode}>{data.set.code.toUpperCase()}</span>
            {data.set.released_at && (
              <span className={styles.metaValue}>
                Released {new Date(data.set.released_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            )}
            <span className={styles.metaValue}>
              {data.uniqueCardCount.toLocaleString('en-US')} unique cards
            </span>
            <span className={styles.metaValue}>
              {data.variantCount.toLocaleString('en-US')} rarity variants
            </span>
            <span className={styles.metaValue}>
              {data.rarityBreakdown.length} rarities
            </span>
          </div>
          {data.pricingDegraded && (
            <div className={styles.notice}>
              Pricing is temporarily unavailable for parts of this set — retry
              in a moment. Card metadata is still displayed below.
            </div>
          )}
        </header>

        {data.topByUsdPrice.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Highest-value cards</h2>
              <p className={styles.sectionCaption}>
                Top USD retail prices across this set&rsquo;s indexed printings.
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className={styles.topName}>{entry.card.name}</p>
                      <p className={styles.topMeta}>
                        {entry.card.collector_number} · {entry.card.rarity ?? '—'}
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

        {(data.rarityBreakdown.length > 0 || data.editionBreakdown.length > 0) && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Set breakdown</h2>
            </header>
            <div className={styles.breakdownGrid}>
              {data.rarityBreakdown.length > 0 && (
                <Surface variant="card" className={styles.breakdownCell}>
                  <span className={styles.breakdownLabel}>Rarity distribution</span>
                  {data.rarityBreakdown.slice(0, 10).map((r) => {
                    const family = normaliseRarity(r.rarity);
                    return (
                      <Link
                        key={r.rarity}
                        href={`/rarity/${family}`}
                        className={styles.breakdownRow}
                        style={{ textDecoration: 'none' }}
                      >
                        <span>{r.rarity}</span>
                        <span className={styles.breakdownCount}>{r.count}</span>
                      </Link>
                    );
                  })}
                </Surface>
              )}
              {data.editionBreakdown.length > 0 && (
                <Surface variant="card" className={styles.breakdownCell}>
                  <span className={styles.breakdownLabel}>Edition distribution</span>
                  {data.editionBreakdown.map((e) => (
                    <div key={e.edition} className={styles.breakdownRow}>
                      <EditionBadge edition={e.edition === 'unlimited_or_unknown' ? null : e.edition} />
                      <span className={styles.breakdownCount}>{e.count}</span>
                    </div>
                  ))}
                </Surface>
              )}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>
              Card checklist ({data.uniqueCardCount} unique · {data.variantCount} variants)
            </h2>
            <p className={styles.sectionCaption}>
              Sorted by collector number. Each row is one rarity variant — a
              card printed at multiple rarities appears once per rarity. Click
              any row to open the logical card with every printing across every
              set.
            </p>
          </header>
          <table className={styles.cardsTable}>
            <thead>
              <tr>
                <th>Card #</th>
                <th>Name</th>
                <th>Rarity</th>
                <th style={{ textAlign: 'right' }}>USD</th>
                <th style={{ textAlign: 'right' }}>EUR</th>
              </tr>
            </thead>
            <tbody>
              {sortedCards.map((entry) => {
                const slug = toCardSlug(entry.card.name);
                return (
                  <tr key={entry.card.id}>
                    <td>
                      <span className={styles.setCode}>
                        {entry.card.collector_number ?? '—'}
                      </span>
                    </td>
                    <td>
                      <Link
                        href={`/card/${slug}`}
                        className={styles.cardLink}
                      >
                        {entry.card.name}
                      </Link>
                    </td>
                    <td>
                      <RarityBadge rarity={entry.card.rarity} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {entry.bestUsdRetail?.price != null ? (
                        <span className={styles.priceNum}>
                          ${entry.bestUsdRetail.price.toLocaleString('en-US', {
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      ) : (
                        <span className={styles.dim}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {entry.bestEurRetail?.price != null ? (
                        <span className={styles.priceNum}>
                          €{entry.bestEurRetail.price.toLocaleString('en-US', {
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
        </section>
      </main>
      <Footer />
    </>
  );
}

function buildSetJsonLd(data: SetPageData, siteOrigin: string) {
  const url = `${siteOrigin}/set/${encodeURIComponent(data.set.code.toLowerCase())}`;
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteOrigin },
      { '@type': 'ListItem', position: 2, name: 'Sets', item: `${siteOrigin}/sets` },
      { '@type': 'ListItem', position: 3, name: data.set.name, item: url },
    ],
  };
  const collection = {
    '@type': 'CollectionPage',
    name: `${data.set.name} (${data.set.code.toUpperCase()})`,
    url,
    numberOfItems: data.uniqueCardCount,
    datePublished: data.set.released_at ?? undefined,
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [breadcrumb, collection],
  };
}

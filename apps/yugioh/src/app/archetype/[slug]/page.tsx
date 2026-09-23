import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttributeChip } from '../../../components/AttributeIcon';
import { CardClassBadge } from '../../../components/CardClassBadge';
import { FnlBadge } from '../../../components/FnlBadge';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { RarityBadge } from '../../../components/RarityBadge';
import { Surface } from '../../../components/Surface';
import { normaliseFnl } from '../../../lib/fnl';
import { siteUrl } from '../../../lib/site-url';
import { toCardSlug } from '../../../lib/slug';
import {
  getYugiohArchetypeBySlug,
  type ArchetypePageData,
} from '../../../server/browse';
import styles from '../../../components/browse/Browse.module.css';

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getYugiohArchetypeBySlug(slug);
  if (!data) {
    return {
      title: 'Archetype not found — Duelist Prices',
      robots: { index: false, follow: true },
    };
  }
  const canonical = `${siteUrl()}/archetype/${slug}`;
  const description = `${data.name} — ${data.cards.length.toLocaleString('en-US')} member card variants across ${data.setsRepresented.length} recently-indexed sets. Full member list, breakdown by monster type, and market values on the Yu-Gi-Oh! collector catalogue.`;
  return {
    title: `${data.name} archetype — Yu-Gi-Oh! cards, sets, prices`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${data.name} — Yu-Gi-Oh! archetype`,
      description,
      url: canonical,
      type: 'article',
    },
  };
}

export default async function ArchetypePage({ params }: Props) {
  const { slug } = await params;
  const data = await getYugiohArchetypeBySlug(slug);
  if (!data) notFound();

  const jsonLd = buildJsonLd(data, siteUrl());

  return (
    <>
      <Header compactSearch />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.crumbs}>
            <Link href="/">Home</Link>
            <span className={styles.crumbSep}>·</span>
            <Link href="/archetypes">Archetypes</Link>
            <span className={styles.crumbSep}>·</span>
            <span>{data.name}</span>
          </p>
          <h1 className={styles.title}>{data.name}</h1>
          <div className={styles.identityGrid}>
            <span className={styles.metaValue}>
              {data.cards.length.toLocaleString('en-US')} member variants
            </span>
            <span className={styles.metaValue}>
              {data.setsRepresented.length} recent sets
            </span>
            {data.attributeBreakdown.length > 0 && (
              <span className={styles.metaValue}>
                {data.attributeBreakdown.length} attributes
              </span>
            )}
          </div>
          {data.pricingDegraded && (
            <div className={styles.notice}>
              Pricing is temporarily unavailable for parts of this archetype — retry in a moment.
            </div>
          )}
        </header>

        {data.topByUsdPrice.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Highest-value members</h2>
              <p className={styles.sectionCaption}>
                Top USD retail prices among indexed member printings.
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
                        {entry.set?.code.toUpperCase()} · {entry.card.rarity}
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

        {(data.frameTypeBreakdown.length > 0 ||
          data.attributeBreakdown.length > 0 ||
          data.banlistBreakdown.length > 0) && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Archetype breakdown</h2>
            </header>
            <div className={styles.breakdownGrid}>
              {data.frameTypeBreakdown.length > 0 && (
                <Surface variant="card" className={styles.breakdownCell}>
                  <span className={styles.breakdownLabel}>Card class</span>
                  {data.frameTypeBreakdown.map((b) => (
                    <div key={b.frameType} className={styles.breakdownRow}>
                      <CardClassBadge cardClass={b.frameType} />
                      <span className={styles.breakdownCount}>{b.count}</span>
                    </div>
                  ))}
                </Surface>
              )}
              {data.attributeBreakdown.length > 0 && (
                <Surface variant="card" className={styles.breakdownCell}>
                  <span className={styles.breakdownLabel}>Attribute</span>
                  {data.attributeBreakdown.map((b) => (
                    <div key={b.attribute} className={styles.breakdownRow}>
                      <AttributeChip attribute={b.attribute} />
                      <span className={styles.breakdownCount}>{b.count}</span>
                    </div>
                  ))}
                </Surface>
              )}
              {data.banlistBreakdown.length > 0 && (
                <Surface variant="card" className={styles.breakdownCell}>
                  <span className={styles.breakdownLabel}>TCG legality</span>
                  {data.banlistBreakdown.map((b) => (
                    <div key={b.state} className={styles.breakdownRow}>
                      <FnlBadge state={normaliseFnl(b.state === 'unknown' ? null : b.state)} />
                      <span className={styles.breakdownCount}>{b.count}</span>
                    </div>
                  ))}
                </Surface>
              )}
            </div>
          </section>
        )}

        {data.setsRepresented.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Sets representing this archetype</h2>
              <p className={styles.sectionCaption}>
                Sets that contain {data.name} member cards, most recent first.
              </p>
            </header>
            <div className={styles.directoryGrid}>
              {data.setsRepresented.map((entry) => (
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
                          : '—'}
                      </span>
                    </div>
                    <div className={styles.tileMeta}>
                      <span>Members in this set</span>
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
              Member cards ({data.cards.length})
            </h2>
            <p className={styles.sectionCaption}>
              Every card that carries the {data.name} archetype tag in production data.
              Click any card to see every printing across every set.
            </p>
          </header>
          <table className={styles.cardsTable}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Set</th>
                <th>Card #</th>
                <th>Rarity</th>
                <th style={{ textAlign: 'right' }}>USD</th>
              </tr>
            </thead>
            <tbody>
              {data.cards.slice(0, 100).map((entry) => (
                <tr key={entry.card.id}>
                  <td>
                    <Link
                      href={`/card/${toCardSlug(entry.card.name)}`}
                      className={styles.cardLink}
                    >
                      {entry.card.name}
                    </Link>
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
                    <span className={styles.setCode}>
                      {entry.card.collector_number ?? '—'}
                    </span>
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
                </tr>
              ))}
            </tbody>
          </table>
          {data.cards.length > 100 && (
            <p className={styles.dim} style={{ marginTop: 12 }}>
              Showing the first 100 member cards. Full member listing arrives with the
              deck-usage layer.
            </p>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}

function buildJsonLd(data: ArchetypePageData, siteOrigin: string) {
  const url = `${siteOrigin}/archetype/${data.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteOrigin },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Archetypes',
            item: `${siteOrigin}/archetypes`,
          },
          { '@type': 'ListItem', position: 3, name: data.name, item: url },
        ],
      },
      {
        '@type': 'CollectionPage',
        name: `${data.name} — Yu-Gi-Oh! archetype`,
        url,
        numberOfItems: data.cards.length,
      },
    ],
  };
}

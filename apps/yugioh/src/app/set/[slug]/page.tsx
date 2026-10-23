import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CardBrowseTile } from '../../../components/card-visual/CardBrowseTile';
import { CardMiniThumb } from '../../../components/card-visual/CardMiniThumb';
import { EditionBadge } from '../../../components/EditionBadge';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { Surface } from '../../../components/Surface';
import { normaliseRarity } from '../../../lib/rarity';
import { siteUrl } from '../../../lib/site-url';
import { toCardSlug } from '../../../lib/slug';
import {
  getYugiohSetBySlug,
  listYugiohSetsForDirectory,
  type SetPageData,
} from '../../../server/browse';
import { buildYugiohEbayLink } from '../../../lib/ebay';
import Faq from '../../../components/Faq';
import EbayAffiliateDisclosure from '../../../components/EbayAffiliateDisclosure';
import { setFaq } from '../../../lib/faq-content';
import styles from '../../../components/browse/Browse.module.css';

// CN-COST-EMERGENCY: 1800 → 86400. Set catalogue updates on new-set
// ingest only — daily cadence is correct.
export const revalidate = 86400;
// Next.js 16 — on dynamic-segment routes, `revalidate` alone no
// longer opts into the Full Route Cache. Returning an empty array
// from generateStaticParams + dynamicParams=true registers this
// route for on-demand ISR (first request per slug renders at the
// origin and caches for `revalidate` seconds; subsequent requests
// serve from the edge). Zero build-time DB work.
export const dynamicParams = true;
export function generateStaticParams(): { slug: string }[] {
  return [];
}

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getYugiohSetBySlug(slug);
  if (!data) {
    return {
      title: 'Set not found - YGOPrices',
      robots: { index: false, follow: true },
    };
  }
  const canonical = `${siteUrl()}/set/${encodeURIComponent(data.set.code.toLowerCase())}`;
  const released = data.set.released_at
    ? ` · released ${new Date(data.set.released_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
    : '';
  const description = `${data.set.name} (${data.set.code.toUpperCase()}) - ${data.uniqueCardCount} unique cards across ${data.variantCount} rarity variants${released}. Full checklist, rarity breakdown and market values on the Yu-Gi-Oh! collector catalogue.`;
  return {
    title: `${data.set.name} (${data.set.code.toUpperCase()}) - set checklist & prices`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${data.set.name} - ${data.set.code.toUpperCase()}`,
      description,
      url: canonical,
      type: 'article',
    },
  };
}

export default async function SetPage({ params }: Props) {
  const { slug } = await params;
  // Currency is a presentation preference owned by the cookie-aware
  // CardBrowseTile client component. Dropping the server-side cookie
  // read here is what unlocks ISR / Full Route Cache on this page.
  const data = await getYugiohSetBySlug(slug);
  if (!data) notFound();

  // CN-05A growth sprint: surface the surrounding sibling sets +
  // the full-directory link so Googlebot and users can discover
  // more than the ~8 sets the homepage currently exposes. The
  // directory listing is cached (6h TTL via unstable_cache in
  // server/browse.ts), so this adds no DB round-trip in the hot
  // path.
  const directory = await listYugiohSetsForDirectory();
  const siblingSets = buildSiblingSetGrid(directory, data.set.id);
  const prevNext = buildPrevNextSet(directory, data.set.id);

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
          {(prevNext.prev || prevNext.next) && (
            <nav aria-label="Set release sequence" style={{
              display: 'flex', gap: 10, flexWrap: 'wrap',
              fontSize: 12.5, marginBottom: 10,
            }}>
              {prevNext.prev ? (
                <Link
                  href={`/set/${prevNext.prev.set.code.toLowerCase()}`}
                  rel="prev"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', borderRadius: 8,
                    border: '1px solid var(--ygo-border, #E5E7EB)',
                    background: 'var(--ygo-bg-light, #F9FAFB)',
                    color: 'var(--ygo-text, #111827)', textDecoration: 'none',
                    maxWidth: 320,
                  }}
                >
                  <span aria-hidden style={{ color: 'var(--ygo-text-muted, #6B7280)' }}>←</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--ygo-text-muted, #6B7280)' }}>Previous set: </span>
                    <strong>{prevNext.prev.set.name}</strong>
                  </span>
                </Link>
              ) : <span />}
              {prevNext.next ? (
                <Link
                  href={`/set/${prevNext.next.set.code.toLowerCase()}`}
                  rel="next"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', borderRadius: 8,
                    border: '1px solid var(--ygo-border, #E5E7EB)',
                    background: 'var(--ygo-bg-light, #F9FAFB)',
                    color: 'var(--ygo-text, #111827)', textDecoration: 'none',
                    maxWidth: 320, marginLeft: 'auto',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--ygo-text-muted, #6B7280)' }}>Next set: </span>
                    <strong>{prevNext.next.set.name}</strong>
                  </span>
                  <span aria-hidden style={{ color: 'var(--ygo-text-muted, #6B7280)' }}>→</span>
                </Link>
              ) : null}
            </nav>
          )}
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
              Pricing is temporarily unavailable for parts of this set - retry
              in a moment. Card metadata is still displayed below.
            </div>
          )}

          {/* Sealed-set eBay CTA. Targets sealed booster boxes /
              tins / structure decks for this set via the shared
              affiliate builder. Asterisk footnote maps to the
              affiliate disclosure at the bottom of the page. */}
          {(() => {
            const link = buildYugiohEbayLink({
              cardName: `${data.set.name} sealed`,
              setName: data.set.name,
              setCode: data.set.code,
              source: 'set-sealed',
            });
            return (
              <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="sponsored nofollow noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '9px 14px', borderRadius: 10,
                    background: 'linear-gradient(180deg, #f5c518 0%, #e0b21b 100%)',
                    color: '#1a1a1a', fontWeight: 700, fontSize: 13,
                    textDecoration: 'none',
                    border: '1px solid rgba(0, 0, 0, 0.15)',
                  }}
                >
                  <span>Find sealed {data.set.name} products on eBay<sup style={{ fontSize: '0.8em', marginLeft: 2 }}>*</sup></span>
                  <span aria-hidden style={{ fontSize: '0.85em', opacity: 0.7 }}>↗</span>
                </a>
              </div>
            );
          })()}
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
                        {entry.card.collector_number} · {entry.card.rarity ?? '-'}
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
              Sorted by collector number. Each tile is one rarity variant -
              a card printed at multiple rarities appears once per rarity.
              Click any tile for the full print history and market values.
            </p>
          </header>
          <div className={styles.setCardGrid}>
            {sortedCards.map((entry) => (
              <CardBrowseTile
                key={entry.card.id}
                href={`/card/${toCardSlug(entry.card.name)}`}
                name={entry.card.name}
                rarity={entry.card.rarity}
                image={
                  entry.card.images?.small ?? entry.card.images?.normal ?? null
                }
                collectorNumber={entry.card.collector_number}
                bestUsdRetail={entry.bestUsdRetail?.price ?? null}
                bestEurRetail={entry.bestEurRetail?.price ?? null}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="related-sets-heading" style={{
          marginTop: 32, paddingTop: 24,
          borderTop: '1px solid var(--ygo-border, #E5E7EB)',
        }}>
          <h2 id="related-sets-heading" style={{
            margin: '0 0 12px', fontSize: 18, letterSpacing: '-0.01em',
          }}>Other Yu-Gi-Oh! sets</h2>
          <div style={{
            display: 'grid', gap: 8,
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          }}>
            {siblingSets.map((entry) => (
              <Link
                key={entry.set.id}
                href={`/set/${entry.set.code.toLowerCase()}`}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 2,
                  padding: '8px 12px', borderRadius: 8,
                  border: '1px solid var(--ygo-border, #E5E7EB)',
                  background: 'var(--ygo-bg-light, #F9FAFB)',
                  color: 'inherit', textDecoration: 'none',
                  fontSize: 13, lineHeight: 1.35,
                }}
              >
                <span style={{ fontWeight: 600 }}>{entry.set.name}</span>
                <span style={{ fontSize: 11, color: 'var(--ygo-text-muted, #6B7280)' }}>
                  {entry.set.code.toUpperCase()}
                  {entry.uniqueCardCount > 0 ? ` · ${entry.uniqueCardCount.toLocaleString('en-US')} cards` : ''}
                </span>
              </Link>
            ))}
          </div>
          <p style={{ marginTop: 12, fontSize: 13 }}>
            <Link href="/sets" style={{ color: 'var(--ygo-accent-gold-strong, #B78A0F)' }}>
              Browse all Yu-Gi-Oh! sets →
            </Link>
          </p>
        </section>

        <Faq
          title={`About the ${data.set.name} set`}
          entries={setFaq(data.set.name, data.set.code, {
            uniqueCards: data.uniqueCardCount,
            variants: data.variantCount,
            rarities: data.rarityBreakdown.length,
          })}
        />

        <EbayAffiliateDisclosure />
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

// Pick ~24 sibling sets to surface at the bottom of the set page.
// Preference: the 12 most-recently-released sets other than the
// current one, plus the 12 nearest in release-date order so the
// user has both "what's new" and "what's adjacent to this release"
// surfaced. The full directory lives at /sets.
function buildSiblingSetGrid(
  directory: Awaited<ReturnType<typeof listYugiohSetsForDirectory>>,
  currentSetId: string,
): typeof directory {
  const pool = directory.filter((entry) => entry.set.id !== currentSetId);
  if (pool.length === 0) return [];
  const withDates = pool
    .map((entry) => ({ entry, t: entry.set.released_at ? Date.parse(entry.set.released_at) : NaN }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => (b.t as number) - (a.t as number));

  const recent = withDates.slice(0, 12).map((x) => x.entry);
  const currentIdx = withDates.findIndex((x) => x.entry.set.id === currentSetId); // -1 since filtered
  // Find adjacent sets to the current set by release date among the
  // full directory (which still contains the current set).
  const fullSorted = directory
    .map((entry) => ({ entry, t: entry.set.released_at ? Date.parse(entry.set.released_at) : NaN }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => (b.t as number) - (a.t as number));
  const idx = fullSorted.findIndex((x) => x.entry.set.id === currentSetId);
  const adjacent: typeof directory = [];
  if (idx >= 0) {
    for (let step = 1; adjacent.length < 12 && (idx - step >= 0 || idx + step < fullSorted.length); step++) {
      if (idx - step >= 0) adjacent.push(fullSorted[idx - step]!.entry);
      if (idx + step < fullSorted.length) adjacent.push(fullSorted[idx + step]!.entry);
    }
  }
  // Merge, dedupe by set.id, cap at 24.
  const seen = new Set<string>([currentSetId]);
  const out: typeof directory = [];
  for (const entry of [...adjacent, ...recent]) {
    if (seen.has(entry.set.id)) continue;
    seen.add(entry.set.id);
    out.push(entry);
    if (out.length >= 24) break;
  }
  void currentIdx; // kept for readability — adjacent uses idx against full
  return out;
}

// CN-05C task 13: 1-hop prev/next in release-date order so Googlebot
// (and users) see an explicit "release sequence" over the catalogue.
// Different signal from the broader siblings grid at the bottom of
// the page: that offers 24 adjacent sets as discovery; this offers
// a crisp 2-link chain Google can walk predictably across the whole
// catalogue.
function buildPrevNextSet(
  directory: Awaited<ReturnType<typeof listYugiohSetsForDirectory>>,
  currentSetId: string,
): { prev: typeof directory[number] | null; next: typeof directory[number] | null } {
  // Sort chronologically ascending — "previous" is the set that was
  // released BEFORE the current one; "next" is the one released
  // after. Only entries with a release date participate.
  const dated = directory
    .map((entry) => ({ entry, t: entry.set.released_at ? Date.parse(entry.set.released_at) : NaN }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => (a.t as number) - (b.t as number));
  const idx = dated.findIndex((x) => x.entry.set.id === currentSetId);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? dated[idx - 1]!.entry : null,
    next: idx < dated.length - 1 ? dated[idx + 1]!.entry : null,
  };
}

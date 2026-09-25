import type { Metadata } from 'next';
import Link from 'next/link';
import { CardBrowseTile } from '../../components/card-visual/CardBrowseTile';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { parseFinderQuery } from '../../lib/finder-query';
import {
  hasStructuredFilters,
  parseFinderParams,
  serialiseFinderParams,
  SORT_OPTIONS,
  type FinderFilters,
} from '../../lib/finder-filters';
import { siteUrl } from '../../lib/site-url';
import { toCardSlug } from '../../lib/slug';
import { runYugiohCardFinder } from '../../server/card-finder';
import { safe } from '../../server/safe';
import styles from './CardFinder.module.css';
import { FilterPanel } from './FilterPanel';

export const revalidate = 900;

const SITE_URL = siteUrl();

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// SEO: base /card-finder is indexable. Any structured filter combo
// gets noindex,follow and canonicals to the base, so the finder
// cannot become an infinite crawl space.
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const raw = await searchParams;
  const rawFilters = parseFinderParams(raw);
  const enriched = enrichWithSmartQuery(rawFilters);
  const structured = hasStructuredFilters(enriched);
  return {
    title: 'Card Finder - YGOPrices',
    description:
      'Search every Yu-Gi-Oh! card by name, effect, attribute, monster type, level, ATK/DEF, rarity, set, Forbidden & Limited status and live USD price.',
    alternates: { canonical: `${SITE_URL}/card-finder` },
    robots: structured
      ? { index: false, follow: true }
      : { index: true, follow: true },
  };
}

// Combine URL params with anything the smart-query parser can lift
// out of the free-text `q`. Explicit URL params always win.
function enrichWithSmartQuery(base: FinderFilters): FinderFilters {
  if (!base.q) return base;
  const parsed = parseFinderQuery(base.q);
  // Merge: URL param values are authoritative. Only fill fields the
  // user didn't set explicitly.
  return {
    ...parsed,
    ...Object.fromEntries(
      Object.entries(base).filter(([, v]) => v != null && v !== ''),
    ),
    // Keep the free-text query as the parser cleaned it (stopwords
    // stripped) so ILIKE doesn't include "cards from support".
    q: parsed.q,
  } as FinderFilters;
}

export default async function CardFinderPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const rawFilters = parseFinderParams(raw);
  const filters = enrichWithSmartQuery(rawFilters);
  const result = await safe('card-finder', () => runYugiohCardFinder(filters), {
    timeoutMs: 15_000,
  });
  const structured = hasStructuredFilters(rawFilters);

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.subtitle} style={{ marginBottom: 4, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ygo-accent-gold)' }}>
            Yu-Gi-Oh! discovery
          </p>
          <h1 className={styles.title}>Card Finder</h1>
          <p className={styles.subtitle}>
            Combine attribute, monster type, level, ATK, rarity, archetype,
            set, F&amp;L status and live USD price. Try &ldquo;LIGHT Dragon
            Level 4 1800+&rdquo; or &ldquo;Forbidden Spellcaster&rdquo; in the
            search box and the finder translates it into structured filters.
          </p>
        </header>

        <div className={styles.layout}>
          <FilterPanel filters={filters} />

          <div className={styles.results}>
            {result.ok ? (
              <FinderResults filters={filters} result={result.value} structured={structured} />
            ) : (
              <div className={styles.empty}>
                Card Finder is temporarily unavailable. Retry in a moment.
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function FinderResults({
  filters,
  result,
  structured,
}: {
  filters: FinderFilters;
  result: Awaited<ReturnType<typeof runYugiohCardFinder>>;
  structured: boolean;
}) {
  const activeChips = buildActiveChips(filters);
  return (
    <>
      <div className={styles.resultsHeader}>
        <span className={styles.resultsCount}>
          <span className={styles.resultsCountStrong}>
            {result.totalIdentities.toLocaleString('en-US')}
          </span>{' '}
          {result.totalIdentities === 1 ? 'card' : 'cards'} match
          {structured ? ' current filters' : ''}
          {result.totalRawRows > result.totalIdentities && (
            <>
              {' '}
              <span style={{ color: 'var(--ygo-text-quiet)' }}>
                (across {result.totalRawRows.toLocaleString('en-US')} printings)
              </span>
            </>
          )}
        </span>
        <span className={styles.sortRow}>
          <span>Sort:</span>
          <strong>
            {SORT_OPTIONS.find((s) => s.key === result.sort)?.label ?? result.sort}
          </strong>
        </span>
        <span className={styles.timings}>
          {result.timings.totalMs}ms · scan {result.timings.candidateScanMs}ms
          {result.timings.priceMs > 0 ? ` · price ${result.timings.priceMs}ms` : ''}
          {' '}· hydrate {result.timings.hydrateMs}ms
        </span>
      </div>

      {activeChips.length > 0 && (
        <div className={styles.activeChips}>
          {activeChips.map((chip) => {
            const withoutOne = { ...filters, [chip.filterKey]: undefined };
            const params = serialiseFinderParams(withoutOne as FinderFilters);
            const href = `/card-finder${params.toString() ? `?${params}` : ''}`;
            return (
              <Link key={chip.filterKey + ':' + chip.value} href={href} className={styles.chip}>
                <span className={styles.chipLabel}>{chip.label}</span>
                <span>{chip.value}</span>
                <span className={styles.chipRemove} aria-hidden>×</span>
              </Link>
            );
          })}
        </div>
      )}

      {result.priceCapability === 'refused-large' && (
        <div className={styles.truncatedNote}>
          Price filter and price sort are disabled while the candidate set
          holds more than 3,000 cards - narrow with another filter (attribute,
          type, rarity, archetype …) and price ordering will re-enable.
        </div>
      )}

      {result.truncated && (
        <div className={styles.truncatedNote}>
          Candidate scan capped. Narrow with another filter to see every
          matching identity.
        </div>
      )}

      {result.items.length === 0 ? (
        <div className={styles.empty}>
          No cards match these filters. Try loosening a criterion - or
          <Link href="/card-finder"> clear all filters</Link>.
        </div>
      ) : (
        <div className={styles.grid}>
          {result.items.map((item) => (
            <CardBrowseTile
              key={item.card.id}
              href={`/card/${toCardSlug(item.card.name)}`}
              name={item.card.name}
              rarity={item.card.rarity}
              image={item.card.images?.small ?? item.card.images?.normal ?? null}
              collectorNumber={item.card.collector_number}
              setLine={item.set?.code?.toUpperCase() ?? null}
              bestUsdRetail={item.bestUsdRetail?.price ?? null}
              bestEurRetail={item.bestEurRetail?.price ?? null}
            />
          ))}
        </div>
      )}

      {result.totalPages > 1 && (
        <nav className={styles.pagination} aria-label="Pagination">
          {result.page > 1 ? (
            <Link href={paginationHref(filters, result.page - 1)} className={styles.pageLink}>
              ← Previous
            </Link>
          ) : (
            <span className={`${styles.pageLink} ${styles.pageLinkDisabled}`}>← Previous</span>
          )}
          <span className={styles.pageIndicator}>
            Page {result.page} of {result.totalPages}
          </span>
          {result.page < result.totalPages ? (
            <Link href={paginationHref(filters, result.page + 1)} className={styles.pageLink}>
              Next →
            </Link>
          ) : (
            <span className={`${styles.pageLink} ${styles.pageLinkDisabled}`}>Next →</span>
          )}
        </nav>
      )}
    </>
  );
}

function paginationHref(filters: FinderFilters, page: number): string {
  const params = serialiseFinderParams({ ...filters, page });
  return `/card-finder${params.toString() ? `?${params}` : ''}`;
}

interface ActiveChip {
  filterKey: keyof FinderFilters;
  label: string;
  value: string;
}

function buildActiveChips(f: FinderFilters): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (f.attribute) chips.push({ filterKey: 'attribute', label: 'Attribute', value: f.attribute });
  if (f.frameType) chips.push({ filterKey: 'frameType', label: 'Class', value: f.frameType });
  if (f.race) chips.push({ filterKey: 'race', label: 'Type', value: f.race });
  if (f.archetype) chips.push({ filterKey: 'archetype', label: 'Archetype', value: f.archetype });
  if (f.rarity) chips.push({ filterKey: 'rarity', label: 'Rarity', value: f.rarity });
  if (f.setCode) chips.push({ filterKey: 'setCode', label: 'Set', value: f.setCode.toUpperCase() });
  if (f.level != null) chips.push({ filterKey: 'level', label: 'Level', value: String(f.level) });
  if (f.rank != null) chips.push({ filterKey: 'rank', label: 'Rank', value: String(f.rank) });
  if (f.linkRating != null) chips.push({ filterKey: 'linkRating', label: 'Link', value: String(f.linkRating) });
  if (f.atkMin != null) chips.push({ filterKey: 'atkMin', label: 'ATK min', value: String(f.atkMin) });
  if (f.atkMax != null) chips.push({ filterKey: 'atkMax', label: 'ATK max', value: String(f.atkMax) });
  if (f.defMin != null) chips.push({ filterKey: 'defMin', label: 'DEF min', value: String(f.defMin) });
  if (f.defMax != null) chips.push({ filterKey: 'defMax', label: 'DEF max', value: String(f.defMax) });
  if (f.priceMin != null) chips.push({ filterKey: 'priceMin', label: 'USD ≥', value: `$${f.priceMin}` });
  if (f.priceMax != null) chips.push({ filterKey: 'priceMax', label: 'USD ≤', value: `$${f.priceMax}` });
  if (f.banlistTcg) chips.push({ filterKey: 'banlistTcg', label: 'TCG', value: f.banlistTcg });
  return chips;
}

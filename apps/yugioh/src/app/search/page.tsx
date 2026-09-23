import type { Metadata } from 'next';
import Link from 'next/link';
import { CardImageFrame } from '../../components/CardImageFrame';
import { EditionBadge } from '../../components/EditionBadge';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { RarityBadge } from '../../components/RarityBadge';
import { SearchBar } from '../../components/SearchBar';
import { Surface } from '../../components/Surface';
import { RarityRefractorLine } from '../../components/signature/RarityRefractorLine';
import { normalisePrintingKey, toCardSlug } from '../../lib/slug';
import { search, type CardFamilyResult, type CardVariant } from '../../server/search';
import styles from './page.module.css';

// Slice 6: search results now link into the real card + printing
// pages. Family names go to /card/[slug]; each variant row on a
// set-code match goes to /card/[slug]/printing/[collector]/[key].

export const metadata: Metadata = {
  title: 'Search — Duelist Prices',
  robots: { index: false, follow: true }, // don't index search-result URLs
};

// Dynamic because query strings determine the response.
export const dynamic = 'force-dynamic';

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q = '' } = await searchParams;
  const response = q ? await search(q) : null;

  return (
    <>
      <Header compactSearch={false} />
      <main className={styles.page}>
        <div className={styles.searchWrap}>
          <SearchBar size="lg" defaultQuery={q} autoFocus placeholder="Card name, set code, archetype…" />
        </div>

        {response == null ? (
          <p className={styles.meta}>
            Type a card name (<em>blue-eyes</em>), a set code (<em>LOB-001</em>)
            or an archetype (<em>sky striker</em>). Autocomplete kicks in after
            two characters.
          </p>
        ) : (
          <SearchResponseView response={response} />
        )}
      </main>
      <Footer />
    </>
  );
}

function SearchResponseView({
  response,
}: {
  response: Awaited<ReturnType<typeof search>>;
}) {
  if (response.results.length === 0) {
    return (
      <Surface variant="card">
        <div className={styles.empty}>
          <p>
            No cards matched <strong>{response.query}</strong>.
          </p>
          <p style={{ marginTop: 8, fontSize: 12 }}>
            Try a shorter prefix or an exact set code like <em>LOB-001</em>.
          </p>
        </div>
      </Surface>
    );
  }

  const familyCount = response.results.filter((r) => r.kind === 'family').length;
  const setCodeCount = response.results.filter((r) => r.kind === 'set-code').length;
  const slow = response.serverMs > 800;

  return (
    <>
      <p className={styles.meta}>
        <span className={styles.metaStrong}>{response.results.length}</span>{' '}
        {familyCount > 0 ? `card ${familyCount === 1 ? 'family' : 'families'}` : ''}
        {setCodeCount > 0 && familyCount > 0 && ' · '}
        {setCodeCount > 0 && `${setCodeCount} set-code match`}
        {response.totalCardsScanned > response.results.length && (
          <> · {response.totalCardsScanned} rows scanned</>
        )}
        <span className={`${styles.metaBadge} ${slow ? styles.slow : ''}`}>
          {response.interpretedAs} · {response.serverMs}ms
        </span>
        {slow && (
          <span className={styles.metaBadge} title="Slice 3 documented pg_trgm as missing on tcg_cards.name">
            pg_trgm not yet indexed
          </span>
        )}
      </p>

      <div className={styles.results}>
        {response.results.map((result, i) => {
          if (result.kind === 'set-code') {
            return <SetCodeCard key={`set-${i}`} result={result} />;
          }
          return <FamilyCard key={`fam-${i}-${result.name}`} family={result} />;
        })}
      </div>
    </>
  );
}

function FamilyCard({ family }: { family: CardFamilyResult }) {
  const cardSlug = toCardSlug(family.name);
  const cardHref = `/card/${cardSlug}`;
  return (
    <Surface variant="card">
      <div className={styles.familyCard}>
        <div className={styles.familyImage}>
          <Link href={cardHref} aria-label={`Open ${family.name}`}>
            <CardImageFrame
              src={family.representativeImage}
              alt={family.name}
              rarity={family.rarityRange[0]}
              maxWidth={140}
            />
          </Link>
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 className={styles.familyName}>
            <Link
              href={cardHref}
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              {family.name}
            </Link>
          </h2>
          <RarityRefractorLine rarity={family.rarityRange[0]} />
          <p className={styles.familyMeta}>
            <span className={styles.familyPrice}>
              {family.usdPriceLow != null && family.usdPriceHigh != null ? (
                <>
                  ${family.usdPriceLow.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  {family.usdPriceHigh > family.usdPriceLow &&
                    ` – $${family.usdPriceHigh.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                  <span className={styles.familyPriceCurrency}>USD</span>
                </>
              ) : (
                <span className={styles.dim}>no live USD retail</span>
              )}
            </span>
            <span>{family.totalCards} rarity/set variants</span>
            <span>{family.totalPrintings} physical printings</span>
          </p>
          <div className={styles.rarityChips}>
            {family.rarityRange.slice(0, 8).map((r) => (
              <RarityBadge key={r} rarity={r} />
            ))}
            {family.rarityRange.length > 8 && (
              <span className={styles.dim}>+{family.rarityRange.length - 8} more</span>
            )}
          </div>
          <VariantsTable variants={family.variants} cardSlug={cardSlug} />
        </div>
      </div>
      <div className={styles.disabledClickHint}>
        Click a set row to open that printing, or the card image / name to open
        the full card family page.
      </div>
    </Surface>
  );
}

function SetCodeCard({ result }: { result: { code: string; matches: CardVariant[] } }) {
  const firstCard = result.matches[0]?.card;
  const cardSlug = firstCard ? toCardSlug(firstCard.name) : '';
  const cardHref = cardSlug ? `/card/${cardSlug}` : '#';
  return (
    <Surface variant="market">
      <div className={styles.familyCard}>
        <div className={styles.familyImage}>
          {cardSlug ? (
            <Link href={cardHref}>
              <CardImageFrame
                src={firstCard?.images?.small ?? null}
                alt={firstCard?.name ?? result.code}
                rarity={firstCard?.rarity}
                maxWidth={140}
              />
            </Link>
          ) : (
            <CardImageFrame
              src={firstCard?.images?.small ?? null}
              alt={firstCard?.name ?? result.code}
              rarity={firstCard?.rarity}
              maxWidth={140}
            />
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 className={styles.familyName}>
            {cardSlug ? (
              <Link href={cardHref} style={{ color: 'inherit', textDecoration: 'none' }}>
                {firstCard?.name ?? result.code}
              </Link>
            ) : (
              (firstCard?.name ?? result.code)
            )}
          </h2>
          <p className={styles.familyMeta}>
            <span className={styles.setCode}>{result.code}</span>
            <span>{result.matches.length} matching card {result.matches.length === 1 ? 'entry' : 'entries'}</span>
          </p>
          <VariantsTable variants={result.matches} cardSlug={cardSlug} />
        </div>
      </div>
    </Surface>
  );
}

function VariantsTable({ variants, cardSlug }: { variants: CardVariant[]; cardSlug: string }) {
  return (
    <table className={styles.variantsTable}>
      <thead>
        <tr>
          <th>Set</th>
          <th>Code</th>
          <th>Rarity</th>
          <th>Editions</th>
          <th style={{ textAlign: 'right' }}>USD</th>
          <th style={{ textAlign: 'right' }}>EUR</th>
        </tr>
      </thead>
      <tbody>
        {variants.slice(0, 10).map((v) => {
          const editions = Array.from(
            new Set(v.printings.map((p) => p.edition)),
          );
          // A variant may have multiple printings (1st Ed + Unlimited).
          // Link the ROW to the first printing; if the user wants a
          // specific edition they can click through to the card page
          // and pick from the table there.
          const firstPrinting = v.printings[0];
          const href =
            cardSlug && firstPrinting && v.card.collector_number
              ? `/card/${cardSlug}/printing/${encodeURIComponent(
                  v.card.collector_number,
                )}/${encodeURIComponent(
                  normalisePrintingKey(firstPrinting.tcggraph_printing_key),
                )}`
              : null;
          const setCell = href ? (
            <Link href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
              {v.set?.name ?? v.card.set_id}
            </Link>
          ) : (
            <span>{v.set?.name ?? v.card.set_id}</span>
          );
          return (
            <tr key={v.card.id}>
              <td>{setCell}</td>
              <td>
                <span className={styles.setCode}>
                  {v.card.collector_number ?? '—'}
                </span>
              </td>
              <td>
                <RarityBadge rarity={v.card.rarity} />
              </td>
              <td>
                <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                  {editions.map((e, i) => (
                    <EditionBadge key={i} edition={e} />
                  ))}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                {v.bestUsdQuote?.price != null ? (
                  <span className={styles.variantPrice}>
                    ${v.bestUsdQuote.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </span>
                ) : (
                  <span className={styles.dim}>—</span>
                )}
              </td>
              <td style={{ textAlign: 'right' }}>
                {v.bestEurQuote?.price != null ? (
                  <span className={styles.variantPrice}>
                    €{v.bestEurQuote.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </span>
                ) : (
                  <span className={styles.dim}>—</span>
                )}
              </td>
            </tr>
          );
        })}
        {variants.length > 10 && (
          <tr>
            <td colSpan={6} className={styles.dim}>
              +{variants.length - 10} more variants — open the card page
              to browse everything.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

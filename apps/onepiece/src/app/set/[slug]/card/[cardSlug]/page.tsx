import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@collector-network/auth';
import { getSetBundle } from '@/server/browse';
import { getVariantBundle, getSiblingVariants } from '@/server/read';
import { canonicalFor } from '@/lib/seo';
import { buildLogicalCardHref, buildVariantHref, candidatePrintingSplits, slugifyCardName } from '@/lib/onepiece/slug';
import { getCurrencyPreference } from '@/lib/onepiece/currency-server';
import { CURRENCY_SOURCE_NAME, formatPrice } from '@/lib/onepiece/currency';
import { HEADLINE_SIGNAL_LABEL } from '@/lib/onepiece/pick-headline';
import { pickCardImage } from '@/lib/onepiece/image';
import { renderEffectText } from '@/lib/onepiece/render-effect';
import { OP_COLOUR_LABEL } from '@/lib/onepiece/colour';
import CardStatGrid from '@/components/card/CardStatGrid';
import TreatmentPanel from '@/components/card/TreatmentPanel';
import PriceHistorySpark from '@/components/card/PriceHistorySpark';
import { AddToCollection } from '@/components/AddToCollection';
import { GradedPricesPanel } from '@/components/GradedPricesPanel';
import EbayAffiliateDisclosure from '@/components/EbayAffiliateDisclosure';
import { getPrintingHistory } from '@/server/history';
import { getGradedRowsForAnchor } from '@/server/graded';
import type { OpCardView, OpPrintingView } from '@/server/read';
import type { TcgCard } from '@collector-network/database';

// Specific-printing page. URL: /set/{code}/card/{cn-slug}. Resolves to
// a single tcg_cards row + all its treatment printings from that set,
// plus a "other printings" band linking to every same-name row from
// other sets.

export const revalidate = 900;
export const dynamic = 'force-dynamic';

async function resolveCard(
  setSlug: string,
  cardSlug: string,
): Promise<
  | {
      cardId: string;
      matched: TcgCard;
      collectorSlug: string;
      nameSlug: string;
    }
  | null
> {
  const setBundle = await getSetBundle(setSlug);
  if (!setBundle) return null;

  const splits = candidatePrintingSplits(cardSlug);
  const cardsByCn = new Map<string, TcgCard[]>();
  for (const c of setBundle.cards) {
    const key = normaliseSlug(c.collector_number ?? '');
    const bucket = cardsByCn.get(key);
    if (bucket) bucket.push(c);
    else cardsByCn.set(key, [c]);
  }

  for (const split of splits) {
    const bucket = cardsByCn.get(split.collectorSlug);
    if (!bucket) continue;
    for (const cand of bucket) {
      if (slugifyCardName(cand.name) === split.nameSlug) {
        return {
          cardId: cand.id,
          matched: cand,
          collectorSlug: split.collectorSlug,
          nameSlug: split.nameSlug,
        };
      }
    }
  }

  return null;
}

function normaliseSlug(cn: string): string {
  return cn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; cardSlug: string }>;
}): Promise<Metadata> {
  const { slug, cardSlug } = await params;
  const resolved = await resolveCard(slug, cardSlug);
  if (!resolved) return { title: 'Card not found' };
  const bundle = await getVariantBundle(resolved.cardId);
  if (!bundle) return { title: 'Card not found' };
  return {
    title: `${bundle.name} · ${slug.toUpperCase()} #${resolved.matched.collector_number ?? '–'}. Live market price`,
    description: `${bundle.name} (${slug.toUpperCase()} ${resolved.matched.collector_number ?? ''}). Live Cardmarket and TCGPlayer market prices for this exact variant.`,
    alternates: {
      canonical: canonicalFor(
        `/set/${encodeURIComponent(slug.toLowerCase())}/card/${encodeURIComponent(cardSlug)}`,
      ),
    },
  };
}

export default async function PrintingPage({
  params,
}: {
  params: Promise<{ slug: string; cardSlug: string }>;
}) {
  const { slug, cardSlug } = await params;
  const resolved = await resolveCard(slug, cardSlug);
  if (!resolved) notFound();
  const bundle = await getVariantBundle(resolved.cardId);
  if (!bundle) notFound();

  // Variant-scoped: bundle now holds exactly one tcg_cards row + its
  // own printings (finish × language rows). No sibling parallel /
  // reprint can silently override the hero image or the headline
  // price. Cross-set concerns don't apply either — a Level B variant
  // belongs to exactly one set.
  const anchorCardView: OpCardView = bundle.cards[0]!;
  const variantPrintings: Array<{ cardView: OpCardView; printingView: OpPrintingView }> =
    anchorCardView.printings.map((p) => ({ cardView: anchorCardView, printingView: p }));

  const currency = await getCurrencyPreference();
  // Sibling variants: base + other parallels + reprints in the same
  // family. Own image, own headline price, own /set/.../card/... link.
  const siblings = await getSiblingVariants(resolved.cardId, currency);

  const anchorPrinting = variantPrintings[0]?.printingView;
  const heroImage = pickCardImage(anchorCardView.card.images);

  const canonicalSetLabel =
    anchorPrinting?.set?.code?.toUpperCase() ??
    anchorCardView.set?.code?.toUpperCase() ??
    slug.toUpperCase();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${bundle.name} · ${canonicalSetLabel}`,
    url: canonicalFor(
      `/set/${encodeURIComponent(slug.toLowerCase())}/card/${encodeURIComponent(cardSlug)}`,
    ),
    category: 'Trading card',
    brand: {
      '@type': 'Brand',
      name: 'Bandai / One Piece Card Game',
    },
  } as const;

  return (
    <div style={{ padding: '32px 24px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <Breadcrumbs
          setCode={canonicalSetLabel}
          setName={anchorPrinting?.set?.name ?? anchorCardView.set?.name ?? slug.toUpperCase()}
          setPath={`/set/${encodeURIComponent(slug.toLowerCase())}`}
          cardName={bundle.name}
        />

        <div
          className="op-card-halo op-card-hero-grid"
          style={{
            gap: 28,
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              background:
                'linear-gradient(180deg, var(--bg-light) 0%, var(--bg-strong) 100%)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              overflow: 'hidden',
              aspectRatio: '5 / 7',
            }}
          >
            {heroImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={heroImage}
                alt={bundle.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div className="op-card-empty" aria-hidden>
                <span>Art loading</span>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
                {canonicalSetLabel} · #{resolved.matched.collector_number ?? '–'} · {anchorCardView.rarity.label}
              </div>
              <h1
                style={{
                  margin: '4px 0 10px',
                  fontSize: 'clamp(24px, 4.5vw, 32px)',
                  lineHeight: 1.15,
                }}
              >
                {bundle.name}
              </h1>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {anchorCardView.gamedata.colours.map((c) => (
                  <span key={c} className={`chip chip-${c}`}>
                    {OP_COLOUR_LABEL[c]}
                  </span>
                ))}
                <Link
                  href={buildLogicalCardHref(resolved.matched.collector_number, bundle.name)}
                  className="chip chip-gold"
                  style={{ textDecoration: 'none' }}
                >
                  View all versions of {bundle.name} {(resolved.matched.collector_number ?? '').split('_')[0]}
                </Link>
              </div>
            </div>

            <CardStatGrid
              gamedata={anchorCardView.gamedata}
              types={anchorCardView.gamedata.types}
            />

            {anchorCardView.gamedata.effectText && (
              <div
                style={{
                  padding: 16,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                }}
              >
                <div className="label-mono" style={{ marginBottom: 6 }}>
                  Effect
                </div>
                <p style={{ margin: 0, lineHeight: 1.55 }}>
                  {renderEffectText(anchorCardView.gamedata.effectText)}
                </p>
              </div>
            )}

            {anchorPrinting && (
              <AddToCollection
                cardId={anchorCardView.card.id}
                printingId={anchorPrinting.printing.id}
                cardName={bundle.name}
                isSignedIn={!!(await getCurrentUser())}
              />
            )}
          </div>
        </div>

        {anchorPrinting && (
          <GradedPanelForVariant
            printingIds={anchorCardView.printings.map((p) => p.printing.id)}
            cardId={anchorCardView.card.id}
            setCode={canonicalSetLabel}
            collectorNumber={resolved.matched.collector_number}
            finish={anchorPrinting.printing.finish}
          />
        )}

        <section style={{ marginTop: 36, display: 'grid', gap: 20 }}>
          <header>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              This variant
            </div>
            <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>
              {canonicalSetLabel} #{resolved.matched.collector_number ?? '–'}, priced rows
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
              Only rows tied to <strong>{resolved.matched.collector_number ?? bundle.name}</strong>.
              Sibling parallels and reprints are listed further down.
            </p>
          </header>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
              gap: 12,
            }}
          >
            {variantPrintings.length === 0 ? (
              <div
                style={{
                  gridColumn: '1 / -1',
                  padding: '18px',
                  background: 'var(--surface)',
                  border: '1px dashed var(--border-strong)',
                  borderRadius: 12,
                  color: 'var(--text-muted)',
                }}
              >
                No priced marketplace rows recorded for this variant yet.
              </div>
            ) : (
              variantPrintings.map(({ cardView, printingView }) => (
                <TreatmentPanel
                  key={printingView.printing.id}
                  cardView={cardView}
                  printingView={printingView}
                  linkToPrinting={false}
                  currency={currency}
                />
              ))
            )}
          </div>

          {variantPrintings[0] && (
            <PriceHistoryBlock printingId={variantPrintings[0].printingView.printing.id} />
          )}
        </section>

        {siblings.length > 0 && (
          <section style={{ marginTop: 40, display: 'grid', gap: 16 }}>
            <header>
              <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
                Other versions
              </div>
              <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>
                Other versions of {bundle.name} {(resolved.matched.collector_number ?? '').split('_')[0]}
              </h2>
              <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
                Distinct collectible variants (parallels, reprints).
                Each has its own image, own market ID, own price.
              </p>
            </header>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
                gap: 10,
              }}
            >
              {siblings.map((sib) => {
                const href = buildVariantHref(sib.setCode, sib.collectorNumber, sib.cardName);
                const priceText = sib.headline
                  ? formatPrice(sib.headline.price, sib.headline.currency, { digits: sib.headline.price >= 100 ? 0 : 2 })
                  : null;
                const priceHint = sib.headline
                  ? `${CURRENCY_SOURCE_NAME[sib.headline.currency]} ${HEADLINE_SIGNAL_LABEL[sib.headline.signal].toLowerCase()}`
                  : null;
                return (
                  <li key={sib.cardId}>
                    <Link
                      href={href}
                      className="card-hover"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '56px 1fr',
                        gap: 12,
                        alignItems: 'center',
                        padding: 10,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        textDecoration: 'none',
                        color: 'var(--text)',
                      }}
                    >
                      {sib.imageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={sib.imageUrl}
                          alt={`${sib.cardName} ${sib.collectorNumber ?? ''}`}
                          loading="lazy"
                          style={{ width: 56, aspectRatio: '5 / 7', objectFit: 'cover', borderRadius: 6, background: 'var(--bg-light)' }}
                        />
                      ) : (
                        <div style={{ width: 56, aspectRatio: '5 / 7', background: 'var(--bg-light)', borderRadius: 6 }} />
                      )}
                      <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.02em' }}>
                          {(sib.setCode ?? '').toUpperCase()} #{sib.collectorNumber ?? '–'}
                        </div>
                        {priceText ? (
                          <>
                            <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 15 }}>
                              {priceText}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{priceHint}</div>
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No live market price</div>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <EbayAffiliateDisclosure />
      </div>
    </div>
  );
}

async function GradedPanelForVariant({
  printingIds,
  cardId,
  setCode,
  collectorNumber,
  finish,
}: {
  printingIds: string[];
  cardId: string;
  setCode: string;
  collectorNumber: string | null;
  finish: string | null;
}) {
  const rows = await getGradedRowsForAnchor({ printingIds, cardId });
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 28 }}>
      <GradedPricesPanel
        rows={rows}
        setCode={setCode}
        collectorNumber={collectorNumber}
        finish={finish}
      />
    </div>
  );
}

async function PriceHistoryBlock({ printingId }: { printingId: string }) {
  let history;
  try {
    history = await getPrintingHistory(printingId);
  } catch {
    return null;
  }
  if (history.series.length === 0) return null;
  return (
    <section
      style={{
        marginTop: 20,
        padding: 18,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
      }}
    >
      <PriceHistorySpark history={history} />
    </section>
  );
}

function Breadcrumbs({
  setCode,
  setName,
  setPath,
  cardName,
}: {
  setCode: string;
  setName: string;
  setPath: string;
  cardName: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        marginBottom: 16,
        fontSize: 13,
        color: 'var(--text-muted)',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
        Home
      </Link>
      <span aria-hidden>›</span>
      <Link href="/browse" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
        Sets
      </Link>
      <span aria-hidden>›</span>
      <Link href={setPath} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
        {setCode}, {setName}
      </Link>
      <span aria-hidden>›</span>
      <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
        {cardName}
      </span>
    </nav>
  );
}

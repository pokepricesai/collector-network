import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@collector-network/auth';
import { getSetBundle } from '@/server/browse';
import { getCardBundleByCardId } from '@/server/read';
import { canonicalFor } from '@/lib/seo';
import { buildPrintingSlug, candidatePrintingSplits, slugifyCardName } from '@/lib/lorcana/slug';
import { pickCardImage } from '@/lib/lorcana/image';
import { LC_INK_LABEL } from '@/lib/lorcana/ink';
import CardStatGrid from '@/components/card/CardStatGrid';
import TreatmentPanel from '@/components/card/TreatmentPanel';
import PriceHistorySpark from '@/components/card/PriceHistorySpark';
import { AddToCollection } from '@/components/AddToCollection';
import { GradedPricesPanel } from '@/components/GradedPricesPanel';
import { getPrintingHistory } from '@/server/history';
import { getGradedRowsForAnchor } from '@/server/graded';
import type { LcCardView, LcPrintingView } from '@/server/read';
import type { TcgCard } from '@collector-network/database';
import { getLorcanaCurrency } from '@/lib/currency-server';

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
  const bundle = await getCardBundleByCardId(resolved.cardId);
  if (!bundle) return { title: 'Card not found' };
  return {
    title: `${bundle.name} · ${slug.toUpperCase()} #${resolved.matched.collector_number ?? '—'} — priced treatments`,
    description: `${bundle.name} from ${slug.toUpperCase()}. Every treatment (base, foil, Enchanted, Iconic, Epic, Legendary, Promo) with live prices.`,
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
  const bundle = await getCardBundleByCardId(resolved.cardId);
  if (!bundle) notFound();
  const currency = await getLorcanaCurrency();

  // Pin the anchor to the *exact* tcg_cards row the URL resolved to,
  // not the first printing that happens to sit in the set. Multiple
  // tcg_cards rows can share both name AND set (e.g. Elsa - Ice Maker
  // set 7 has cn=224 Super Rare Amethyst-ink alt-art AND cn=69 Super
  // Rare) — using inThisSet[0] can otherwise flip the hero image and
  // stat rail onto a sibling collectible.
  const anchorCardView =
    bundle.cards.find((c) => c.card.id === resolved.cardId) ?? bundle.cards[0]!;

  // Split printings into: those attached to the anchor tcg_cards row
  // (rendered as the hero + treatment list), the same-set siblings
  // (linked from a "Other collectibles in this set" strip), and other
  // sets (the pre-existing "Also printed in" strip).
  const inThisSet: Array<{ cardView: LcCardView; printingView: LcPrintingView }> = [];
  const sameSetSiblings: Array<{ cardView: LcCardView; printingView: LcPrintingView }> = [];
  const otherSets: Array<{ cardView: LcCardView; printingView: LcPrintingView }> = [];
  for (const c of bundle.cards) {
    const inSet =
      (c.set?.code ?? '').toLowerCase() === slug.toLowerCase();
    if (c.card.id === resolved.cardId) {
      for (const p of c.printings) inThisSet.push({ cardView: c, printingView: p });
    } else if (inSet) {
      for (const p of c.printings) sameSetSiblings.push({ cardView: c, printingView: p });
    } else {
      for (const p of c.printings) otherSets.push({ cardView: c, printingView: p });
    }
  }

  const anchorPrinting = inThisSet[0]?.printingView;
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
      name: 'Bandai / Disney Lorcana',
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
          className="lc-halo lc-card-hero-grid"
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
              <div className="lc-card-empty" aria-hidden>
                <span>Art loading</span>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <div className="label-mono" style={{ color: 'var(--accent-2)' }}>
                {canonicalSetLabel} · #{resolved.matched.collector_number ?? '—'} · {anchorCardView.rarity.label}
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
                {anchorCardView.gamedata.inks.map((c) => (
                  <span key={c} className={`chip chip-${c}`}>
                    {LC_INK_LABEL[c]}
                  </span>
                ))}
                <Link
                  href={`/card/${encodeURIComponent(slugifyCardName(bundle.name))}`}
                  className="chip chip-gold"
                  style={{ textDecoration: 'none' }}
                >
                  See every treatment
                </Link>
              </div>
            </div>

            <CardStatGrid
              gamedata={anchorCardView.gamedata}
              classifications={anchorCardView.gamedata.classifications}
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
                  {anchorCardView.gamedata.effectText}
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
          <GradedPanelForPrinting
            printingId={anchorPrinting.printing.id}
            cardId={anchorCardView.card.id}
            setCode={canonicalSetLabel}
            collectorNumber={resolved.matched.collector_number}
            finish={anchorPrinting.printing.finish}
          />
        )}

        <section style={{ marginTop: 36, display: 'grid', gap: 20 }}>
          <header>
            <div className="label-mono" style={{ color: 'var(--accent-2)' }}>
              In this set
            </div>
            <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>
              Treatments in {canonicalSetLabel}
            </h2>
          </header>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
              gap: 12,
            }}
          >
            {inThisSet.length === 0 ? (
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
                No priced printings recorded for this set yet.
              </div>
            ) : (
              inThisSet.map(({ cardView, printingView }) => (
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

          {inThisSet[0] && (
            <PriceHistoryBlock printingId={inThisSet[0].printingView.printing.id} />
          )}
        </section>

        {sameSetSiblings.length > 0 && (
          <section style={{ marginTop: 40, display: 'grid', gap: 16 }}>
            <header>
              <div className="label-mono" style={{ color: 'var(--accent-2)' }}>
                In this set — other collectibles
              </div>
              <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>
                Other {bundle.name} versions in {canonicalSetLabel}
              </h2>
              <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
                Same name, different collector number or rarity — a distinct collectible with its own artwork.
              </p>
            </header>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'grid',
                gap: 6,
              }}
            >
              {Array.from(
                new Map(sameSetSiblings.map((s) => [s.cardView.card.id, s])).values(),
              ).map(({ cardView }) => {
                const setCode = cardView.set?.code ?? '';
                const slugRow = buildPrintingSlug(
                  cardView.card.collector_number,
                  cardView.card.name,
                );
                const href = `/set/${encodeURIComponent(setCode.toLowerCase())}/card/${encodeURIComponent(slugRow)}`;
                return (
                  <li key={cardView.card.id}>
                    <Link
                      href={href}
                      className="lc-hover"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        textDecoration: 'none',
                        color: 'var(--text)',
                      }}
                    >
                      <span style={{ display: 'grid', gap: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>
                          #{cardView.card.collector_number ?? '—'} · {cardView.rarity.label}
                        </span>
                        <span
                          className="label-mono"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {setCode.toUpperCase()}
                        </span>
                      </span>
                      <span
                        className={`treatment-badge treatment-badge--${cardView.rarity.code.toLowerCase()}`}
                      >
                        {cardView.rarity.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {otherSets.length > 0 && (
          <section style={{ marginTop: 40, display: 'grid', gap: 16 }}>
            <header>
              <div className="label-mono" style={{ color: 'var(--gold-600) ' }}>
                Also printed in
              </div>
              <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>
                Other printings of {bundle.name}
              </h2>
            </header>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'grid',
                gap: 6,
              }}
            >
              {otherSets.map(({ cardView, printingView }) => {
                const setCode = printingView.set?.code ?? cardView.set?.code ?? '';
                const slugRow = buildPrintingSlug(
                  printingView.printing.collector_number,
                  cardView.card.name,
                );
                const href = `/set/${encodeURIComponent(setCode.toLowerCase())}/card/${encodeURIComponent(slugRow)}`;
                return (
                  <li key={printingView.printing.id}>
                    <Link
                      href={href}
                      className="lc-hover"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        textDecoration: 'none',
                        color: 'var(--text)',
                      }}
                    >
                      <span style={{ display: 'grid', gap: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>
                          {printingView.set?.name ?? setCode.toUpperCase()}
                        </span>
                        <span
                          className="label-mono"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {setCode.toUpperCase()} · #{printingView.printing.collector_number ?? '—'} · {cardView.rarity.label}
                        </span>
                      </span>
                      <span
                        className={`treatment-badge treatment-badge--${printingView.treatment.code}`}
                      >
                        {printingView.treatment.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

async function GradedPanelForPrinting({
  printingId,
  cardId,
  setCode,
  collectorNumber,
  finish,
}: {
  printingId: string;
  cardId: string;
  setCode: string;
  collectorNumber: string | null;
  finish: string | null;
}) {
  const rows = await getGradedRowsForAnchor({ printingId, cardId });
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
        {setCode} — {setName}
      </Link>
      <span aria-hidden>›</span>
      <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
        {cardName}
      </span>
    </nav>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSetBundle } from '@/server/browse';
import { getCardBundleByCardId } from '@/server/read';
import { canonicalFor } from '@/lib/seo';
import { buildPrintingSlug, candidatePrintingSplits, slugifyCardName } from '@/lib/onepiece/slug';
import { pickCardImage } from '@/lib/onepiece/image';
import { OP_COLOUR_LABEL } from '@/lib/onepiece/colour';
import CardStatGrid from '@/components/card/CardStatGrid';
import TreatmentPanel from '@/components/card/TreatmentPanel';
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
  const bundle = await getCardBundleByCardId(resolved.cardId);
  if (!bundle) return { title: 'Card not found' };
  return {
    title: `${bundle.name} · ${slug.toUpperCase()} #${resolved.matched.collector_number ?? '—'} — priced treatments`,
    description: `${bundle.name} from ${slug.toUpperCase()}. Every treatment (standard, parallel, alternate art, manga rare, secret rare) with live prices.`,
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

  // Filter to just the printings that live in *this* set, so the page
  // is set-specific. The /card/[slug] URL is where every set gets shown.
  const inThisSet: Array<{ cardView: OpCardView; printingView: OpPrintingView }> = [];
  const otherSets: Array<{ cardView: OpCardView; printingView: OpPrintingView }> = [];
  for (const c of bundle.cards) {
    for (const p of c.printings) {
      const inSet =
        (p.set?.code ?? '').toLowerCase() === slug.toLowerCase() ||
        (c.set?.code ?? '').toLowerCase() === slug.toLowerCase();
      if (inSet) inThisSet.push({ cardView: c, printingView: p });
      else otherSets.push({ cardView: c, printingView: p });
    }
  }

  const anchorPrinting = inThisSet[0]?.printingView;
  const anchorCardView = inThisSet[0]?.cardView ?? bundle.cards[0]!;
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
                {anchorCardView.gamedata.colours.map((c) => (
                  <span key={c} className={`chip chip-${c}`}>
                    {OP_COLOUR_LABEL[c]}
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
                  {anchorCardView.gamedata.effectText}
                </p>
              </div>
            )}
          </div>
        </div>

        <section style={{ marginTop: 36, display: 'grid', gap: 20 }}>
          <header>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
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
                />
              ))
            )}
          </div>
        </section>

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
                      className="card-hover"
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

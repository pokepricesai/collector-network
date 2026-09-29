import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@collector-network/auth';
import {
  getCardBundleByName,
  getCardFamilyByBaseCollector,
  findCardsForCollectorSlug,
} from '@/server/read';
import { searchCards } from '@/server/search';
import { canonicalFor } from '@/lib/seo';
import {
  candidatePrintingSplits,
  slugifyCardName,
  buildPrintingSlug,
} from '@/lib/onepiece/slug';
import { pickCardImage } from '@/lib/onepiece/image';
import { renderEffectText } from '@/lib/onepiece/render-effect';
import { OP_COLOUR_LABEL } from '@/lib/onepiece/colour';
import { TREATMENT_DISPLAY_ORDER } from '@/lib/onepiece/treatment';
import CardStatGrid from '@/components/card/CardStatGrid';
import TreatmentPanel from '@/components/card/TreatmentPanel';
import LogicalAddToCollection, {
  type PrintingPick,
} from '@/components/card/LogicalAddToCollection';
import AskOnePiecePanel from '@/components/card/AskOnePiecePanel';
import Faq from '@/components/Faq';
import EbayAffiliateDisclosure from '@/components/EbayAffiliateDisclosure';
import { logicalCardFaq } from '@/lib/faq-content';
import type { OpCardView, OpPrintingView } from '@/server/read';

// Logical / gameplay card page. Shows every printing across every set
// grouped by treatment. This is the URL that answers "how many
// treatments exist for Monkey D. Luffy, and what does each cost?" —
// the single most collector-relevant question in One Piece.

export const revalidate = 900;
export const dynamic = 'force-dynamic';

// Resolve a card family from the URL slug. The new (correct) shape is
// `${baseCollectorSlug}-${nameSlug}` — for example
// `op13-037-roronoa-zoro` identifies the OP13-037 Zoro (and its
// parallels + reprints), NOT every card ever named Roronoa Zoro.
//
// The `candidatePrintingSplits` walk handles hyphenated collector
// numbers by trying every plausible collector/name split until one
// matches a real DB row. Slugs without a recognisable collector
// prefix fall back to the legacy name-only lookup and return the
// first family — logged as legacy behaviour that will be phased out
// as inbound links migrate.
interface ResolvedFamily {
  baseCollector: string | null;
  nameSlug: string;
  name: string;
}
async function resolveFamily(slug: string): Promise<ResolvedFamily | null> {
  const splits = candidatePrintingSplits(slug);
  for (const { collectorSlug, nameSlug } of splits) {
    const hits = await findCardsForCollectorSlug(collectorSlug);
    const match = hits.find((h) => slugifyCardName(h.name) === nameSlug);
    if (match) return { baseCollector: match.baseCollector, nameSlug, name: match.name };
  }
  // Legacy: name-only slug. Return the first row whose slugged name
  // matches. This preserves any old inbound link but will surface an
  // arbitrary family for repeated-name characters. New links no
  // longer emit this shape.
  const naive = slug.replace(/-/g, ' ');
  const bundle = await getCardBundleByName(naive);
  if (bundle) {
    // Take the first card row as the arbitrary anchor. Its base
    // collector becomes the canonical family.
    const anchor = bundle.cards[0]?.card;
    return {
      baseCollector: anchor?.collector_number
        ? anchor.collector_number.replace(/_(?:p|r)\d+$/i, '')
        : null,
      nameSlug: slug,
      name: bundle.name,
    };
  }
  const candidates = await searchCards(naive.slice(0, 40), 40);
  const hit = candidates.find((c) => slugifyCardName(c.name) === slug);
  if (!hit) return null;
  return {
    baseCollector: hit.collector_number
      ? hit.collector_number.replace(/_(?:p|r)\d+$/i, '')
      : null,
    nameSlug: slug,
    name: hit.name,
  };
}

function canonicalSlugFor(fam: ResolvedFamily): string {
  return fam.baseCollector
    ? buildPrintingSlug(fam.baseCollector, fam.name)
    : slugifyCardName(fam.name);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const fam = await resolveFamily(slug);
  if (!fam) return { title: 'Card not found' };
  const canonicalSlug = canonicalSlugFor(fam);
  return {
    title: `${fam.name}${fam.baseCollector ? ` (${fam.baseCollector})` : ''}. Every printing, treatment and price`,
    description: `${fam.name}${fam.baseCollector ? ` — ${fam.baseCollector}` : ''}. Every treatment (standard, parallel, reprint, secret rare, special card, treasure rare, promo) priced individually.`.replace(' — ', '. '),
    alternates: { canonical: canonicalFor(`/card/${canonicalSlug}`) },
  };
}

export default async function LogicalCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const fam = await resolveFamily(slug);
  if (!fam) notFound();
  const bundle = fam.baseCollector
    ? await getCardFamilyByBaseCollector(fam.baseCollector, fam.nameSlug)
    : await getCardBundleByName(fam.name);
  if (!bundle) notFound();
  const canonicalSlug = canonicalSlugFor(fam);

  // Flatten all treatment printings from every rarity row, then group by
  // treatment code so the page reads chase-first:
  //   Treasure Rare (1) — panel per printing
  //   Secret Rare (2)
  //   Special Card (1)
  //   Parallel (3)
  //   Leader (2)
  //   Promo (1)
  //   Standard (12)
  //   Reprint (1)
  const flat: Array<{ cardView: OpCardView; printingView: OpPrintingView }> = [];
  for (const c of bundle.cards) {
    for (const p of c.printings) flat.push({ cardView: c, printingView: p });
  }

  // Pick hero art from the highest-rarity card row.
  const heroCard = pickHero(bundle.cards);
  const heroImage = pickCardImage(heroCard.card.images);

  // Load current user server-side so LogicalAddToCollection can render
  // its signed-in vs signed-out state without a client fetch.
  const currentUser = await getCurrentUser();
  const returnPath = `/card/${slug}`;

  // Materialise every real printing as a PrintingPick for the picker —
  // never a synthetic default row.
  const printingPicks: PrintingPick[] = flat.map((entry) => {
    const { cardView, printingView } = entry;
    return {
      cardId: cardView.card.id,
      printingId: printingView.printing.id,
      treatmentLabel: printingView.treatment.label,
      treatmentCode: printingView.treatment.code,
      finish: printingView.printing.finish ?? null,
      setCode: printingView.set?.code ?? null,
      collectorNumber: printingView.printing.collector_number ?? null,
      variantIndex: printingView.variantIndex,
    };
  });

  const grouped = groupByTreatment(flat);
  const treatmentOrder: Array<{
    label: string;
    code: (typeof flat)[number]['printingView']['treatment']['code'];
    entries: typeof flat;
  }> = [];
  for (const code of TREATMENT_DISPLAY_ORDER) {
    const entries = grouped.get(code);
    if (!entries || entries.length === 0) continue;
    treatmentOrder.push({ label: entries[0]!.printingView.treatment.label, code, entries });
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: bundle.name,
    url: canonicalFor(`/card/${canonicalSlug}`),
    description: `${bundle.name}${fam.baseCollector ? ` (${fam.baseCollector})` : ''}. Every printing and treatment.`,
  } as const;

  return (
    <div style={{ padding: '32px 24px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <Breadcrumbs name={bundle.name} />

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
                One Piece Card Game
              </div>
              <h1 style={{ margin: '4px 0 10px', fontSize: 30, lineHeight: 1.15 }}>
                {bundle.name}
              </h1>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {heroCard.gamedata.colours.map((c) => (
                  <span key={c} className={`chip chip-${c}`}>
                    {OP_COLOUR_LABEL[c]}
                  </span>
                ))}
                <span className="chip chip-gold" title="Standard, parallel, reprint, secret rare, special card, treasure rare, promo and leader treatments">
                  {treatmentOrder.length} treatment{treatmentOrder.length === 1 ? '' : 's'} · {flat.length} printing{flat.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <CardStatGrid gamedata={heroCard.gamedata} types={heroCard.gamedata.types} />

            {/* Primary Add-to-Collection surface — printing picker
                inline so users pick the exact printing.id (never an
                ambiguous row). Signed-out shows Sign up + Sign in. */}
            <div style={{ marginTop: 4 }}>
              <LogicalAddToCollection
                cardName={bundle.name}
                isSignedIn={Boolean(currentUser)}
                returnPath={returnPath}
                printings={printingPicks}
              />
            </div>

            {heroCard.gamedata.effectText && (
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
                  {renderEffectText(heroCard.gamedata.effectText)}
                </p>
                {heroCard.gamedata.triggerText && (
                  <>
                    <div
                      className="op-engraved"
                      aria-hidden
                      style={{ margin: '12px 0' }}
                    />
                    <div className="label-mono" style={{ marginBottom: 6 }}>
                      Trigger
                    </div>
                    <p style={{ margin: 0, lineHeight: 1.55 }}>
                      {renderEffectText(heroCard.gamedata.triggerText)}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <AskOnePiecePanel
          cardId={heroCard.card.id}
          cardName={bundle.name}
          contextSummary={buildAiContext(bundle.name, heroCard, flat)}
          suggestions={[
            `What treatments of ${bundle.name} exist?`,
            `What is the cheapest priced printing of ${bundle.name}?`,
            `What set is ${bundle.name} from?`,
          ]}
        />

        <section style={{ marginTop: 36, display: 'grid', gap: 20 }}>
          <header>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Treatments
            </div>
            <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>
              Priced individually
            </h2>
            <p
              style={{
                margin: '6px 0 0',
                color: 'var(--text-muted)',
                fontSize: 14,
                lineHeight: 1.55,
                maxWidth: 640,
              }}
            >
              Every treatment for {bundle.name} is a separate priced entity. Rarer
              treatments appear first so the chase versions of this card are always
              visible above the standard printing.
            </p>
          </header>

          {treatmentOrder.map((group) => (
            <div key={group.code} style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className={`treatment-badge treatment-badge--${group.code}`}>
                  {group.label}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                  }}
                >
                  {group.entries.length} printing
                  {group.entries.length === 1 ? '' : 's'}
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
                  gap: 12,
                }}
              >
                {group.entries.map(({ cardView, printingView }) => (
                  <TreatmentPanel
                    key={printingView.printing.id}
                    cardView={cardView}
                    printingView={printingView}
                    linkToPrinting
                  />
                ))}
              </div>
            </div>
          ))}
        </section>

        <Faq
          title={`About ${bundle.name}`}
          entries={logicalCardFaq(bundle.name, {
            treatmentCount: treatmentOrder.length,
            printingCount: flat.length,
            colours: heroCard.gamedata.colours.map((c) => OP_COLOUR_LABEL[c] ?? c),
            rarities: Array.from(new Set(bundle.cards.map((c) => c.card.rarity ?? '').filter(Boolean))),
          })}
        />

        <EbayAffiliateDisclosure />
      </div>
    </div>
  );
}

// Build a compact grounded-context string for the AI panel. Includes
// name, colours, card type, gameplay stats, treatments and cheapest
// live prices per printing. Deliberately terse — the model reads
// this as the ground-truth block.
function buildAiContext(
  name: string,
  heroCard: OpCardView,
  flat: Array<{ cardView: OpCardView; printingView: OpPrintingView }>,
): string {
  const g = heroCard.gamedata;
  const stats: string[] = [];
  if (g.cost != null) stats.push(`Cost ${g.cost}`);
  if (g.power != null) stats.push(`Power ${g.power}`);
  if (g.counter != null) stats.push(`Counter ${g.counter}`);
  if (g.life != null) stats.push(`Life ${g.life}`);
  if (g.attribute) stats.push(`Attribute ${g.attribute}`);
  const treatments = new Map<string, number>();
  const priceRows: string[] = [];
  for (const { printingView } of flat) {
    const key = printingView.treatment.label;
    treatments.set(key, (treatments.get(key) ?? 0) + 1);
    const cheapest = pickCheapestLive(printingView);
    if (cheapest) {
      priceRows.push(
        `  ${printingView.set?.code?.toUpperCase() ?? '–'} ${printingView.printing.collector_number ?? '–'} ${printingView.treatment.short}${printingView.variantIndex != null ? `#${printingView.variantIndex}` : ''} ${printingView.printing.finish ?? 'nonfoil'}: ${cheapest}`,
      );
    }
  }
  const rarities = Array.from(new Set(flat.map((e) => e.cardView.card.rarity).filter(Boolean))).join(', ');
  const treatmentLine = Array.from(treatments.entries())
    .map(([k, v]) => `${k} (${v})`)
    .join(', ');
  return [
    `Card: ${name}`,
    heroCard.set ? `Set: ${heroCard.set.name} (${heroCard.set.code.toUpperCase()})` : null,
    rarities ? `Rarity codes across printings: ${rarities}` : null,
    g.colours.length > 0 ? `Colours: ${g.colours.join(' / ')}` : null,
    g.types && g.types.length > 0 ? `Types: ${g.types.join(', ')}` : null,
    g.type ? `Card type: ${g.type}` : null,
    stats.length > 0 ? `Gameplay stats: ${stats.join(', ')}` : null,
    `Treatments: ${treatmentLine || '–'}`,
    `Total priced printings: ${flat.length}`,
    priceRows.length > 0 ? `Cheapest live prices:\n${priceRows.join('\n')}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function pickCheapestLive(view: OpPrintingView): string | null {
  const marketRows = (view.pricing?.market ?? []) as Array<{
    price?: number | null;
    currency?: string | null;
  }>;
  let best: { price: number; currency: string } | null = null;
  for (const row of marketRows) {
    if (row.price == null || !row.currency) continue;
    if (best == null || row.price < best.price) {
      best = { price: row.price, currency: row.currency };
    }
  }
  if (!best) return null;
  const symbol = best.currency === 'EUR' ? '€' : best.currency === 'USD' ? '$' : `${best.currency} `;
  return `${symbol}${best.price.toFixed(2)}`;
}

function pickHero(cards: OpCardView[]): OpCardView {
  const order: Record<string, number> = {
    SEC: 6, secret: 6, 'secret rare': 6,
    SR: 5, 'super rare': 5,
    L: 4, leader: 4,
    R: 3, rare: 3,
    UC: 2, uncommon: 2,
    C: 1, common: 1,
  };
  const sorted = [...cards].sort((a, b) => {
    const av = order[(a.card.rarity ?? '').toLowerCase()] ?? 0;
    const bv = order[(b.card.rarity ?? '').toLowerCase()] ?? 0;
    return bv - av;
  });
  return sorted[0] ?? cards[0]!;
}

function groupByTreatment(
  entries: Array<{ cardView: OpCardView; printingView: OpPrintingView }>,
) {
  const out = new Map<
    OpPrintingView['treatment']['code'],
    Array<{ cardView: OpCardView; printingView: OpPrintingView }>
  >();
  for (const e of entries) {
    const key = e.printingView.treatment.code;
    const bucket = out.get(key);
    if (bucket) bucket.push(e);
    else out.set(key, [e]);
  }
  return out;
}

function Breadcrumbs({ name }: { name: string }) {
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
      }}
    >
      <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
        Home
      </Link>
      <span aria-hidden>›</span>
      <Link
        href="/cards/search"
        style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
      >
        Cards
      </Link>
      <span aria-hidden>›</span>
      <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{name}</span>
    </nav>
  );
}

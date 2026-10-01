import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCardBundleByName } from '@/server/read';
import { searchCards } from '@/server/search';
import { canonicalFor } from '@/lib/seo';
import { slugifyCardName } from '@/lib/lorcana/slug';
import { pickCardImage } from '@/lib/lorcana/image';
import { LC_INK_LABEL } from '@/lib/lorcana/ink';
import { TREATMENT_DISPLAY_ORDER } from '@/lib/lorcana/treatment';
import CardStatGrid from '@/components/card/CardStatGrid';
import TreatmentPanel from '@/components/card/TreatmentPanel';
import EffectText from '@/components/card/EffectText';
import EbayFindButton, { EbayAffiliateDisclosure } from '@/components/EbayFindButton';
import { resolveLorcanaMarketplace } from '@/lib/lorcana/ebay';
import { getRequestCountry } from '@/lib/lorcana/request-country';
import LogicalAddToCollection, {
  type PrintingPick,
} from '@/components/card/LogicalAddToCollection';
import AskLorcanaPanel from '@/components/card/AskLorcanaPanel';
import CardFaq from '@/components/card/CardFaq';
import { buildLogicalCardFaq } from '@/lib/card-faq';
import { getCurrentUser } from '@collector-network/auth';
import LogicalWatch, { type WatchablePrinting } from '@/components/card/LogicalWatch';
import { watchedPrintingIdsFor } from '@/server/watchlist';
import CardInternalLinks from '@/components/card/CardInternalLinks';
import {
  getCardsInSameSet,
  getOtherCharacterCards,
  getCardsBySameRarity,
  getCardsBySameInk,
} from '@/server/internal-links';
import type { LcCardView, LcPrintingView } from '@/server/read';
import { getLorcanaCurrency } from '@/lib/currency-server';

// Logical / gameplay card page. Shows every printing across every set
// grouped by treatment.

export const revalidate = 900;
export const dynamic = 'force-dynamic';

async function resolveCardName(slug: string): Promise<string | null> {
  const naive = slug.replace(/-/g, ' ');
  const bundle = await getCardBundleByName(naive);
  if (bundle) return bundle.name;
  const candidates = await searchCards(naive.slice(0, 40), 40);
  const hit = candidates.find((c) => slugifyCardName(c.name) === slug);
  return hit?.name ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolvedName = await resolveCardName(slug);
  if (!resolvedName) return { title: 'Card not found' };
  const bundle = await getCardBundleByName(resolvedName);
  const heroCard = bundle ? pickHero(bundle.cards) : null;
  const rarityLabel = heroCard?.rarity.label ?? '';
  const setLabel = heroCard?.set?.name ?? '';
  return {
    title: `${resolvedName} — Lorcana card prices, treatments and printings`,
    description: `${resolvedName}${setLabel ? ` from ${setLabel}` : ''}${rarityLabel ? ` (${rarityLabel})` : ''}. Every printing across every set — foil, nonfoil and Enchanted overprint — priced individually with live retail on Cardmarket and TCGplayer.`,
    alternates: { canonical: canonicalFor(`/card/${slugifyCardName(resolvedName)}`) },
  };
}

export default async function LogicalCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolvedName = await resolveCardName(slug);
  if (!resolvedName) notFound();
  const bundle = await getCardBundleByName(resolvedName);
  if (!bundle) notFound();

  const flat: Array<{ cardView: LcCardView; printingView: LcPrintingView }> = [];
  for (const c of bundle.cards) {
    for (const p of c.printings) flat.push({ cardView: c, printingView: p });
  }

  const heroCard = pickHero(bundle.cards);
  const heroImage = pickCardImage(heroCard.card.images, 'large');
  const isChase = ['EN', 'IC', 'EP'].includes(heroCard.rarity.code);

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

  // Read the auth session + currency preference once. Currency drives
  // which native retail feed the per-treatment price row displays.
  const currentUser = await getCurrentUser();
  const currency = await getLorcanaCurrency();
  //  Pick the eBay marketplace once, server-side, from the request
  //  country header + currency hint. See lib/lorcana/ebay.ts for the
  //  conservative resolution policy.
  const country = await getRequestCountry();
  const marketplace = resolveLorcanaMarketplace(country, currency);

  // Materialise a flat list of every real printing the user could
  // legitimately add to their collection. The LogicalAddToCollection
  // picker uses this list — no default/fallback printing.
  const printingPicks: PrintingPick[] = flat.map(({ cardView, printingView }) => ({
    cardId: cardView.card.id,
    printingId: printingView.printing.id,
    treatmentLabel: printingView.treatment.label,
    treatmentCode: printingView.treatment.code,
    finish: printingView.printing.finish ?? null,
    setCode: cardView.set?.code ?? null,
    collectorNumber: cardView.card.collector_number ?? null,
  }));

  //  Watchlist identity mirrors the collection flow: single-printing
  //  cards auto-select the one and only tcg_printing_id; multi-
  //  printing cards force a picker where the user chooses the exact
  //  treatment × finish × set combination they want to watch. The
  //  initial "Watching" state per printing is computed in one round
  //  trip via watchedPrintingIdsFor().
  const watchedIds = currentUser
    ? await watchedPrintingIdsFor(printingPicks.map((p) => p.printingId))
    : new Set<string>();
  const watchablePrintings: WatchablePrinting[] = printingPicks.map((p) => ({
    ...p,
    initialWatching: watchedIds.has(p.printingId),
  }));

  // Internal-linking data. Every query is capped + skipped-when-empty
  // inside the component. We fan them out in parallel so the page
  // stays snappy.
  const isCharacter = heroCard.gamedata.cardType === 'character';
  const primaryInk = heroCard.gamedata.inks[0] ?? null;
  const [moreFromSet, otherCharacterCards, sameRarityCards, sameInkCards] =
    await Promise.all([
      heroCard.set?.id
        ? getCardsInSameSet(heroCard.set.id, heroCard.card.id, 8)
        : Promise.resolve([]),
      isCharacter
        ? getOtherCharacterCards(bundle.name, heroCard.card.id, 8)
        : Promise.resolve([]),
      heroCard.card.rarity
        ? getCardsBySameRarity(heroCard.card.rarity, heroCard.card.id, 6)
        : Promise.resolve([]),
      primaryInk
        ? getCardsBySameInk(primaryInk, heroCard.card.id, 6)
        : Promise.resolve([]),
    ]);

  // Compute deterministic FAQ from the bundle. All inputs come from
  // data already loaded above — never a fresh DB round trip.
  //
  // Price band is still used by AskLorcana's context summary and the
  // product JSON-LD. We derive it strictly within the dominant currency
  // so we never mix USD + EUR into one headline.
  const allPrices: Array<{ amount: number; currency: string }> = [];
  for (const { printingView } of flat) {
    const p = printingView.pricing?.market;
    if (p && p.length > 0) {
      for (const q of p) {
        if (q.price != null && q.currency) allPrices.push({ amount: q.price, currency: q.currency });
      }
    }
  }
  const currCounts = new Map<string, number>();
  for (const p of allPrices) currCounts.set(p.currency, (currCounts.get(p.currency) ?? 0) + 1);
  const dominant = Array.from(currCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const inCurrency = dominant ? allPrices.filter((p) => p.currency === dominant) : [];
  const cheapestPrice = inCurrency.length
    ? { amount: Math.min(...inCurrency.map((p) => p.amount)), currency: dominant! } : null;
  const dearestPrice = inCurrency.length
    ? { amount: Math.max(...inCurrency.map((p) => p.amount)), currency: dominant! } : null;

  // Graded row count derived from already-loaded printing pricing —
  // printing-attributed only (the only graded data on the bundle). The
  // logical FAQ labels these honestly as card-family level.
  let bundleGradedCount = 0;
  for (const { printingView } of flat) {
    bundleGradedCount += printingView.pricing?.graded?.length ?? 0;
  }

  const cardFaqEntries = buildLogicalCardFaq({
    cardName: bundle.name,
    cards: bundle.cards,
    flatPrintings: flat,
    hero: heroCard,
    gradedRowCount: bundleGradedCount,
    currency,
  });

  const canonical = canonicalFor(`/card/${slugifyCardName(bundle.name)}`);
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: canonicalFor('/') },
      { '@type': 'ListItem', position: 2, name: 'Cards', item: canonicalFor('/cards/search') },
      { '@type': 'ListItem', position: 3, name: bundle.name, item: canonical },
    ],
  };
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: bundle.name,
    url: canonical,
    image: heroImage ?? undefined,
    category: 'Trading card game / Disney Lorcana',
    description: `${bundle.name} — a Disney Lorcana card${heroCard.set ? ` from ${heroCard.set.name}` : ''}${heroCard.rarity.label ? ` at ${heroCard.rarity.label} rarity` : ''}. Every printing and treatment priced individually.`,
  } as const;

  return (
    <div className="lc-container lc-section">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />

      <Breadcrumbs
        name={bundle.name}
        setCode={heroCard.set?.code}
        setName={heroCard.set?.name}
      />
      {isCharacter && (() => {
        //  "View all [Character] cards" — pulls the base-character
        //  slug by stripping the " - Subtitle" tail off bundle.name.
        //  Only emitted for cardType='character' bundles so Items,
        //  Actions, Songs and Locations never see a stray link.
        const sep = bundle.name.indexOf(' - ');
        const baseName = sep > 0 ? bundle.name.slice(0, sep).trim() : bundle.name.trim();
        const charSlug = slugifyCardName(baseName);
        if (!charSlug) return null;
        return (
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <Link
              href={`/character/${charSlug}`}
              style={{ color: 'var(--primary, #6A43BE)', fontWeight: 600 }}
            >
              View all {baseName} cards →
            </Link>
          </div>
        );
      })()}

      <div className="lc-card-hero-grid lc-halo" style={isChase ? { ['--lc-halo' as string]: 'radial-gradient(60% 60% at 50% 35%, rgba(122,78,240,0.28), transparent 70%)' } as React.CSSProperties : undefined}>
        <div>
          <div className={isChase ? 'lc-enchanted-glow' : undefined} style={{
            background: 'linear-gradient(180deg, var(--surface-inset) 0%, var(--bg-strong) 100%)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
            aspectRatio: '5 / 7',
            position: 'relative',
          }}>
            {heroImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={heroImage}
                alt={bundle.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div className="lc-card-empty" aria-hidden />
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6, alignItems: 'center' }}>
              {heroCard.set?.code && (
                <span className="label-mono">
                  <Link href={`/set/${encodeURIComponent(heroCard.set.code.toLowerCase())}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                    {heroCard.set.code.toUpperCase()}
                  </Link>
                  {heroCard.card.collector_number && ` · ${heroCard.card.collector_number}`}
                </span>
              )}
              {heroCard.rarity.code !== 'UNKNOWN' && (
                <span className={`treatment-badge treatment-badge--${heroCard.rarity.code.toLowerCase()}`}>
                  {heroCard.rarity.label}
                </span>
              )}
            </div>
            <h1 style={{ margin: 0, letterSpacing: '-0.015em' }}>
              {bundle.name}
            </h1>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {heroCard.gamedata.inks.map((c) => (
                <span key={c} className={`chip chip-ink chip-ink--${c}`}>
                  {LC_INK_LABEL[c]}
                </span>
              ))}
              <span className="chip chip-gold">
                {treatmentOrder.length} treatment{treatmentOrder.length === 1 ? '' : 's'} · {flat.length} printing{flat.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {/* Primary action bar: Add-to-Collection (per-printing) +
              Watch (per-card convenience). The Watch button toggles
              watchlist state for the DEFAULT/first printing in the
              bundle; users who need to watch a specific treatment can
              open the exact printing page. Labelled "Watch this card"
              so the scope is unambiguous. Signed-out state falls
              through to /sign-in with a returnTo. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <LogicalAddToCollection
              cardName={bundle.name}
              isSignedIn={Boolean(currentUser)}
              returnPath={`/card/${slugifyCardName(bundle.name)}`}
              printings={printingPicks}
            />
            {watchablePrintings.length > 0 ? (
              <LogicalWatch
                cardName={bundle.name}
                isSignedIn={Boolean(currentUser)}
                returnPath={`/card/${slugifyCardName(bundle.name)}`}
                printings={watchablePrintings}
              />
            ) : null}
          </div>
          {!currentUser && (
            <p
              style={{
                margin: '-4px 0 0',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              <Link
                href={`/sign-in?returnTo=${encodeURIComponent(`/card/${slugifyCardName(bundle.name)}`)}`}
                style={{ color: 'var(--text-muted)' }}
              >
                Sign in
              </Link>{' '}
              to add to collection or watchlist.
            </p>
          )}

          {/* Secondary affiliate CTA. Small size; long disclosure lives
              at the bottom of the page (EbayAffiliateDisclosure). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <EbayFindButton
              cardName={bundle.name}
              setName={heroCard.set?.name ?? null}
              setCode={heroCard.set?.code ?? null}
              collectorNumber={heroCard.card.collector_number ?? null}
              marketplace={marketplace}
              source="lorcana-card"
              size="sm"
              label={`Find ${bundle.name} on eBay`}
            />
          </div>

          <CardStatGrid gamedata={heroCard.gamedata} classifications={heroCard.gamedata.classifications} />

          {heroCard.gamedata.effectText && (
            <EffectText
              effectText={heroCard.gamedata.effectText}
              flavourText={heroCard.gamedata.flavourText}
            />
          )}
        </div>
      </div>

      <section style={{ marginTop: 40, display: 'grid', gap: 24 }}>
        <header>
          <div className="label-mono">Treatments</div>
          <h2 style={{ margin: '4px 0 6px' }}>
            Priced individually
          </h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55, maxWidth: 640 }}>
            Every treatment for {bundle.name} is its own priced entity.
            Rarer chase overprints (Enchanted, Iconic, Epic) surface first
            so the collector-relevant versions are never buried under the
            base rarity.
          </p>
        </header>

        {treatmentOrder.map((group) => (
          <div key={group.code} style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className={`treatment-badge treatment-badge--${group.code}`}>
                {group.label}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
                {group.entries.length} printing{group.entries.length === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
              gap: 12,
            }}>
              {group.entries.map(({ cardView, printingView }) => (
                <TreatmentPanel
                  key={printingView.printing.id}
                  cardView={cardView}
                  printingView={printingView}
                  linkToPrinting
                  currency={currency}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <AskLorcanaPanel
        cardId={heroCard.card.id}
        cardName={bundle.name}
        contextSummary={[
          `Name: ${bundle.name}`,
          heroCard.set?.name ? `Set: ${heroCard.set.name} (${heroCard.set.code?.toUpperCase() ?? ''})` : '',
          `Rarity: ${heroCard.rarity.label}`,
          heroCard.gamedata.inks.length ? `Ink${heroCard.gamedata.inks.length === 1 ? '' : 's'}: ${heroCard.gamedata.inks.join(', ')}` : '',
          typeof heroCard.gamedata.inkCost === 'number' ? `Ink cost: ${heroCard.gamedata.inkCost}` : '',
          typeof heroCard.gamedata.strength === 'number' ? `Strength: ${heroCard.gamedata.strength}` : '',
          typeof heroCard.gamedata.willpower === 'number' ? `Willpower: ${heroCard.gamedata.willpower}` : '',
          typeof heroCard.gamedata.lore === 'number' ? `Lore: ${heroCard.gamedata.lore}` : '',
          heroCard.gamedata.classifications?.length ? `Classifications: ${heroCard.gamedata.classifications.join(', ')}` : '',
          `Treatments: ${treatmentOrder.map((t) => t.label).join(', ')}`,
          `Total printings tracked: ${flat.length}`,
          cheapestPrice ? `Cheapest current retail: ${cheapestPrice.amount} ${cheapestPrice.currency}` : 'No live retail row.',
          dearestPrice && dearestPrice.amount !== cheapestPrice?.amount ? `Dearest current retail: ${dearestPrice.amount} ${dearestPrice.currency}` : '',
          heroCard.gamedata.effectText ? `Rules text: ${heroCard.gamedata.effectText}` : '',
        ].filter(Boolean).join('\n')}
        suggestions={[
          `What makes ${bundle.name} collectible?`,
          `What printings of ${bundle.name} exist?`,
          `How does ${bundle.name}'s current price compare with its other printings?`,
        ]}
      />

      <CardFaq title={`FAQ — ${bundle.name}`} entries={cardFaqEntries} />

      <CardInternalLinks
        cardName={bundle.name}
        moreFromSet={moreFromSet}
        otherCharacterCards={otherCharacterCards}
        sameRarity={sameRarityCards}
        sameInk={sameInkCards}
        setCode={heroCard.set?.code ?? null}
        setName={heroCard.set?.name ?? null}
        rarityLabel={heroCard.rarity.label !== 'Unknown' ? heroCard.rarity.label : null}
        primaryInk={primaryInk}
        isCharacter={isCharacter}
      />

      <EbayAffiliateDisclosure />
    </div>
  );
}

function pickHero(cards: LcCardView[]): LcCardView {
  const order: Record<string, number> = {
    enchanted: 9, en: 9,
    iconic: 8, ic: 8,
    epic: 7, ep: 7,
    legendary: 6, l: 6,
    'super rare': 5, sr: 5,
    rare: 4, r: 4,
    uncommon: 3, u: 3, uc: 3,
    common: 2, c: 2,
    promo: 1, p: 1,
  };
  const sorted = [...cards].sort((a, b) => {
    const av = order[(a.card.rarity ?? '').toLowerCase()] ?? 0;
    const bv = order[(b.card.rarity ?? '').toLowerCase()] ?? 0;
    return bv - av;
  });
  return sorted[0] ?? cards[0]!;
}

function groupByTreatment(
  entries: Array<{ cardView: LcCardView; printingView: LcPrintingView }>,
) {
  const out = new Map<
    LcPrintingView['treatment']['code'],
    Array<{ cardView: LcCardView; printingView: LcPrintingView }>
  >();
  for (const e of entries) {
    const key = e.printingView.treatment.code;
    const bucket = out.get(key);
    if (bucket) bucket.push(e);
    else out.set(key, [e]);
  }
  return out;
}

function Breadcrumbs({ name, setCode, setName }: { name: string; setCode?: string; setName?: string }) {
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
      <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</Link>
      <span aria-hidden>›</span>
      {setCode ? (
        <>
          <Link href="/browse" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Sets</Link>
          <span aria-hidden>›</span>
          <Link href={`/set/${encodeURIComponent(setCode.toLowerCase())}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
            {setName ?? setCode.toUpperCase()}
          </Link>
        </>
      ) : (
        <>
          <Link href="/cards/search" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Cards</Link>
        </>
      )}
      <span aria-hidden>›</span>
      <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{name}</span>
    </nav>
  );
}

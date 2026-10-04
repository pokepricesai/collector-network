import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@collector-network/auth';
import { getSetBundle } from '@/server/browse';
import { getSetMarketForLorcana } from '@/server/set-market';
import { getSetCompletionForCurrentUser } from '@/server/set-completion';
import {
  getRarityDistributionForSet,
  getFinishSplitForSet,
} from '@/server/discovery';
import { canonicalFor } from '@/lib/seo';
import { buildPrintingSlug } from '@/lib/lorcana/slug';
import { normaliseRarity } from '@/lib/lorcana/rarity';
import { toLcGamedata } from '@/lib/lorcana/gamedata';
import { pickCardImage } from '@/lib/lorcana/image';
import { SetMarketOverview } from '@/components/SetMarketOverview';
import EbayFindButton, { EbayAffiliateDisclosure } from '@/components/EbayFindButton';
import Faq from '@/components/Faq';
import { buildSetFaq } from '@/server/faq-set';
import { SetGridClient, type SetGridEntry } from '@/components/SetGridClient';
import RarityDistribution from '@/components/set/RarityDistribution';
import FinishSplitPanel from '@/components/set/FinishSplitPanel';
import ChaseCounts from '@/components/set/ChaseCounts';
import SetTaxonomyLinks from '@/components/set/SetTaxonomyLinks';
import { summariseSetTaxonomy } from '@/server/internal-links';
import { getPrintingsBySet, type TcgCard } from '@collector-network/database';
import { getLorcanaClient } from '@/server/client';
import { getLorcanaCurrency } from '@/lib/currency-server';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

// Lorcana set codes fall into three families (see
// docs/lorcana/data-audit.md §2):
//   * pure integers 1..13 — main-set boosters
//   * p1/p2/p3         — promo sets
//   * cp / c2          — Challenge promos
//   * d23              — D23 Collection
//   * dis              — EPCOT Festival of the Arts
//   * coconut / pd1 / cc1 — one-off products
function inferSetType(code: string): string {
  const c = code.toLowerCase();
  if (/^\d+$/.test(c)) return 'Main set';
  if (c.startsWith('p') && /^p\d+$/.test(c)) return 'Promo set';
  if (c === 'cp' || c === 'c2') return 'Challenge promo';
  if (c === 'd23') return 'D23 Collection';
  if (c === 'dis') return 'EPCOT collection';
  if (c === 'coconut') return 'Format Coconut';
  if (c === 'pd1') return 'Party Deck';
  if (c === 'cc1') return "Curator's Collection";
  return 'Set';
}

function formatReleased(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}

function pickHero(family: TcgCard[]): TcgCard {
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
  const sorted = [...family].sort((a, b) => {
    const av = order[(a.rarity ?? '').toLowerCase()] ?? 0;
    const bv = order[(b.rarity ?? '').toLowerCase()] ?? 0;
    if (av !== bv) return bv - av;
    return (a.collector_number ?? '').localeCompare(b.collector_number ?? '');
  });
  return sorted[0]!;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getSetBundle(slug);
  if (!bundle) return { title: 'Set not found' };
  const setLabel = bundle.set.name;
  return {
    title: `${setLabel}. Lorcana set value, chase cards and every printing`,
    description: `Complete Disney Lorcana ${setLabel} (${bundle.set.code.toUpperCase()}) set: card list, rarity mix, Enchanted / Iconic / Epic count, foil vs nonfoil value split and live retail on every printing.`,
    alternates: {
      canonical: canonicalFor(`/set/${encodeURIComponent(bundle.set.code.toLowerCase())}`),
    },
  };
}

function SetCompletionPanel({
  signedIn,
  completion,
  setCode,
  setName,
}: {
  signedIn: boolean;
  completion: { owned: number; total: number; missingSample: unknown[] } | null;
  setCode: string;
  setName: string;
}) {
  const panelStyle: React.CSSProperties = {
    padding: '14px 16px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    marginBottom: 20,
    display: 'grid',
    gap: 10,
  };
  if (!signedIn) {
    return (
      <div style={panelStyle}>
        <div className="label-mono">Your collection</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Sign in to track your collection on this set.
          </span>
          <Link
            href={`/sign-in?returnTo=${encodeURIComponent(`/set/${setCode.toLowerCase()}`)}`}
            className="btn btn-sm btn-primary"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }
  if (!completion || completion.total === 0) return null;
  const { owned, total, missingSample } = completion;
  const pct = Math.round((owned / Math.max(total, 1)) * 100);
  const missingCount = total - owned;
  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div className="label-mono">Your collection · {setName}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {missingCount > 0 ? `${missingCount} missing` : 'Complete'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 22, fontWeight: 800, color: 'var(--text-strong)' }}>
          {owned.toLocaleString()} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>/ {total.toLocaleString()}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{pct}% complete</div>
      </div>
      <div
        aria-hidden
        style={{
          height: 8,
          borderRadius: 999,
          background: 'var(--surface-inset, rgba(0,0,0,0.06))',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--accent-2, #6A43BE)',
            transition: 'width 200ms ease',
          }}
        />
      </div>
      {missingCount > 0 && missingSample.length > 0 && (
        <div style={{ fontSize: 12 }}>
          <Link
            href={`/collection?set=${encodeURIComponent(setCode.toLowerCase())}&missing=1`}
            style={{ color: 'var(--accent-2, #6A43BE)', textDecoration: 'none', fontWeight: 600 }}
          >
            See missing ({missingCount})
          </Link>
        </div>
      )}
    </div>
  );
}

export default async function SetPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const bundle = await getSetBundle(slug);
  if (!bundle) notFound();

  const { set, cards } = bundle;

  const byName = new Map<string, TcgCard[]>();
  for (const c of cards) {
    const bucket = byName.get(c.name);
    if (bucket) bucket.push(c);
    else byName.set(c.name, [c]);
  }
  const uniqueNames = [...byName.keys()].sort((a, b) => a.localeCompare(b));

  // Perf (2026-10-01): fetch user, currency, and ALL set printings in
  // one parallel wave. The printings result then feeds BOTH
  // getSetMarketForLorcana AND getFinishSplitForSet so we don't do
  // two near-identical SELECTs over tcg_printings per set page load.
  // getSetCompletionForCurrentUser is also handed the already-loaded
  // cards so it skips its internal `SELECT ... from tcg_cards where
  // set_id = ...` roundtrip.
  const supabaseForPrintings = getLorcanaClient();
  const [user, currency, setPrintings] = await Promise.all([
    getCurrentUser(),
    getLorcanaCurrency(),
    getPrintingsBySet(supabaseForPrintings, set.id).catch(() => []),
  ]);
  const [market, rarityRows, finishSplit, completion] = await Promise.all([
    getSetMarketForLorcana(set.id, cards, {
      topN: 5,
      currency,
      preloadedPrintings: setPrintings,
    }),
    getRarityDistributionForSet(set.id, cards),
    getFinishSplitForSet(cards, setPrintings),
    user
      ? getSetCompletionForCurrentUser({
          setId: set.id,
          preloadedCards: cards,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const rarityCounts: Record<string, number> = {};
  for (const c of cards) {
    const r = c.rarity ?? 'Unknown';
    rarityCounts[r] = (rarityCounts[r] ?? 0) + 1;
  }

  // In-memory taxonomy summary (characters / inks / rarities) — used
  // by SetTaxonomyLinks for the crawlable "Explore this set" block.
  const taxonomy = summariseSetTaxonomy(cards);

  // Build a per-card price lookup from EVERY priced hero tile returned
  // by getSetMarketForLorcana, not just mostValuable + cheapest. The
  // old code priced only the top 5 + bottom 5 cards (≤ 10 tiles) and
  // every other card in the set fell through to `null` — so the live
  // checklist displayed "no price" for 195+ cards per 215-tile set
  // even though tcg_market_prices_current has quotes for ~100% of them.
  const priceLookup = new Map<string, number>();
  for (const t of market.allPriced) priceLookup.set(t.cardId, t.priceUsd);

  const entries: SetGridEntry[] = uniqueNames.map((name) => {
    const family = byName.get(name)!;
    const hero = pickHero(family);
    const rarity = normaliseRarity(hero.rarity);
    const gamedata = toLcGamedata(hero.gamedata);
    const image = pickCardImage(hero.images, 'normal');
    const href = `/set/${encodeURIComponent(set.code.toLowerCase())}/card/${encodeURIComponent(buildPrintingSlug(hero.collector_number, hero.name))}`;
    return {
      name,
      href,
      collectorNumber: hero.collector_number,
      rarityLabel: rarity.label,
      rarityKey: (hero.rarity ?? '').toLowerCase(),
      treatmentCount: family.length,
      inks: gamedata.inks,
      imageUrl: image,
      priceUsd: priceLookup.get(hero.id) ?? null,
      priceCurrency: market.currency,
    };
  });

  const canonical = canonicalFor(`/set/${encodeURIComponent(set.code.toLowerCase())}`);
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: canonicalFor('/') },
      { '@type': 'ListItem', position: 2, name: 'Sets', item: canonicalFor('/browse') },
      { '@type': 'ListItem', position: 3, name: set.name, item: canonical },
    ],
  };
  const collectionLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${set.name}. Disney Lorcana`,
    url: canonical,
    hasPart: uniqueNames.slice(0, 100).map((name) => ({
      '@type': 'CreativeWork',
      name,
    })),
  };

  return (
    <div className="lc-container lc-section">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }}
      />

      <nav
        aria-label="Breadcrumb"
        style={{
          marginBottom: 14,
          fontSize: 13,
          color: 'var(--text-muted)',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        }}
      >
        <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</Link>
        <span aria-hidden>›</span>
        <Link href="/browse" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Sets</Link>
        <span aria-hidden>›</span>
        <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
          {set.code.toUpperCase()} · {set.name}
        </span>
      </nav>

      <header className="lc-page-hero" style={{ marginBottom: 20 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="label-mono">
            {set.code.toUpperCase()} · {inferSetType(set.code)}
          </div>
          <h1 style={{ margin: '4px 0 8px' }}>
            {set.name}
          </h1>
          <div style={{
            display: 'flex', gap: 18, flexWrap: 'wrap',
            fontSize: 14, color: 'var(--text-muted)',
          }}>
            <span><strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, monospace' }}>{uniqueNames.length.toLocaleString()}</strong> unique cards</span>
            <span><strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, monospace' }}>{cards.length.toLocaleString()}</strong> total variants</span>
            {market.pricedCount > 0 && (
              <span><strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, monospace' }}>{market.pricedCount.toLocaleString()}</strong> with {market.currency} retail</span>
            )}
            {set.released_at && <span>Released {formatReleased(set.released_at)}</span>}
          </div>
          {/* Prominent sealed-product CTA. We do not carry sealed
              market data ourselves, so this is deliberately framed
              as marketplace discovery, not a tracked value. */}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <EbayFindButton
              sealedSearchTerm={`Disney Lorcana ${set.name} sealed`}
              setName={set.name}
              setCode={set.code}
              source="lorcana-set-sealed"
              size="md"
              label={`Find sealed ${set.name} on eBay`}
            />
          </div>
        </div>
      </header>

      {cards.length === 0 ? (
        <div className="lc-panel" style={{
          textAlign: 'center', color: 'var(--text-muted)',
          borderStyle: 'dashed', borderColor: 'var(--border-strong)',
        }}>
          This set has no cards ingested yet.
        </div>
      ) : (
        <>
          <SetCompletionPanel
            signedIn={!!user}
            completion={completion}
            setCode={set.code}
            setName={set.name}
          />

          <SetMarketOverview market={market} setCode={set.code} setName={set.name} />

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
            gap: 16,
            marginBottom: 24,
          }}>
            <RarityDistribution rows={rarityRows} totalCards={cards.length} />
            <FinishSplitPanel split={finishSplit} />
          </div>

          <div style={{ marginBottom: 24 }}>
            <ChaseCounts counts={rarityCounts} setCode={set.code} />
          </div>

          <SetGridClient entries={entries} />

          <SetTaxonomyLinks
            characters={taxonomy.characters}
            inks={taxonomy.inks}
            rarities={taxonomy.rarities}
          />

          <Faq
            title={`FAQ , ${set.name}`}
            entries={buildSetFaq({
              set,
              cards: [...cards],
              market,
              uniqueNames,
              rarityCounts,
            })}
          />

          <EbayAffiliateDisclosure />
        </>
      )}
    </div>
  );
}

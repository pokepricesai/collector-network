import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSetBundle } from '@/server/browse';
import { getSetMarketForLorcana } from '@/server/set-market';
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
import EbayFindButton from '@/components/EbayFindButton';
import { SetGridClient, type SetGridEntry } from '@/components/SetGridClient';
import RarityDistribution from '@/components/set/RarityDistribution';
import FinishSplitPanel from '@/components/set/FinishSplitPanel';
import ChaseCounts from '@/components/set/ChaseCounts';
import type { TcgCard } from '@collector-network/database';

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
    title: `${setLabel} — Lorcana set value, chase cards and every printing`,
    description: `Complete Disney Lorcana ${setLabel} (${bundle.set.code.toUpperCase()}) set: card list, rarity mix, Enchanted / Iconic / Epic count, foil vs nonfoil value split and live retail on every printing.`,
    alternates: {
      canonical: canonicalFor(`/set/${encodeURIComponent(bundle.set.code.toLowerCase())}`),
    },
  };
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

  // Fetch market overview + rarity distribution + finish split in
  // parallel. Each is a small server helper — no shared client cost.
  const [market, rarityRows, finishSplit] = await Promise.all([
    getSetMarketForLorcana(set.id, cards, { topN: 5 }),
    getRarityDistributionForSet(set.id, cards),
    getFinishSplitForSet(cards),
  ]);

  const rarityCounts: Record<string, number> = {};
  for (const c of cards) {
    const r = c.rarity ?? 'Unknown';
    rarityCounts[r] = (rarityCounts[r] ?? 0) + 1;
  }

  const priceLookup = new Map<string, number>();
  for (const t of market.mostValuable) priceLookup.set(t.cardId, t.priceUsd);
  for (const t of market.cheapest) priceLookup.set(t.cardId, t.priceUsd);

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
    name: `${set.name} — Disney Lorcana`,
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
              <span><strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, monospace' }}>{market.pricedCount.toLocaleString()}</strong> with USD retail</span>
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
              disclose
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
        </>
      )}
    </div>
  );
}

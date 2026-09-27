import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSetBundle } from '@/server/browse';
import { getSetMarketForOp } from '@/server/set-market';
import { canonicalFor } from '@/lib/seo';
import { buildPrintingSlug } from '@/lib/onepiece/slug';
import { normaliseRarity } from '@/lib/onepiece/rarity';
import { toOpGamedata } from '@/lib/onepiece/gamedata';
import { pickCardImage } from '@/lib/onepiece/image';
import { SetMarketOverview } from '@/components/SetMarketOverview';
import { SetGridClient, type SetGridEntry } from '@/components/SetGridClient';
import type { TcgCard } from '@collector-network/database';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

// Inferred set-type label from the code prefix. Bandai/OP set codes
// follow a stable convention (OP = booster, EB = extra booster,
// ST = starter deck, PRB = "Best" reprint booster). Kept here rather
// than in shared metadata because tcg_sets.tcggraph_meta is empty
// for OP today — see docs/onepiece/data-audit.md.
function inferSetType(code: string): string {
  const c = code.toLowerCase();
  if (c.startsWith('op')) return 'Booster';
  if (c.startsWith('eb')) return 'Extra booster';
  if (c.startsWith('st')) return 'Starter deck';
  if (c.startsWith('prb')) return 'Best-of reprint';
  if (c === 'p' || c.startsWith('pr') || c === 'oppr') return 'Promo';
  return 'Set';
}

function formatReleased(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function pickHero(family: TcgCard[]): TcgCard {
  const order: Record<string, number> = {
    SEC: 6, secret: 6, 'secret rare': 6,
    SR: 5, 'super rare': 5,
    L: 4, leader: 4,
    R: 3, rare: 3,
    UC: 2, uncommon: 2,
    C: 1, common: 1,
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
    title: `${setLabel} — every card, treatment and market price`,
    description: `Complete One Piece ${setLabel} set (${bundle.set.code.toUpperCase()}). Every card, treatment, live retail price, set value and top-value chase cards.`,
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

  // Group logical cards by name so parallels / secret / treasure /
  // special variants sit together (matches how a collector actually
  // thinks about the set).
  const byName = new Map<string, TcgCard[]>();
  for (const c of cards) {
    const bucket = byName.get(c.name);
    if (bucket) bucket.push(c);
    else byName.set(c.name, [c]);
  }
  const uniqueNames = [...byName.keys()].sort((a, b) => a.localeCompare(b));

  // Market overview (server) — value + coverage + top-value +
  // cheapest. Movers are held back until the 7d honest window clears.
  const market = await getSetMarketForOp(set.id, cards, { topN: 5 });

  const priceLookup = new Map<string, number>(market.mostValuable.concat(market.cheapest).map((t) => [t.cardId, t.priceUsd]));
  // Broader price lookup from the full market fetch: reuse both lists.
  for (const t of market.mostValuable) priceLookup.set(t.cardId, t.priceUsd);
  for (const t of market.cheapest) priceLookup.set(t.cardId, t.priceUsd);

  const entries: SetGridEntry[] = uniqueNames.map((name) => {
    const family = byName.get(name)!;
    const hero = pickHero(family);
    const rarity = normaliseRarity(hero.rarity);
    const gamedata = toOpGamedata(hero.gamedata);
    const image = pickCardImage(hero.images, 'normal');
    const href = `/set/${encodeURIComponent(set.code.toLowerCase())}/card/${encodeURIComponent(buildPrintingSlug(hero.collector_number, hero.name))}`;
    return {
      name,
      href,
      collectorNumber: hero.collector_number,
      rarityLabel: rarity.label,
      rarityKey: (hero.rarity ?? '').toLowerCase(),
      treatmentCount: family.length,
      colours: gamedata.colours,
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
    name: `${set.name} — One Piece Card Game`,
    url: canonical,
    hasPart: uniqueNames.slice(0, 100).map((name) => ({
      '@type': 'CreativeWork',
      name,
    })),
  };

  return (
    <div style={{ padding: '32px 24px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }}
      />

      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
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
          <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</Link>
          <span aria-hidden>›</span>
          <Link href="/browse" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Sets</Link>
          <span aria-hidden>›</span>
          <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
            {set.code.toUpperCase()} — {set.name}
          </span>
        </nav>

        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
                {set.code.toUpperCase()} · {inferSetType(set.code)}
              </div>
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 'clamp(24px, 4.5vw, 30px)' }}>
              {set.name}
            </h1>
            <p
              style={{
                margin: 0,
                color: 'var(--text-muted)',
                fontSize: 14,
                lineHeight: 1.6,
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span>{uniqueNames.length.toLocaleString()} unique cards</span>
              {cards.length !== uniqueNames.length && (
                <span>{cards.length.toLocaleString()} priced printings</span>
              )}
              {market.pricedCount > 0 && (
                <span>{market.pricedCount.toLocaleString()} with USD retail</span>
              )}
              {set.released_at && <span>Released {formatReleased(set.released_at)}</span>}
            </p>
          </div>
        </header>

        {cards.length === 0 ? (
          <div
            style={{
              padding: '32px 24px',
              background: 'var(--surface)',
              border: '1px dashed var(--border-strong)',
              borderRadius: 16,
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            This set has no cards ingested yet.
          </div>
        ) : (
          <>
            <SetMarketOverview market={market} setCode={set.code} setName={set.name} />
            <SetGridClient entries={entries} />
          </>
        )}
      </div>
    </div>
  );
}

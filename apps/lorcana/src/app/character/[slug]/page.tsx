import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCharacterBySlug } from '../../../server/characters';
import { canonicalFor } from '../../../lib/seo';
import { slugifyCardName } from '../../../lib/lorcana/slug';
import { getLorcanaCurrency } from '../../../lib/currency-server';
import { CURRENCY_SOURCE_KEY, type LorcanaCurrency } from '../../../lib/currency';
import { getCurrentUser, createServerSupabase } from '@collector-network/auth';
import { getLorcanaClient } from '../../../server/client';
import { toLcGamedata } from '../../../lib/lorcana/gamedata';
import type { LcInk } from '../../../lib/lorcana/ink';
import {
  buildCharacterContent,
  buildCharacterFaq,
  type CharacterContentInput,
} from '../../../lib/character-content';
import { type CharacterTilePrinting } from '../../../components/character/CharacterTileAdd';
import CharacterVersionsGrid, {
  type CharacterVersionTileData,
} from '../../../components/character/CharacterVersionsGrid';

// /character/[slug] — every printing of a specific Lorcana character.
// Character key = base card name with " - Subtitle" stripped
// (see server/characters.ts). Version subtitle is preserved on the
// individual card tiles so collectors can pick the exact edition
// they own or want.
//
// Signed-in users see a collection-completion panel ("Your Elsa
// collection"); signed-out users see a sign-in CTA. The character
// also carries an "About X" editorial block (only populated when
// we're highly confident about the Disney facts; otherwise falls
// back to card-data-driven copy) and a deterministic FAQ with
// matching FAQPage JSON-LD.

export const revalidate = 3_600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCharacterBySlug(slug);
  if (!data) {
    return { title: 'Character not found', robots: { index: false, follow: true } };
  }
  const canonical = canonicalFor(`/character/${data.slug}`);
  return {
    title: `${data.name}: every Lorcana card, printing and price`,
    description: `Every Disney Lorcana card featuring ${data.name}. All versions, sets, rarities and inks with live retail and graded pricing. ${data.totalCards} card${data.totalCards === 1 ? '' : 's'} indexed.`,
    alternates: { canonical },
  };
}

interface CharacterCardPricing {
  /** Printings grouped by tcg_card_id, used by the tile Add control. */
  printingsByCard: Map<string, CharacterTilePrinting[]>;
  /** Cheapest native-source price per tcg_card_id, shown on the tile. */
  priceByCard: Map<string, number>;
  /** The single highest-priced version across the whole character —
   *  feeds the "About X" content block. */
  highest: { cardId: string; price: number } | null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchCharacterCardPricing(
  cardIds: readonly string[],
  currency: LorcanaCurrency,
): Promise<CharacterCardPricing> {
  const empty: CharacterCardPricing = {
    printingsByCard: new Map(),
    priceByCard: new Map(),
    highest: null,
  };
  if (cardIds.length === 0) return empty;

  const sb = getLorcanaClient();
  const source = CURRENCY_SOURCE_KEY[currency];

  // One chunked batch to pull every printing for every card on this
  // page — the character page tile needs the whole printing list so
  // the Add picker can show finish options without an N+1 round trip.
  const printingBatches = await Promise.all(
    chunk(cardIds, 100).map((batch) =>
      sb
        .from('tcg_printings')
        .select('id, tcg_card_id, finish')
        .in('tcg_card_id', batch as string[]),
    ),
  );
  const allPrintings: Array<{ id: string; tcg_card_id: string; finish: string | null }> = [];
  for (const r of printingBatches) {
    const rows = (r.data as typeof allPrintings | null) ?? [];
    allPrintings.push(...rows);
  }

  const printingsByCard = new Map<string, CharacterTilePrinting[]>();
  const cardByPrinting = new Map<string, string>();
  for (const p of allPrintings) {
    cardByPrinting.set(p.id, p.tcg_card_id);
    const bucket = printingsByCard.get(p.tcg_card_id) ?? [];
    bucket.push({ id: p.id, finish: p.finish ?? null });
    printingsByCard.set(p.tcg_card_id, bucket);
  }

  // One chunked batch of native-source prices across every printing.
  // Native-only — no FX conversion, no cross-currency fallback.
  const printingIds = [...cardByPrinting.keys()];
  if (printingIds.length === 0) {
    return { printingsByCard, priceByCard: new Map(), highest: null };
  }
  const priceBatches = await Promise.all(
    chunk(printingIds, 100).map((batch) =>
      sb
        .from('tcg_market_prices_current')
        .select('tcg_printing_id, price')
        .in('tcg_printing_id', batch)
        .eq('source', source)
        .eq('currency', currency)
        .not('price', 'is', null),
    ),
  );

  const priceByCard = new Map<string, number>();
  let highest: { cardId: string; price: number } | null = null;
  for (const r of priceBatches) {
    const rows = (r.data as Array<{ tcg_printing_id: string; price: number | string }> | null) ?? [];
    for (const row of rows) {
      const cardId = cardByPrinting.get(row.tcg_printing_id);
      if (!cardId) continue;
      const price = Number(row.price);
      if (!Number.isFinite(price)) continue;
      const prev = priceByCard.get(cardId);
      if (prev == null || price < prev) priceByCard.set(cardId, price);
      if (!highest || price > highest.price) highest = { cardId, price };
    }
  }

  return { printingsByCard, priceByCard, highest };
}

async function fetchOwnedCardIds(
  cardIds: readonly string[],
): Promise<Set<string>> {
  if (cardIds.length === 0) return new Set();
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Set();
  const { data, error } = await sb
    .from('lorcana_collection_items')
    .select('tcg_card_id')
    .in('tcg_card_id', cardIds as string[]);
  if (error) return new Set();
  const out = new Set<string>();
  for (const r of data ?? []) out.add((r as { tcg_card_id: string }).tcg_card_id);
  return out;
}

export default async function CharacterPage({ params }: Props) {
  const { slug } = await params;
  const [data, currency, user] = await Promise.all([
    getCharacterBySlug(slug),
    getLorcanaCurrency(),
    getCurrentUser(),
  ]);
  if (!data) notFound();

  const cardIds = data.versions.map((v) => v.card.id);
  const [ownedSet, pricing] = await Promise.all([
    user ? fetchOwnedCardIds(cardIds) : Promise.resolve(new Set<string>()),
    fetchCharacterCardPricing(cardIds, currency),
  ]);
  const highestPricedPair = pricing.highest;
  const returnPath = `/character/${data.slug}`;

  //  Build the Content + FAQ inputs. Only cite rarities present on
  //  real versions — never fabricate.
  const rarities = [
    ...new Set(data.versions.map((v) => v.rarity).filter((r): r is string => !!r)),
  ];
  const setNames = [
    ...new Set(data.versions.map((v) => v.set?.name).filter((s): s is string => !!s)),
  ];
  const hasEnchantedOrIconic = rarities.some((r) =>
    /enchanted|iconic/i.test(r),
  );
  const highestPricedVersion = highestPricedPair
    ? (() => {
        const v = data.versions.find((x) => x.card.id === highestPricedPair.cardId);
        if (!v) return null;
        return {
          fullName: v.card.name,
          subtitle: v.versionSubtitle,
          price: highestPricedPair.price,
          currency,
          rarity: v.rarity,
        };
      })()
    : null;

  const contentInput: CharacterContentInput = {
    characterName: data.name,
    slug: data.slug,
    versionCount: data.totalCards,
    inks: data.inks as LcInk[],
    setNames,
    raritiesPresent: rarities,
    hasEnchantedOrIconic,
    highestPricedVersion,
  };
  const content = buildCharacterContent(contentInput);
  const faq = buildCharacterFaq({
    ...contentInput,
    currency,
    characterUrl: canonicalFor(`/character/${data.slug}`),
  });

  //  Completion math (signed-in only).
  const owned = ownedSet.size;
  const total = cardIds.length;
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;

  //  FAQ JSON-LD must match the visible FAQ exactly.
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: { '@type': 'Answer', text: e.a },
    })),
  };

  //  Sets grouped for linking.
  const setLinks = [
    ...new Map(
      data.versions
        .map((v) => v.set)
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => [s.code, s]),
    ).values(),
  ];

  //  Serialisable tile data for the client-rendered versions grid.
  //  Everything is pre-derived here so the browser bundle only does
  //  compare/sort math, never DB work.
  const versionTiles: CharacterVersionTileData[] = data.versions.map((v) => {
    const printings = (pricing.printingsByCard.get(v.card.id) ?? []) as CharacterTilePrinting[];
    const price = pricing.priceByCard.get(v.card.id) ?? null;
    return {
      cardId: v.card.id,
      cardName: v.card.name,
      cardSlug: slugifyCardName(v.card.name),
      subtitle: v.versionSubtitle,
      setCode: v.set?.code ?? null,
      setName: v.set?.name ?? null,
      releasedAt: v.set?.released_at ?? null,
      collectorNumber: v.card.collector_number ?? null,
      rarity: v.rarity,
      ink: v.ink,
      image: v.image,
      isOwned: ownedSet.has(v.card.id),
      price,
      priceSourceLabel:
        CURRENCY_SOURCE_KEY[currency] === 'tcggraph.tcgplayer' ? 'TCGPlayer' : 'Cardmarket',
      printings,
    };
  });

  const availableSets = [
    ...new Map(
      versionTiles
        .filter((t) => !!t.setCode)
        .map((t) => [t.setCode!, { value: t.setCode!, label: t.setName ?? t.setCode!.toUpperCase() }]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const availableInks = [...new Set(versionTiles.map((t) => t.ink).filter((x): x is string => !!x))]
    .sort((a, b) => a.localeCompare(b))
    .map((v) => ({ value: v, label: v }));
  const availableRarities = [
    ...new Set(versionTiles.map((t) => t.rarity).filter((x): x is string => !!x)),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((v) => ({ value: v, label: v }));

  return (
    <div className="lc-container lc-section">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />

      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 12 }}>
        <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</Link>
        <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>
        <Link href="/characters" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Characters</Link>
        <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>
        <span>{data.name}</span>
      </nav>

      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 32, margin: 0 }}>{data.name}</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
          {data.totalCards} Lorcana card{data.totalCards === 1 ? '' : 's'} featuring this character
          {data.inks.length > 0 ? ` · Inks: ${data.inks.join(', ')}` : ''}
        </p>
      </header>

      {/* Collection completion / sign-in CTA */}
      {user ? (
        <section
          style={{
            padding: 16,
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface)',
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Your {data.name} collection</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {owned} / {total} cards owned · {pct}% complete
              {owned < total && (
                <>
                  {' '}· {total - owned} missing
                </>
              )}
            </div>
          </div>
          <div
            aria-hidden
            style={{
              marginTop: 10,
              height: 10,
              borderRadius: 999,
              background: 'var(--bg-light, rgba(0,0,0,0.06))',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: 'var(--primary, #6A43BE)',
                transition: 'width 240ms ease',
              }}
            />
          </div>
          {owned < total && (
            <p style={{ margin: '10px 0 0', fontSize: 13 }}>
              <a href="#missing" style={{ color: 'var(--primary)' }}>
                Show missing cards ({total - owned})
              </a>
            </p>
          )}
        </section>
      ) : (
        <section
          style={{
            padding: 16,
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface)',
            marginBottom: 24,
          }}
        >
          <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Track your {data.name} collection</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--text-muted)', fontSize: 13 }}>
            Sign in to see which {data.name} cards you own and which you're still chasing.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link
              href={`/sign-up?returnTo=/character/${data.slug}`}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                background: 'var(--primary, #6A43BE)',
                color: '#fff',
                textDecoration: 'none',
                fontSize: 13.5,
                fontWeight: 700,
              }}
            >
              Create free account
            </Link>
            <Link
              href={`/sign-in?returnTo=/character/${data.slug}`}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                color: 'var(--text)',
                textDecoration: 'none',
                fontSize: 13.5,
                fontWeight: 700,
              }}
            >
              Sign in
            </Link>
          </div>
        </section>
      )}

      {/* About X */}
      <section
        style={{
          padding: 20,
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'var(--surface)',
          marginBottom: 24,
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>About {data.name}</h2>
        <p style={{ margin: '0 0 10px', lineHeight: 1.55 }}>{content.introParagraph}</p>
        <p style={{ margin: '0 0 10px', lineHeight: 1.55, color: 'var(--text-muted)' }}>
          {content.cardSummary}
        </p>
        {content.highestValueLine && (
          <p style={{ margin: 0, lineHeight: 1.55, color: 'var(--text-muted)' }}>
            {content.highestValueLine}
          </p>
        )}
      </section>

      {/* Versions grid with ownership state + search / filter / sort */}
      <section style={{ marginBottom: 32 }}>
        <CharacterVersionsGrid
          tiles={versionTiles}
          currency={currency}
          isSignedIn={Boolean(user)}
          returnPath={returnPath}
          availableSets={availableSets}
          availableInks={availableInks}
          availableRarities={availableRarities}
        />
      </section>

      {/* FAQ */}
      <section
        style={{
          padding: 20,
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'var(--surface)',
          marginBottom: 24,
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>FAQ · {data.name}</h2>
        <dl style={{ margin: 0 }}>
          {faq.map((entry, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <dt style={{ fontWeight: 700, marginBottom: 4 }}>{entry.q}</dt>
              <dd style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                {entry.a}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Related links */}
      <section
        style={{
          padding: 20,
          border: '1px solid var(--border)',
          borderRadius: 12,
          background: 'var(--surface)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Related</h2>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, fontSize: 14 }}>
          <li><Link href="/characters">All Lorcana characters</Link></li>
          {setLinks.map((s) => (
            <li key={s.code}>
              <Link href={`/set/${s.code.toLowerCase()}`}>{s.name ?? s.code.toUpperCase()}</Link>
            </li>
          ))}
          {data.inks.map((ink) => (
            <li key={ink}>
              <Link href={`/inks/${ink.toLowerCase()}`}>All {ink} cards</Link>
            </li>
          ))}
          <li><Link href="/card-finder">Card Finder</Link></li>
          <li><Link href="/browse">Every Lorcana set</Link></li>
        </ul>
      </section>
    </div>
  );
}

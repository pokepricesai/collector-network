import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/Header';
import { Footer } from '../../../components/Footer';
import { siteUrl } from '../../../lib/site-url';
import { findYgoArticle, YGO_ARTICLES, type YgoArticleMeta } from '../../../lib/articles';
import { safe } from '../../../server/safe';
import { loadMostValuableRetail, type MostValuablePrinting } from '../../../server/homepage';
import { getYugiohClient } from '../../../server/read';
import { findNetworkArticle, renderMarkdownToHtml } from '../../../server/network-articles';

const SITE_URL = siteUrl();

export const revalidate = 1800;

export function generateStaticParams() {
  return YGO_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = findYgoArticle(slug);
  const canonical = `${SITE_URL}/insights/${slug}`;
  if (article) {
    return {
      title: article.title,
      description: article.description,
      alternates: { canonical },
      openGraph: {
        title: article.title, description: article.description,
        url: canonical, type: 'article',
        publishedTime: article.publishedIso, modifiedTime: article.updatedIso,
      },
    };
  }
  // Fall back to a Collector Network OS published article.
  const net = await findNetworkArticle(slug);
  if (!net) return { title: 'Article not found' };
  return {
    title: net.metaTitle ?? net.title,
    description: net.metaDescription ?? net.summary ?? undefined,
    alternates: { canonical },
    openGraph: {
      title: net.title, description: net.metaDescription ?? net.summary ?? undefined,
      url: canonical, type: 'article',
      publishedTime: net.publishedAt ?? undefined,
      modifiedTime: net.updatedAt,
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = findYgoArticle(slug);
  // When the slug isn't in the hardcoded registry, fall back to the
  // Collector Network OS published-article table. This is how
  // operator-approved content is served on the public site.
  const network = article ? null : await findNetworkArticle(slug);
  if (!article && !network) notFound();

  const canonical = `${SITE_URL}/insights/${slug}`;
  if (network) {
    const bodyHtml = renderMarkdownToHtml(network.bodyMarkdown ?? '');
    const netLd = {
      '@context': 'https://schema.org', '@type': 'Article',
      headline: network.title, description: network.summary ?? '',
      datePublished: network.publishedAt ?? undefined,
      dateModified: network.updatedAt,
      author: { '@type': 'Organization', name: network.author ?? 'YGOPrices' },
      publisher: { '@type': 'Organization', name: 'YGOPrices' },
      mainEntityOfPage: canonical,
    };
    return (
      <>
        <Header compactSearch />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(netLd) }} />
        <main style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px 64px' }}>
          <article>
            <header style={{ marginBottom: 20 }}>
              <h1 style={{ margin: '4px 0 6px', fontSize: 30, letterSpacing: '-0.01em' }}>{network.title}</h1>
              {network.summary && <p style={{ margin: 0, color: 'var(--ygo-text-muted, #6B7280)', fontSize: 15, lineHeight: 1.55 }}>{network.summary}</p>}
            </header>
            <div className="article-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          </article>
          <ExploreMore currentSlug={slug} />
          <nav style={{ marginTop: 32 }}>
            <Link href="/insights" style={{ fontSize: 13 }}>← All insights</Link>
          </nav>
        </main>
        <Footer />
      </>
    );
  }
  if (!article) notFound();

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    datePublished: article.publishedIso,
    dateModified: article.updatedIso,
    author: { '@type': 'Organization', name: 'YGOPrices' },
    publisher: { '@type': 'Organization', name: 'YGOPrices' },
    mainEntityOfPage: canonical,
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Insights', item: `${SITE_URL}/insights` },
      { '@type': 'ListItem', position: 3, name: article.title, item: canonical },
    ],
  };

  let body: React.ReactNode = null;
  if (slug === 'most-valuable-yugioh-cards') {
    body = await MostValuableBody();
  } else if (slug === 'yugioh-rarities-explained') {
    body = <RaritiesBody />;
  } else if (slug === 'yugioh-collecting-guide-sets-editions-rarities-prices') {
    body = <CollectingBody />;
  }

  return (
    <>
      <Header compactSearch />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <main style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 80px' }}>
        <nav aria-label="Breadcrumb" style={{
          marginBottom: 12, fontSize: 13,
          color: 'var(--ygo-text-muted, #6B7280)',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>Home</Link>
          <span aria-hidden>›</span>
          <Link href="/insights" style={{ color: 'inherit', textDecoration: 'none' }}>Insights</Link>
          <span aria-hidden>›</span>
          <span style={{ color: 'var(--ygo-text-strong, #111827)', fontWeight: 600 }}>{article.title}</span>
        </nav>

        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: 'var(--ygo-accent-gold-strong, #B78A0F)',
        }}>{article.category}</div>
        <h1 style={{ margin: '4px 0 8px', fontSize: 34, lineHeight: 1.15, letterSpacing: '-0.01em' }}>
          {article.title}
        </h1>
        <p style={{ margin: 0, color: 'var(--ygo-text-muted, #6B7280)', fontSize: 13 }}>
          Published {fmt(article.publishedIso)}
          {article.updatedIso !== article.publishedIso && ` · Updated ${fmt(article.updatedIso)}`}
          {' · '}{article.readingMinutes} min read
        </p>

        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 8,
          background: 'var(--ygo-bg-light, #F9FAFB)',
          fontSize: 12, color: 'var(--ygo-text-muted, #6B7280)',
          border: '1px solid var(--ygo-border, #E5E7EB)',
        }}>
          Live prices in this article come from the daily production
          feed (TCGplayer USD and Cardmarket EU) and can shift
          between visits. If a specific number matters to you, open
          the linked card page for the current value.
        </div>

        <article style={{ marginTop: 24, fontSize: 15, lineHeight: 1.7, color: 'var(--ygo-text, #111827)' }}>
          {body}
        </article>

        <ExploreMore currentSlug={slug} />

        <hr style={{ marginTop: 40, border: 'none', borderTop: '1px solid var(--ygo-border, #E5E7EB)' }} />
        <p style={{ marginTop: 16, color: 'var(--ygo-text-muted, #6B7280)', fontSize: 12, lineHeight: 1.6 }}>
          Prices are shown in USD (TCGplayer) or EUR (Cardmarket EU).
          YGOPrices never applies a hardcoded FX conversion.
          &quot;Find on eBay&quot; buttons across the site are
          affiliate links. YGOPrices may earn a commission at no
          additional cost to you.
        </p>
      </main>
      <Footer />
    </>
  );
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}

// ── Article bodies ────────────────────────────────────────────────

async function MostValuableBody() {
  // Pull the top 20 highest-priced live USD retail printings
  // directly, with the printing / card / set rows resolved. The
  // homepage caches the same shape at limit 8; this article wants
  // more depth so it calls the shared loader with limit 20.
  const payload = await safe('most-valuable-article-top20', () =>
    loadMostValuableRetail(getYugiohClient(), 20),
  );
  const topRetail: MostValuablePrinting[] = payload.ok ? payload.value : [];

  // Group by rarity for the primer section below. Normalise so
  // "Secret Rare" and "SECRET RARE" count as the same bucket.
  const byRarity = new Map<string, MostValuablePrinting[]>();
  for (const r of topRetail) {
    const key = (r.card?.rarity ?? 'Unknown').trim();
    const bucket = byRarity.get(key) ?? [];
    bucket.push(r);
    byRarity.set(key, bucket);
  }
  const rarityOrder = [...byRarity.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <>
      <p>
        What follows is the live top 20 highest-priced Yu-Gi-Oh! printings
        we currently index on TCGplayer USD, resolved against the same
        catalogue that powers every card page on YGOPrices. The ranking
        updates as retail moves; every row links to the full print
        history for that card.
      </p>

      <h2>Top 20 printings by live USD retail</h2>
      <p>
        Minimum price floor is $100 so the ranking reflects genuine chase
        copies, not generic staples. The table columns are deliberately
        narrow — collector number, set, rarity, and the current retail
        quote — because that is the information you need to decide whether
        a listing is worth clicking into.
      </p>
      {topRetail.length === 0 ? (
        <p style={{ color: 'var(--ygo-text-muted, #6B7280)' }}>
          Live retail data is refreshing. Check back in a moment or
          open <Link href="/market/most-valuable">/market/most-valuable</Link>.
        </p>
      ) : (
        <ol style={{ padding: 0, margin: '10px 0 20px', listStyle: 'none', display: 'grid', gap: 8 }}>
          {topRetail.map((entry, i) => {
            const name = entry.card?.name ?? 'Unknown';
            const setName = entry.set?.name ?? '';
            const setCode = entry.set?.code ?? '';
            const released = entry.set?.released_at;
            const year = released ? new Date(released).getUTCFullYear() : null;
            const rarity = entry.card?.rarity ?? '';
            const price = entry.quote.price;
            const currency = entry.quote.currency;
            const cardSlug = name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '');
            const priceStr = price != null
              ? `${currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `}${Math.round(price).toLocaleString('en-US')}`
              : '–';
            const key = entry.printing?.id ?? `${name}-${i}`;
            return (
              <li key={key}>
                <Link href={`/card/${cardSlug}`} style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '10px 14px', gap: 12,
                  background: 'var(--ygo-surface, #FFF)',
                  border: '1px solid var(--ygo-border, #E5E7EB)',
                  borderRadius: 10,
                  textDecoration: 'none', color: 'var(--ygo-text, #111827)',
                }}>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0, flex: 1 }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--ygo-text-muted, #6B7280)', flex: 'none' }}>
                      #{i + 1}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                      <span style={{ fontSize: 12, color: 'var(--ygo-text-muted, #6B7280)' }}>
                        {setName ? `${setName} ` : ''}{setCode && <code style={{ background: 'var(--ygo-bg-light, #F9FAFB)', padding: '0 4px', borderRadius: 3 }}>{setCode.toUpperCase()}</code>}
                        {year ? ` · ${year}` : ''}
                        {rarity ? ` · ${rarity}` : ''}
                      </span>
                    </span>
                  </span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 14, flex: 'none' }}>
                    {priceStr}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <h2>What each chase rarity actually means</h2>
      <p>
        Yu-Gi-Oh! prints the same card in a stack of different rarities,
        and the collector market treats each tier differently. The names
        below describe the printing treatment itself — the foil pattern,
        the foil distribution, the text/image colour layering — not the
        card&apos;s game text, which is identical to the common. Rarity
        is one of three axes on every printing; the other two are{' '}
        <Link href="/sets">set</Link> and edition (1st, Unlimited, Limited).
      </p>
      <RarityPrimer />

      <h2>Breakdown of the current top 20</h2>
      {rarityOrder.length === 0 ? (
        <p style={{ color: 'var(--ygo-text-muted, #6B7280)' }}>
          Breakdown appears once the live top-20 feed is available.
        </p>
      ) : (
        <ul style={{ margin: '10px 0 18px', paddingLeft: 20 }}>
          {rarityOrder.map(([rarity, items]) => {
            const topExample = items[0];
            const avg = items
              .map((x) => x.quote.price ?? 0)
              .filter((p) => p > 0)
              .reduce((s, p, _, a) => s + p / a.length, 0);
            const avgStr = avg > 0 ? `$${Math.round(avg).toLocaleString('en-US')}` : '–';
            return (
              <li key={rarity} style={{ marginBottom: 6, fontSize: 14, lineHeight: 1.6 }}>
                <strong>{rarity}</strong> — {items.length} of 20 ·
                avg live retail {avgStr}
                {topExample?.card?.name ? (
                  <> · top: <em>{topExample.card.name}</em>
                    {topExample.quote.price
                      ? ` ($${Math.round(topExample.quote.price).toLocaleString('en-US')})`
                      : ''}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <h2>Reading the ranking honestly</h2>
      <p>
        A listing price is not a confirmed sale. A single active TCGplayer
        listing at $2,000 may reflect one seller&apos;s ambition rather
        than the printing&apos;s realised value. YGOPrices ranks by the
        current live retail feed; treat the ordering as a live snapshot,
        not a confirmed floor. For history, open the card page and check
        the price-history chart; for graded observations, see{' '}
        <Link href="/market/graded">/market/graded</Link>.
      </p>

      <h2>Where to go from here</h2>
      <p>
        If you own one of the chase rarities above and are deciding
        whether to list, start on the card&apos;s own page — the sibling
        printings there show you how much premium 1st Edition commands
        over Unlimited for your specific card, and the graded section
        indicates whether PSA 10 copies move at a meaningful multiple.
        For raw sealed stock, the eBay affiliate button on each card
        page jumps to that card&apos;s active search.
      </p>
      <p>
        Related:{' '}
        <Link href="/insights/yugioh-rarities-explained">rarities explained</Link>{' '}
        ·{' '}
        <Link href="/forbidden-limited">current Forbidden &amp; Limited list</Link>{' '}
        ·{' '}
        <Link href="/market/most-valuable">/market/most-valuable</Link>.
      </p>
    </>
  );
}

// Short, specific primer. Explicitly NOT a filler FAQ — each entry is
// one sentence that tells the reader what the treatment actually is,
// not padding. Kept co-located with the article because it's wholly
// about collector-market framing, not catalogue data.
function RarityPrimer() {
  const entries: Array<{ label: string; blurb: string }> = [
    { label: 'Ultra Rare',           blurb: 'Gold foil card name + holographic image. Vintage LOB / MRD / MFC 1st Edition Ultra Rares are the backbone of the vintage top-of-market.' },
    { label: 'Secret Rare',          blurb: 'Diagonally striped parallel foil across name AND image. Standard chase treatment through modern sets; the premium rarity for most Blue-Eyes / Dark Magician reprints.' },
    { label: 'Prismatic Secret Rare', blurb: 'Secret Rare pattern on a holographic prism background. Appears almost exclusively in Japanese and promo print runs; one of the hardest tiers to find in English.' },
    { label: 'Ghost Rare',           blurb: 'White-on-white chrome treatment on the image, no colour. One per box in select 2007-onwards sets; the vintage-modern bridge tier that collectors prize for presentation.' },
    { label: 'Starlight Rare',       blurb: 'Introduced 2020. Full-art holographic treatment covering image + border. Pull rate roughly 1-in-72 packs; alt-arts of iconic monsters routinely clear four figures.' },
    { label: 'Quarter Century Secret Rare', blurb: 'Konami&apos;s 25th-anniversary chase rarity. Secret Rare pattern with a QC logo stamp. Short-printed in 2024-2025 anniversary sets.' },
    { label: '10000 Secret Rare',    blurb: 'Introduced for the 10000th card celebration. Even scarcer than QC Secret; typically limited to one hero chase per set.' },
    { label: 'Ultimate Rare',        blurb: 'Embossed relief on the image. Historically the "same-set alternative" to Ultra Rare; prices follow the base card but with a modest texture premium.' },
  ];
  return (
    <ul style={{ margin: '12px 0 18px', paddingLeft: 20 }}>
      {entries.map((e) => (
        <li key={e.label} style={{ marginBottom: 8, fontSize: 14, lineHeight: 1.6 }}>
          <strong>{e.label}.</strong> {e.blurb}
        </li>
      ))}
    </ul>
  );
}


function RaritiesBody() {
  return (
    <>
      <p>
        Rarity is one of three axes that define a Yu-Gi-Oh!
        printing. The other two are <strong>edition</strong> (1st
        Edition, Limited, Unlimited) and the <strong>set</strong>{' '}
        it appears in. Any one card can exist at multiple rarities
        across multiple sets. Understanding the vocabulary is the
        difference between paying $3 and $300 for what looks like
        the same card.
      </p>

      <h2>The base rarity ladder</h2>
      <ul>
        <li><strong>Common</strong>: no foil treatment. The bulk of any set.</li>
        <li><strong>Rare</strong>: silver-foil name.</li>
        <li><strong>Super Rare</strong>: holofoil illustration.</li>
        <li><strong>Ultra Rare</strong>: gold-foil name + holofoil illustration.</li>
        <li><strong>Secret Rare</strong>: full-card holofoil (&ldquo;etched&rdquo; appearance).</li>
      </ul>

      <h2>Chase rarities beyond Secret Rare</h2>
      <ul>
        <li><strong>Ultimate Rare</strong>: embossed relief on the artwork.</li>
        <li><strong>Ghost Rare</strong>: pale, ethereal foil with a lenticular effect.</li>
        <li>
          <strong>Starlight Rare</strong>: full-card starburst foil,
          typically 1 per box, introduced with{' '}
          <em>Rising Rampage</em>.
        </li>
        <li>
          <strong>Quarter Century Secret Rare</strong>: 
          anniversary chase foil in modern sets.
        </li>
        <li>
          <strong>Prismatic Secret Rare</strong>: layered holo
          treatment on early <em>Dark Duel Stories</em> and other
          promotional runs.
        </li>
        <li>
          <strong>10000 Secret Rare</strong>: special-issue
          chase rarity (e.g. <em>Ten Thousand Dragon</em>).
        </li>
      </ul>

      <h2>Product-specific and era-specific rarities</h2>
      <p>
        Yu-Gi-Oh! has more product-line rarities than most TCGs.
        Notable examples:
      </p>
      <ul>
        <li>
          <strong>Duel Terminal Parallel</strong> and{' '}
          <strong>Super Parallel</strong> rarities from the Duel
          Terminal arcade series.
        </li>
        <li>
          <strong>Collector&apos;s Rare</strong>: matte foil
          treatment introduced in modern World Premiere / OCG
          crossover sets.
        </li>
        <li>
          <strong>Platinum Secret Rare</strong>: platinum-toned
          foil variant.
        </li>
        <li>
          <strong>Normal Parallel Rare</strong>: legacy parallel
          treatment on early promotional card runs (e.g. Mattel
          Action Figure promo Elemental HEROes).
        </li>
      </ul>

      <h2>Rarity vs edition vs treatment</h2>
      <p>
        These three axes are independent. A <em>Secret Rare Blue-Eyes
        White Dragon 1st Edition English</em> and a <em>Secret Rare
        Blue-Eyes White Dragon Unlimited English</em> share a rarity
        but differ by edition, and their prices differ accordingly.
        Similarly, a <em>Ghost Rare</em> and a <em>Starlight Rare</em>
        of the same card are two separate printings. Never averaged
        together. YGOPrices tracks each printing as its own priced
        entity.
      </p>

      <p>
        For a live rarity directory across the whole catalogue, see{' '}
        <Link href="/rarities">/rarities</Link>. To filter Card Finder
        to a specific rarity, use the Rarity dropdown on{' '}
        <Link href="/card-finder">/card-finder</Link>.
      </p>
    </>
  );
}

function CollectingBody() {
  return (
    <>
      <p>
        Starting a Yu-Gi-Oh! collection can feel busy. The game
        has printed over 12,000 unique cards across three decades,
        every card can exist at multiple rarities and editions, and
        the modern release schedule ships new booster sets every few
        months. This guide is a short opinionated map of the
        territory using only real data we track.
      </p>

      <h2>Read a printing like this: set × rarity × edition × language</h2>
      <p>
        Every Yu-Gi-Oh! card you own is a printing, and every
        printing sits at the intersection of four properties:
      </p>
      <ul>
        <li>
          <strong>Set</strong>: the release the card came from.
          The three-letter prefix on the collector number
          (LOB-001, MRD-006, BLAR-EN061, …) tells you which.
        </li>
        <li>
          <strong>Rarity</strong>: Common, Rare, Super Rare, Ultra
          Rare, Secret Rare and the chase tiers.
        </li>
        <li>
          <strong>Edition</strong>: 1st Edition (marked
          &quot;1st Edition&quot; under the artwork), Unlimited (no
          marker), or Limited Edition (marked LE).
        </li>
        <li>
          <strong>Language</strong>: English, French, German,
          Italian, Spanish, Portuguese, Japanese, Korean, etc.
        </li>
      </ul>
      <p>
        Two copies of the same card that differ on any of these
        properties are separate printings. YGOPrices prices each
        printing independently.
      </p>

      <h2>Where to start collecting</h2>
      <p>
        Two straightforward paths:
      </p>
      <ol>
        <li>
          <strong>By archetype.</strong> Pick a Yu-Gi-Oh! archetype
          you love. Blue-Eyes, Dark Magician, Elemental HERO, Sky
          Striker, Salamangreat, Kashtira. And collect every
          reprint. Browse them at{' '}
          <Link href="/archetypes">/archetypes</Link>.
        </li>
        <li>
          <strong>By set.</strong> Complete a full set (or a
          rarity slice of one). <em>Legend of Blue-Eyes White
          Dragon</em> (LOB), <em>Metal Raiders</em> (MRD),{' '}
          <em>Magician&apos;s Force</em> (MFC) and{' '}
          <em>Invasion of Chaos</em> (IOC) are classic vintage
          targets. Browse every set at{' '}
          <Link href="/sets">/sets</Link>.
        </li>
      </ol>

      <h2>Chase rarities and what they cost</h2>
      <p>
        The chase ladder above the base rarities looks like this,
        cheapest first:
      </p>
      <ul>
        <li><strong>Ultimate Rare</strong>: embossed foil.</li>
        <li><strong>Ghost Rare</strong>: ethereal foil.</li>
        <li><strong>Starlight Rare</strong>: starburst foil.</li>
        <li><strong>Quarter Century Secret Rare</strong>: modern chase.</li>
        <li><strong>Prismatic Secret Rare</strong>: legacy promo chase.</li>
        <li><strong>10000 Secret Rare</strong>: event-tier chase.</li>
      </ul>
      <p>
        The full explainer is at{' '}
        <Link href="/insights/yugioh-rarities-explained">Rarities Explained</Link>.
      </p>

      <h2>How to shop honestly</h2>
      <p>
        For active cards, TCGplayer USD retail (via YGOPrices) is a
        reasonable live indicator. For chase copies, expect a
        premium over median asking prices, especially on graded
        slabs. YGOPrices shows raw retail and graded market values
        side by side on every card page. On any card page or
        printing page you can click the &quot;Find on eBay&quot;
        button to jump directly to a targeted search. That
        button is an affiliate link and YGOPrices may earn a
        commission at no additional cost to you.
      </p>

      <h2>Track what you own</h2>
      <p>
        A free YGOPrices account unlocks three tools: a{' '}
        <Link href="/collection">Collection</Link> tracker (save
        any exact printing with edition, condition and purchase
        price), a{' '}
        <Link href="/watchlist">Watchlist</Link> that surfaces
        7 / 30 / 90 day price moves on printings you flag, and a{' '}
        <Link href="/decks">Deck builder</Link> with a live
        legality engine that reads directly from the{' '}
        <Link href="/forbidden-limited">Forbidden &amp; Limited list</Link>.
        Row-Level Security scopes every read and write to your own
        account. Nobody else can see your holdings.
      </p>
    </>
  );
}

// CN-05A: pass link equity from editorial back into the catalogue
// and surface the other Yu-Gi-Oh! insights. The previous version
// of this page had zero outbound links to /set/, /card/ or
// sibling /insights/ URLs — Google therefore treated each article
// as a dead end. This block adds up to three sibling articles
// plus three evergreen catalogue entry points.
function ExploreMore({ currentSlug }: { currentSlug: string }) {
  const siblings: YgoArticleMeta[] = YGO_ARTICLES.filter((a) => a.slug !== currentSlug).slice(0, 3);
  const links: Array<{ href: string; label: string; sub: string }> = [
    { href: '/sets', label: 'All Yu-Gi-Oh! sets', sub: '661 sets, newest first' },
    { href: '/archetypes', label: 'Archetypes', sub: 'Browse by deck archetype' },
    { href: '/forbidden-limited', label: 'Forbidden & Limited list', sub: 'Current TCG + OCG restrictions' },
  ];
  return (
    <section aria-labelledby="explore-more-heading" style={{
      marginTop: 32, paddingTop: 24,
      borderTop: '1px solid var(--ygo-border, #E5E7EB)',
    }}>
      <h2 id="explore-more-heading" style={{
        margin: '0 0 12px', fontSize: 16, letterSpacing: '-0.01em',
      }}>Explore more on YGOPrices</h2>

      {siblings.length > 0 && (
        <div style={{
          display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          marginBottom: 14,
        }}>
          {siblings.map((a) => (
            <Link key={a.slug} href={`/insights/${a.slug}`} style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--ygo-bg-light, #F9FAFB)',
              border: '1px solid var(--ygo-border, #E5E7EB)',
              textDecoration: 'none', color: 'inherit',
            }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ygo-text-muted, #6B7280)' }}>{a.category}</span>
              <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{a.title}</span>
              <span style={{ fontSize: 12, color: 'var(--ygo-text-muted, #6B7280)', lineHeight: 1.4 }}>{a.excerpt}</span>
            </Link>
          ))}
        </div>
      )}

      <div style={{
        display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      }}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} style={{
            display: 'flex', flexDirection: 'column', gap: 2,
            padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--ygo-border, #E5E7EB)',
            textDecoration: 'none', color: 'inherit',
          }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{l.label} →</span>
            <span style={{ fontSize: 11, color: 'var(--ygo-text-muted, #6B7280)' }}>{l.sub}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

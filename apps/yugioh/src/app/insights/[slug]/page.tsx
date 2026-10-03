import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/Header';
import { Footer } from '../../../components/Footer';
import { siteUrl } from '../../../lib/site-url';
import { findYgoArticle, YGO_ARTICLES } from '../../../lib/articles';
import { safe } from '../../../server/safe';
import { getYugiohHomepageData } from '../../../server/homepage';
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
  const payload = await safe('most-valuable-article-homepage', () => getYugiohHomepageData());
  const topRetail = payload.ok ? payload.value.mostValuable.slice(0, 8) : [];

  return (
    <>
      <p>
        The Yu-Gi-Oh! Trading Card Game has one of the deepest
        vintage markets of any TCG. Chase copies of early
        <em> Legend of Blue-Eyes White Dragon</em> Ultra Rares,
        Prismatic Secret Rares from{' '}
        <em>Dark Duel Stories</em> promo runs, and modern chase
        rarities like <em>Quarter Century Secret Rare</em>{' '}
        alt-arts routinely sit at four-figure retail. This piece
        walks through the current top of the market. Live-priced
        against the same feed the rest of YGOPrices uses.
      </p>

      <h2>Top-value printings right now (USD retail)</h2>
      <p>
        The eight dearest live TCGplayer USD listings across every
        indexed printing at the time of this article&apos;s update.
        Click any card for its full print history and per-printing
        pricing.
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
            const setCode = entry.set?.code ?? '';
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
                  alignItems: 'center', padding: '10px 14px',
                  background: 'var(--ygo-surface, #FFF)',
                  border: '1px solid var(--ygo-border, #E5E7EB)',
                  borderRadius: 10,
                  textDecoration: 'none', color: 'var(--ygo-text, #111827)',
                }}>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--ygo-text-muted, #6B7280)' }}>
                      #{i + 1}
                    </span>
                    <span>
                      <span style={{ fontWeight: 700 }}>{name}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--ygo-text-muted, #6B7280)' }}>
                        {setCode.toUpperCase()} · {rarity}
                      </span>
                    </span>
                  </span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 14 }}>
                    {priceStr}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <h2>Why the vintage and modern chase both dominate</h2>
      <p>
        The Yu-Gi-Oh! top of the market splits roughly into two
        halves. The vintage side is anchored by early LOB / MRD /
        MFC Ultra Rares in 1st Edition English, plus the
        Prismatic Secret Rare promotional runs from GameBoy tie-in
        product. The modern side is driven by chase rarities that
        Konami has introduced deliberately as short-print collector
        pulls: Ghost Rare, Starlight Rare, Quarter Century Secret
        Rare, and 10000 Secret Rare from event/anniversary sets.
        Individual printings can sit above four figures in either
        half of the market.
      </p>

      <h2>Reading the ranking honestly</h2>
      <p>
        A listing price is not the same as a confirmed sale. A
        single active TCGplayer listing at $2,000 may reflect one
        seller&apos;s ambition rather than the printing&apos;s
        realised value. YGOPrices ranks by the current live retail
        feed; treat the ordering as a live snapshot, not a
        confirmed floor. For history, open the card page and check
        the price-history chart.
      </p>

      <p>
        For live top-of-market coverage, see{' '}
        <Link href="/market/most-valuable">/market/most-valuable</Link>{' '}
        (retail) and{' '}
        <Link href="/market/graded">/market/graded</Link>{' '}
        (slabbed observations).
      </p>
    </>
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

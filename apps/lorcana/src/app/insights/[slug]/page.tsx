import type { Metadata } from 'next';
import type React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canonicalFor, SITE_ORIGIN } from '@/lib/seo';
import { findArticle, LORCANA_ARTICLES } from '@/lib/insights';
import { getPricedTiles } from '@/server/discovery';
import { slugifyCardName } from '@/lib/lorcana/slug';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

export async function generateStaticParams() {
  return LORCANA_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = findArticle(slug);
  if (!article) return { title: 'Article not found · LorcanaPrices' };
  const canonical = canonicalFor(`/insights/${article.slug}`);
  return {
    title: article.metaTitle,
    description: article.metaDescription,
    alternates: { canonical },
    openGraph: {
      title: article.metaTitle,
      description: article.metaDescription,
      url: canonical,
      type: 'article',
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = findArticle(slug);
  if (!article) notFound();

  const canonical = canonicalFor(`/insights/${article.slug}`);
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.metaDescription,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: { '@type': 'Organization', name: 'LorcanaPrices' },
    publisher: { '@type': 'Organization', name: 'LorcanaPrices', url: SITE_ORIGIN },
    mainEntityOfPage: canonical,
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: canonicalFor('/') },
      { '@type': 'ListItem', position: 2, name: 'Insights', item: canonicalFor('/insights') },
      { '@type': 'ListItem', position: 3, name: article.title, item: canonical },
    ],
  };

  let body: React.ReactElement;
  switch (article.slug) {
    case 'most-valuable-disney-lorcana-cards':
      body = await MostValuableBody();
      break;
    case 'lorcana-rarities-explained':
      body = <RaritiesExplainedBody />;
      break;
    case 'lorcana-collecting-guide':
      body = <CollectingGuideBody />;
      break;
    default:
      notFound();
  }

  return (
    <article className="lc-container lc-section" style={{ maxWidth: 820 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <nav style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
        <Link href="/insights" style={{ color: 'inherit', textDecoration: 'none' }}>← Insights</Link>
      </nav>
      <header style={{ marginBottom: 22 }}>
        <div className="label-mono" style={{ marginBottom: 8 }}>
          Published {new Date(article.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          {article.updatedAt !== article.publishedAt && ` · Updated ${new Date(article.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`}
        </div>
        <h1 className="lc-serif" style={{ margin: 0, fontSize: 34, lineHeight: 1.15, letterSpacing: '-0.01em' }}>
          {article.title}
        </h1>
        <p style={{ margin: '14px 0 0', color: 'var(--text-muted)', fontSize: 17, lineHeight: 1.6 }}>
          {article.description}
        </p>
      </header>
      {body}
      <hr style={{ margin: '32px 0', border: 'none', borderTop: '1px solid var(--border)' }} />
      <p style={{ fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
        <em>Disclaimer:</em> Live prices move continuously. Figures cited
        reflect the live Cardmarket EU retail feed at the time of the last
        page render. Not affiliated with Disney or Ravensburger.
      </p>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
// Article bodies. Each is hand-written; the most-valuable body is
// data-hydrated at request time from the same query the homepage uses.
// ─────────────────────────────────────────────────────────────

async function MostValuableBody(): Promise<React.ReactElement> {
  const top = await getPricedTiles({ limit: 10, cardCandidates: 3000 });
  return (
    <div style={{ fontSize: 17, lineHeight: 1.7 }}>
      <p>
        The Disney Lorcana market has matured fast. Three axes now drive
        secondary-market pricing: <strong>treatment</strong> (Enchanted, Iconic,
        Epic overprints in the replaced-common slot), <strong>rarity</strong>{' '}
        (Legendary is the base ceiling in a modern set; Iconic and Enchanted
        sit above it), and <strong>finish</strong> (foil sells at a premium
        over nonfoil for the same printing, sometimes several multiples in the
        top tiers).
      </p>
      <h2 style={{ marginTop: 28 }}>Live top ten</h2>
      <p>
        The list below is generated at page-render time from the same live
        Cardmarket EU retail feed powering the rest of the site. Prices are
        the current highest retail observation across the card&apos;s printings,
        deduplicated to one entry per card so a single card&apos;s foil version
        does not push the nonfoil off the board.
      </p>
      {top.length > 0 ? (
        <ol style={{ paddingLeft: 20, margin: '10px 0 24px' }}>
          {top.map((tile) => (
            <li key={tile.cardId} style={{ marginBottom: 10 }}>
              <Link href={`/card/${slugifyCardName(tile.name)}`} style={{ fontWeight: 700 }}>
                {tile.name}
              </Link>{' '}
              — {tile.priceEur ? `€${tile.priceEur.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${tile.priceUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
              {tile.rarity && ` · ${tile.rarity}`}
              {tile.finish && ` · ${tile.finish}`}
              {tile.setName && ` · ${tile.setName}`}
            </li>
          ))}
        </ol>
      ) : (
        <p><em>No priced rows yet — check back after the next data refresh.</em></p>
      )}
      <h2 style={{ marginTop: 28 }}>Why the top of this list is Enchanted-heavy</h2>
      <p>
        Enchanted overprints are pulled at roughly 1:432 in modern packs and
        replace a Common slot, so there is no way to open the set and reliably
        find one. Some Enchanted variants have iconic Disney characters —
        Elsa, Ariel, Mickey — with alternate art that is unique to that slot.
        That&apos;s why the top of any Lorcana value list is dominated by
        Enchanted cards from the earlier chapters.
      </p>
      <h2 style={{ marginTop: 28 }}>Iconic and Epic — the newer premium tier</h2>
      <p>
        Chapter 7 (<em>Archazia&apos;s Island</em>) introduced the Iconic tier;
        Chapter 8 (<em>Fabled</em>) added Epic. Both are premium overprints
        that layer heavy foil / decorative treatments on established cards.
        They currently price below top-tier Enchanted, but supply is smaller
        for the top variants and they&apos;re actively climbing.
      </p>
      <h2 style={{ marginTop: 28 }}>Where to see the raw data</h2>
      <p>
        Every card in the ranking links straight to its LorcanaPrices card
        page, where you can see every printing, finish and treatment priced
        individually with per-source attribution.
      </p>
      <p>
        Related pages:{' '}
        <Link href="/market/enchanted">Enchanted market</Link>,{' '}
        <Link href="/market/iconic">Iconic market</Link>,{' '}
        <Link href="/market">Lorcana movers</Link>.
      </p>
    </div>
  );
}

function RaritiesExplainedBody() {
  return (
    <div style={{ fontSize: 17, lineHeight: 1.7 }}>
      <p>
        Lorcana&apos;s rarity model has grown chapter by chapter. To read a
        card&apos;s price it helps to know where its rarity sits in that hierarchy,
        and — critically — how rarity differs from <em>treatment</em> and{' '}
        <em>finish</em>. All three combine to define a printing, and it&apos;s
        the printing, not the card, that has a price.
      </p>
      <h2 style={{ marginTop: 24 }}>Base rarity tiers</h2>
      <p>
        Every Lorcana card in a main set carries one of these base rarities,
        printed on the bottom-left of the card frame:
      </p>
      <ul style={{ paddingLeft: 20 }}>
        <li><strong>Common (C)</strong> — the largest slot in every pack.</li>
        <li><strong>Uncommon (UC)</strong> — three per pack.</li>
        <li><strong>Rare (R)</strong> — one per pack.</li>
        <li><strong>Super Rare (SR)</strong> — one per pack or occasionally shared with Rare.</li>
        <li><strong>Legendary (L)</strong> — the ceiling for a base rarity. Roughly 1:12 packs.</li>
      </ul>
      <h2 style={{ marginTop: 24 }}>Chase overprints — the collector tier</h2>
      <p>
        On top of the base tiers, Ravensburger has added dedicated chase
        treatments. These replace a Common slot in the pack — you never pull
        both a Common and an Enchanted from the same pack.
      </p>
      <ul style={{ paddingLeft: 20 }}>
        <li>
          <strong>Enchanted</strong> — every main set from Chapter 1 onward
          includes a small set of Enchanted overprints (roughly 1:432 packs).
          Unique alt art. Always foil. See the{' '}
          <Link href="/market/enchanted">live Enchanted market</Link>.
        </li>
        <li>
          <strong>Iconic</strong> — introduced in Chapter 7
          (<em>Archazia&apos;s Island</em>). Heavy foil treatment on marquee
          characters. Live tracking on the{' '}
          <Link href="/market/iconic">Iconic market</Link>.
        </li>
        <li>
          <strong>Epic</strong> — introduced in Chapter 8 (<em>Fabled</em>).
          A third premium tier above Legendary.
        </li>
        <li>
          <strong>Promo</strong> — event, league, D23 and preview prints.
          These live in dedicated promo sets (<code>p1</code>, <code>p2</code>,
          <code>d23</code>). Rare and often not tournament-legal.
        </li>
      </ul>
      <h2 style={{ marginTop: 24 }}>Rarity ≠ treatment ≠ finish</h2>
      <p>
        These three axes are independent:
      </p>
      <ul style={{ paddingLeft: 20 }}>
        <li>
          <strong>Rarity</strong> is a card-level property. It comes from the
          Ravensburger design brief.
        </li>
        <li>
          <strong>Treatment</strong> lifts a card into a chase tier. Enchanted /
          Iconic / Epic each occupy their own slot; a card that has an
          Enchanted printing also has an ordinary Legendary or Super Rare
          printing in the same set.
        </li>
        <li>
          <strong>Finish</strong> is either <em>foil</em> or <em>nonfoil</em>.
          Most cards exist in both. Foil sells at a premium, sometimes 2-5x
          for top rarities.
        </li>
      </ul>
      <p>
        LorcanaPrices tracks each combination separately. If a card has both
        a foil-Legendary printing and a foil-Enchanted printing, both appear on
        the card page with their own market price and price history.
      </p>
      <h2 style={{ marginTop: 24 }}>Which cards actually exist at each tier?</h2>
      <p>
        The{' '}
        <Link href="/card-finder?rarity=Enchanted">Enchanted card finder</Link>{' '}
        and{' '}
        <Link href="/card-finder?rarity=Iconic">Iconic card finder</Link>{' '}
        list every card at those rarities across the catalogue.{' '}
        <Link href="/inks">Ink browsing</Link> gives you the six ink colours
        as a discovery axis.
      </p>
      <p>
        Related reading:{' '}
        <Link href="/insights/lorcana-collecting-guide">Disney Lorcana Collecting Guide</Link>{' '}
        and{' '}
        <Link href="/insights/most-valuable-disney-lorcana-cards">The Most Valuable Disney Lorcana Cards</Link>.
      </p>
    </div>
  );
}

function CollectingGuideBody() {
  return (
    <div style={{ fontSize: 17, lineHeight: 1.7 }}>
      <p>
        Disney Lorcana is a fast game to learn and a slow game to collect
        properly. If you&apos;re new to the collector side, this guide covers the
        four things worth knowing before you start spending: the set
        structure, the difference between finish and treatment, the odds
        that actually matter, and where to read live prices.
      </p>
      <h2 style={{ marginTop: 24 }}>The set structure</h2>
      <p>
        Lorcana releases are numbered chapters. The main-set codes on
        LorcanaPrices use plain digits: <code>1</code>, <code>2</code>,
        <code>3</code> and so on, matching the Chapter number. Alongside
        those main sets, three families of supplementary sets exist:
      </p>
      <ul style={{ paddingLeft: 20 }}>
        <li><strong>Promo sets</strong> (<code>p1</code>, <code>p2</code>, …) — event and league prints, often with alt art. Not always tournament legal.</li>
        <li><strong>D23 Collection</strong> (<code>d23</code>) — the exclusive D23 print run.</li>
        <li><strong>Format Coconut</strong> (<code>coconut</code>) and other one-off products (<code>pd1</code>, <code>cp</code>, <code>cc1</code>) — small dedicated releases.</li>
      </ul>
      <p>
        You can walk the full catalogue on the{' '}
        <Link href="/browse">Sets browser</Link>. Each set page shows its
        release date, unique-card count and priced-value baseline.
      </p>
      <h2 style={{ marginTop: 24 }}>Finish vs treatment</h2>
      <p>
        This is the single most important distinction for pricing. Every
        printing has a <em>finish</em> (foil or nonfoil) and a{' '}
        <em>treatment</em> (a chase tier that overrides the base card, if
        any). The card page for any given card lists every printing across
        every finish and treatment separately, each with its own live
        price.
      </p>
      <p>
        Examples in production data: the same card can exist as{' '}
        <em>Nonfoil Legendary</em>, <em>Foil Legendary</em>,{' '}
        <em>Foil Enchanted</em>. These are three distinct printings with
        three distinct prices. LorcanaPrices never collapses them into a
        single number.
      </p>
      <p>
        We&apos;ve written a longer breakdown in{' '}
        <Link href="/insights/lorcana-rarities-explained">
          Disney Lorcana Rarities Explained
        </Link>.
      </p>
      <h2 style={{ marginTop: 24 }}>Odds that actually matter</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li>Enchanted overprints appear at roughly 1:432 packs. A booster box does not guarantee an Enchanted pull.</li>
        <li>Iconic (Chapter 7+) and Epic (Chapter 8+) sit at similar chase-rate ballparks in their respective sets.</li>
        <li>Regular Legendary is the base ceiling — expect ~1:12 packs.</li>
      </ul>
      <p>
        Sealed pack cost has risen over the life of the game, so the
        collector cost per Enchanted has climbed sharply. Live singles
        buys from cardmarket / eBay are often more efficient than pulling.
      </p>
      <h2 style={{ marginTop: 24 }}>How to read live prices on this site</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li>Every card page shows its full printing list with per-treatment prices.</li>
        <li>
          The{' '}
          <Link href="/market">Lorcana market page</Link> ranks the most
          valuable cards live. Filter to{' '}
          <Link href="/market/enchanted">Enchanted</Link> or{' '}
          <Link href="/market/iconic">Iconic</Link> to focus on the chase
          tiers.
        </li>
        <li>Prices refresh daily from Cardmarket EU. The current-price row updates within a few hours of the daily job.</li>
        <li>All prices are what the market currently asks. LorcanaPrices does not project future prices.</li>
      </ul>
      <h2 style={{ marginTop: 24 }}>Free tools for building a collection</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li><Link href="/sign-up">Create an account</Link> to track holdings by exact printing.</li>
        <li>Add raw or graded copies, foil or nonfoil, with quantity.</li>
        <li>See live valuation across your whole collection.</li>
        <li>No credit card required. No login needed just to browse.</li>
      </ul>
      <p>
        Related reading:{' '}
        <Link href="/insights/lorcana-rarities-explained">Rarities Explained</Link>{' '}
        and{' '}
        <Link href="/insights/most-valuable-disney-lorcana-cards">The Most Valuable Disney Lorcana Cards</Link>.
      </p>
    </div>
  );
}

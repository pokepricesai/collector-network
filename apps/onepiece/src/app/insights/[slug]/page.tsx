import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canonicalFor } from '@/lib/seo';
import { findArticle, OP_ARTICLES } from '@/lib/articles';
import { queryFinder } from '@/server/finder';
import { listSetsWithCounts } from '@/server/browse';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return OP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = findArticle(slug);
  if (!article) return { title: 'Article not found' };
  return {
    title: article.title,
    description: article.description,
    alternates: { canonical: canonicalFor(`/insights/${slug}`) },
    openGraph: {
      title: article.title,
      description: article.description,
      type: 'article',
      publishedTime: article.publishedIso,
      modifiedTime: article.updatedIso,
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

  const canonical = canonicalFor(`/insights/${slug}`);
  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    datePublished: article.publishedIso,
    dateModified: article.updatedIso,
    author: { '@type': 'Organization', name: 'OnePiecePrices' },
    publisher: { '@type': 'Organization', name: 'OnePiecePrices' },
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

  let body: React.ReactNode = null;
  if (slug === 'most-valuable-one-piece-cards') {
    body = await MostValuableBody();
  } else if (slug === 'rarities-and-parallels-explained') {
    body = <RaritiesBody />;
  } else if (slug === 'collecting-guide-sets-leaders-parallels-prices') {
    body = <CollectingGuideBody />;
  }

  return (
    <div style={{ padding: '32px 24px 80px' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <nav aria-label="Breadcrumb" style={{
          marginBottom: 12,
          fontSize: 13,
          color: 'var(--text-muted)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}>
          <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</Link>
          <span aria-hidden>›</span>
          <Link href="/insights" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Insights</Link>
          <span aria-hidden>›</span>
          <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{article.title}</span>
        </nav>

        <div className="label-mono" style={{ color: 'var(--gold-600)' }}>{article.category}</div>
        <h1 style={{ margin: '4px 0 8px', fontSize: 34, lineHeight: 1.15, letterSpacing: '-0.01em' }}>
          {article.title}
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Published {fmt(article.publishedIso)}
          {article.updatedIso !== article.publishedIso && ` · Updated ${fmt(article.updatedIso)}`}
          {' · '}{article.readingMinutes} min read
        </p>

        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 8,
          background: 'var(--bg-light)', fontSize: 12, color: 'var(--text-muted)',
          border: '1px solid var(--border)',
        }}>
          Live prices in this article come from the daily production feed
          (Cardmarket EU) and can shift between visits. If a specific
          number matters to you, open the linked card page for the current
          value.
        </div>

        <article style={{
          marginTop: 24,
          fontSize: 15,
          lineHeight: 1.7,
          color: 'var(--text)',
        }}>
          {body}
        </article>

        <hr style={{ marginTop: 40, border: 'none', borderTop: '1px solid var(--border)' }} />
        <p style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
          Prices are shown in EUR from the current live Cardmarket EU
          feed. OnePiecePrices never applies a hardcoded FX conversion.
          Any &quot;Find on eBay&quot; buttons elsewhere on the site are
          affiliate links — we may earn a commission at no cost to you.
        </p>
      </div>
    </div>
  );
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}

// ── Article bodies ───────────────────────────────────────────────

async function MostValuableBody() {
  const sets = await listSetsWithCounts();
  const setList = sets.map((s) => s.set);
  const [topLeaders, topSecrets, topTreasures] = await Promise.all([
    queryFinder({ cardType: 'leader', onlyPriced: true }, 'price-desc', 0, 5, setList),
    queryFinder({ rarity: 'SEC', onlyPriced: true }, 'price-desc', 0, 5, setList),
    queryFinder({ rarity: 'TR',  onlyPriced: true }, 'price-desc', 0, 5, setList),
  ]);

  return (
    <>
      <p>
        The One Piece Card Game hit shelves in mid-2022 and has since
        become one of the fastest-moving TCG markets in the world.
        Values are driven by three things: which <strong>Leader</strong>{' '}
        the card belongs to, which chase treatment (
        <em>Parallel</em>, <em>Secret Rare</em>, <em>Special Card</em>,{' '}
        <em>Treasure Rare</em>) it carries, and whether it&apos;s a
        marquee character. This piece walks through the current top of
        the market — live-priced against the same feed the rest of
        OnePiecePrices uses.
      </p>

      <h2>Top-value Leaders right now</h2>
      <p>
        Leaders anchor a One Piece deck. They also anchor the market —
        a Parallel print of a marquee Leader routinely outprices any
        Character in the same set. Below are the five dearest live
        Leader printings across the whole catalogue at the time of this
        article&apos;s update. Click any name for its full printing
        list.
      </p>
      <ArticleList tiles={topLeaders.tiles} />
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Full live list: <Link href="/leaders?sort=price-desc">/leaders</Link>.
      </p>

      <h2>Top-value Secret Rares</h2>
      <p>
        Secret Rares (rarity code <code>SEC</code>) are the standard
        chase tier — every booster set ships a handful, always in{' '}
        alternate-frame or holo treatments. The top Secret Rares hover
        in the hundreds of euros; a genuine mint copy can meaningfully
        outprice the box that produced it.
      </p>
      <ArticleList tiles={topSecrets.tiles} />

      <h2>Treasure Rares are a step above</h2>
      <p>
        Treasure Rares (<code>TR</code>) sit above Secret Rares — the
        rarest chase tier the base OP release schedule prints. Sets
        typically produce just a few Treasure Rares each, and their
        parallel treatments are the top of the whole market when they
        land.
      </p>
      <ArticleList tiles={topTreasures.tiles} />

      <h2>How to read the price gap</h2>
      <p>
        A base printing of Monkey.D.Luffy might cost a few euros; its
        Parallel from the same set costs orders of magnitude more. The
        gap tracks two things: how many copies of the Parallel were
        opened, and how many collectors treat that specific Leader as
        their deck&apos;s signature. Rare characters + a Parallel or
        Secret treatment = the market&apos;s top of the ladder.
      </p>
      <p>
        For a rolling view of who&apos;s moving today, see{' '}
        <Link href="/market">the movers board</Link>. To dig into
        Parallels for a specific character, open their logical card
        page (e.g. <Link href="/card/monkey-d-luffy">/card/monkey-d-luffy</Link>) —
        every treatment is listed with its live price.
      </p>
    </>
  );
}

function RaritiesBody() {
  return (
    <>
      <p>
        The One Piece Card Game uses two axes at once: a{' '}
        <strong>rarity code</strong> printed on the card, and a{' '}
        <strong>treatment</strong> — the physical finish and art
        variant. Understanding both is what separates a collector from
        a player. This guide sticks to what we ingest and display; we
        deliberately don&apos;t invent categories.
      </p>

      <h2>The rarity codes you&apos;ll see</h2>
      <ul>
        <li><strong>C</strong> — Common. The bulk of any set.</li>
        <li><strong>UC</strong> — Uncommon.</li>
        <li><strong>R</strong> — Rare.</li>
        <li><strong>SR</strong> — Super Rare. Above Rare; below chase.</li>
        <li><strong>L</strong> — Leader. A structural rarity — every
          deck must include exactly one Leader.</li>
        <li><strong>SEC</strong> — Secret Rare. The standard chase tier.</li>
        <li><strong>SP CARD</strong> — Special Card. Limited-run
          alternates (event promos, campaigns).</li>
        <li><strong>TR</strong> — Treasure Rare. The rarest chase tier
          in a booster set today.</li>
        <li><strong>P</strong> — Promo. Event, tournament and launch
          distribution.</li>
      </ul>

      <h2>Parallels and Reprints — the suffix system</h2>
      <p>
        Every printing has a <strong>collector number</strong> like{' '}
        <code>OP01-001</code>. When Bandai releases a variant of that
        same card, it appears with a suffix:
      </p>
      <ul>
        <li><code>OP01-001_p1</code> — Parallel print #1</li>
        <li><code>OP01-001_p2</code> — Parallel print #2</li>
        <li><code>OP01-001_p3</code>, and so on for further parallels</li>
        <li><code>OP01-001_r1</code> — Reprint (subsequent print run)</li>
      </ul>
      <p>
        A Parallel almost always uses an alternate frame or holo
        treatment. A Reprint is closer to the base card and usually
        prices lower. On OnePiecePrices these two are separate priced
        entities and never collapsed into the base.
      </p>

      <h2>Alt Art and Manga Rare — why we don&apos;t infer them</h2>
      <p>
        Collectors talk about <em>Alt Art</em> and{' '}
        <em>Manga Rare</em> printings all the time — and rightly so;
        they exist in the physical game. But the ingested data feed we
        use today does <strong>not</strong> tag either of those
        distinctly. If we labelled every <code>_p1</code> or{' '}
        <code>_p2</code> as an Alt Art or Manga Rare on that basis
        alone, we&apos;d be inventing a distinction the source data
        doesn&apos;t make. We refuse to do that. Every{' '}
        <code>_p#</code> variant is labelled &quot;Parallel&quot; here
        with its numeric fingerprint preserved. If the ingest gains a
        real Manga Rare signal, we&apos;ll surface it.
      </p>

      <h2>Set prefixes</h2>
      <p>
        The prefix on a card&apos;s collector number tells you the set
        family:
      </p>
      <ul>
        <li><code>OP##</code> — Booster Pack</li>
        <li><code>EB##</code> — Extra Booster</li>
        <li><code>ST##</code> — Starter Deck</li>
        <li><code>PRB##</code> — &quot;Best-of&quot; reprint booster</li>
      </ul>
      <p>
        For every set the catalogue holds, see{' '}
        <Link href="/browse">Sets</Link>.
      </p>

      <h2>Practical checkpoints for collectors</h2>
      <p>
        When you&apos;re buying a card, check three things: the
        rarity code (top-right on the card), the collector number and
        suffix (bottom), and the treatment. On OnePiecePrices, each
        card&apos;s logical page (e.g.{' '}
        <Link href="/card/monkey-d-luffy">/card/monkey-d-luffy</Link>)
        groups every treatment we&apos;ve seen so you can compare
        prices at a glance. For pure price-first browsing, use the{' '}
        <Link href="/card-finder">Card Finder</Link> with the rarity
        filter set to <code>SEC</code>, <code>TR</code> or{' '}
        <code>SP CARD</code>.
      </p>
    </>
  );
}

function CollectingGuideBody() {
  return (
    <>
      <p>
        Starting a One Piece Card Game collection can feel busy — new
        booster sets ship every few months, chase treatments compound
        fast, and Leader picks change the shape of everything. This
        guide is a short opinionated map of the territory using only
        real data we ingest.
      </p>

      <h2>Start with Leaders</h2>
      <p>
        Every deck has exactly one Leader, and Leaders define both the
        gameplay and the collection value. Because the Leader is what
        players build around, its <strong>Parallel</strong> printings
        are the most sought-after chase cards in any set. If you&apos;re
        buying a display case pull for someone, the Leader they play
        is where you look first. Browse them at{' '}
        <Link href="/leaders">/leaders</Link>.
      </p>

      <h2>Pick a colour and go deep</h2>
      <p>
        Six colours drive One Piece deckbuilding:{' '}
        <Link href="/colours/red">Red</Link>,{' '}
        <Link href="/colours/green">Green</Link>,{' '}
        <Link href="/colours/blue">Blue</Link>,{' '}
        <Link href="/colours/purple">Purple</Link>,{' '}
        <Link href="/colours/black">Black</Link> and{' '}
        <Link href="/colours/yellow">Yellow</Link>. Dual-colour Leaders
        (introduced later in the run) combine two of these. If you like
        the aggressive Straw Hats identity, Red is your anchor. If you
        want engine-heavy control, Blue and Purple pair up well. The
        colour landing pages show the top-value Leader and every card
        that carries that colour — a good filter to stay coherent.
      </p>

      <h2>Understand the set codes</h2>
      <p>
        <code>OP01</code> through <code>OP##</code> are the main
        booster line — one Leader-focused set every few months.{' '}
        <code>EB##</code> sets are Extra Boosters — smaller
        distribution around specific archetypes. <code>ST##</code> are
        Starter Decks; each one comes tuned around one Leader and is
        the cheapest way to start playing. <code>PRB01</code> is the
        &quot;Best of&quot; reprint booster — a curated remix of past
        chase treatments.
      </p>
      <p>
        See the full set directory at <Link href="/browse">/browse</Link>.
      </p>

      <h2>Chase treatments and what they cost</h2>
      <p>
        The chase ladder above the base rarities looks like:
      </p>
      <ul>
        <li><strong>Parallel</strong> — every set. Alt-frame / holo
          treatments of existing cards. The most common form of chase.</li>
        <li><strong>Super Rare (SR)</strong> — mid-tier rarity.</li>
        <li><strong>Secret Rare (SEC)</strong> — standard chase tier.
          Prices scale with the Leader.</li>
        <li><strong>Special Card (SP CARD)</strong> — event / limited
          run printings.</li>
        <li><strong>Treasure Rare (TR)</strong> — the rarest tier in a
          normal booster set today.</li>
      </ul>
      <p>
        On any card page, treatments are stacked chase-first so the
        top of the list is always the collector-interesting version.
      </p>

      <h2>Prices, honestly</h2>
      <p>
        Every price on the site comes from a daily Cardmarket EU
        (retail EUR) feed. We never silently convert currencies and
        never average two currencies into one price. If a card lists at
        &euro;120 here, that&apos;s the actual live listing floor from
        the source. For live movers see{' '}
        <Link href="/market">/market</Link>.
      </p>

      <h2>Where to start buying</h2>
      <p>
        If you&apos;re after singles, the &quot;Find on eBay&quot; button
        on every treatment panel opens a targeted eBay search that
        already has the exact card name, set code and treatment tokens
        in the query. On set pages there&apos;s also a{' '}
        &quot;Find sealed on eBay&quot; button — that one targets
        booster boxes and starter decks for the set. Both are affiliate
        links; OnePiecePrices may earn a commission at no cost to you.
      </p>

      <h2>Track what you own</h2>
      <p>
        A free OnePiecePrices account lets you save any exact printing
        to your collection — raw or graded, foil or nonfoil, with
        condition and purchase price. Live valuation runs on the same
        Cardmarket data as the rest of the site. Everything is
        Row-Level-Security-scoped so only you can see your holdings.{' '}
        <Link href="/sign-up">Create a free account</Link> to start.
      </p>
    </>
  );
}

// Reusable inline list of card tiles for the market article.
function ArticleList({ tiles }: {
  tiles: Awaited<ReturnType<typeof queryFinder>>['tiles'];
}) {
  if (tiles.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        No priced observations available at the moment. Refresh in a few
        minutes or check <Link href="/market">/market</Link>.
      </p>
    );
  }
  return (
    <ol style={{ padding: 0, margin: '10px 0 20px', listStyle: 'none', display: 'grid', gap: 8 }}>
      {tiles.map((t, i) => (
        <li key={t.cardId}>
          <Link href={t.href} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            textDecoration: 'none',
            color: 'var(--text)',
          }}>
            <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                #{i + 1}
              </span>
              <span>
                <span style={{ fontWeight: 700 }}>{t.name}</span>
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  {t.set?.code?.toUpperCase() ?? ''} · {t.collectorNumber ?? ''} · {t.rarity ?? ''}
                </span>
              </span>
            </span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 14 }}>
              {t.priceEur != null ? `€${t.priceEur.toFixed(2)}` : 'Unpriced'}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

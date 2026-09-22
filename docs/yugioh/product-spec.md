# Yu-Gi-Oh! product specification (Slice 2)

> **Status:** research + specification complete. No frontend built.
> Companion docs: [`research.md`](./research.md),
> [`competitors.md`](./competitors.md),
> [`data-gap.md`](./data-gap.md),
> [`seo-opportunities.md`](./seo-opportunities.md).
> **Snapshot date:** 2026-09-22.

## The one-sentence pitch

An exact-printing collector and market intelligence platform for the
Yu-Gi-Oh! TCG, with graded values treated as first-class alongside raw
prices and enough gameplay context to make competitive-relevance
decisions on the same page.

## A. Positioning — the strategic wedge

Yu-Gi-Oh! has excellent single-purpose sites:

- **Konami / Neuron** owns rulings, official card text, tournament ID.
- **YGOPRODeck** owns deckbuilding + a free open API.
- **TCGplayer / Cardmarket / eBay** own the transaction layer.
- **PriceCharting** owns cross-market graded pop reports.
- **Yugipedia / Yu-Gi-Oh! Meta** own reference and competitive coverage.

Nothing owns the collector-native "I have this exact physical card,
what is it, what's it worth, what's the graded market like, is it
competitively relevant, where do I buy another one" workflow. That is
our wedge.

Where MTGPrices earned the same wedge in Magic through **archetype-,
printing- and rarity-level clarity**, Yu-Gi-Oh! demands more emphasis
on:

1. **Rarity + edition disambiguation** (Yu-Gi-Oh!'s rarity taxonomy is
   larger and evolves faster than Magic's).
2. **Graded value** (Yu-Gi-Oh! graded volume is ~1.2M cards/year; graded
   is not a footnote).
3. **Reprint density** (staples are reprinted 10-40+ times each; the
   printing-comparison view is the killer object).

The public sites in this network share **infrastructure**, not
**product design**. This spec is Yu-Gi-Oh!-native — it does not describe
MTGPrices with a Yu-Gi-Oh! skin.

## B. Market and community map

Full breakdown in [`research.md`](./research.md) §1. Summary:

**Collectors** (the primary audience for V1):
- **Vintage collectors** (LOB/MRD/PSV era, 2002-2005 English printings)
- **1st Edition collectors** (era-agnostic; specifically hunt 1st Ed)
- **Graded/slab collectors** (PSA/CGC/BGS/SGC)
- **Rarity collectors** (Ghost Rare hunters, Starlight Rare hunters,
  Quarter Century Secret Rare completionists, Ultimate Rare completionists)
- **Set completionists** (per-set 1st Edition Ultra sets)
- **Nostalgia / anime collectors** (Blue-Eyes / Dark Magician / Exodia /
  Red-Eyes iconography)
- **Modern chase collectors** (whatever Konami's current top-rarity is —
  Starlight Rare as of mid-2025)
- **High-value single-card collectors** (Prize cards, one-of-one
  tournament promos)

**Players** (secondary audience for V1):
- **Competitive TCG players** (YCS attendees, regional grinders)
- **Locals players**
- **Casual players**
- **Archetype loyalists**
- **Deck builders**
- **Budget players**

**Adjacent formats and products** (deferred beyond V1):
- **OCG** — separate ecosystem, separate legality, separate print runs.
  Later.
- **Master Duel** — active competitive digital scene with 13k+ cards.
  Cross-link only in V1.
- **Speed Duel** — small product line. Skip.
- **Rush Duel** — Japan/Korea physical only. English via Duel Links only.
  Skip.

## C. Primary audience — V1 priority

**Primary (V1):** the collector-player crossover — someone who plays
casually or follows meta, but whose search behaviour is
value/collectibility-driven. They ask "what's this printing worth" more
often than "how do I build this deck." They own between 100 and 5,000
cards; they own at least one graded card; they routinely check
TCGplayer/Cardmarket before buying.

**Secondary (V1):** hardcore collectors — vintage, 1st Ed, rarity, graded.
Highest willingness to pay attention and share.

**Later (V1.5+):** competitive TCG players (need deck usage + rulings —
we won't out-YGOPRODeck YGOPRODeck in Slice 5). Master Duel players.
OCG-specific collectors.

**Why this order:** the collector-crossover audience is the biggest
underserved segment. Competitive players are well-served by YGOPRODeck
and Yu-Gi-Oh! Meta today; entering that segment requires deck-tracking
infrastructure we don't have and can't credibly build in V1. Vintage
collectors are extremely engaged and share content aggressively — a
strong graded/vintage angle drives outsized referral traffic.

## D. Physical printing model

**Every physical Yu-Gi-Oh! card is uniquely identified by the tuple:
`(set code, card number, rarity, edition, language)`.**

Two "Blue-Eyes White Dragons" printed in different sets, or in different
rarities within the same set, or as 1st Edition vs Unlimited, are legally
distinct collectibles. This is not optional — it drives the URL model,
the pricing model, the search model.

**Must appear prominently on a printing page:**
- Card name (the logical card the printing belongs to)
- Set name and set code prefix
- Card number within the set
- Rarity (with visual identifier explanation)
- Edition (1st Edition / Unlimited / Limited / Duel Terminal)
- Language / region (default English; explicit label for others)
- Foil / treatment (if the rarity has variants — e.g. Prismatic vs
  standard)
- Passcode (8-digit Konami ID, useful for external lookups)

**Full reference:** [`research.md`](./research.md) §3.

## E. Rarity system

Full taxonomy in [`research.md`](./research.md) §4. Product-relevant
summary:

**Must be filterable in V1** (rarity families with meaningful collector
volume, verified in circulation 2026):

Common, Rare, Super Rare, Ultra Rare, Ultimate Rare, Secret Rare, Ultra
Secret Rare, Prismatic Secret Rare, Ghost Rare, **Starlight Rare** (top
modern chase), Collector's Rare, **Prismatic Collector's Rare** (new
2026), **Prismatic Ultimate Rare** (new 2026), Platinum Secret Rare,
Quarter Century Secret Rare (retired 2026 but retains collector value),
Gold / Premium Gold / Gold Secret Rare, Parallel Rare family (Mosaic,
Shatterfoil, Starfoil, Pharaoh's Rare, Duel Terminal parallels).

**Must have dedicated discovery pages** (`/rarity/[slug]` + query
templates like `[card]-starlight-rare-price`):

Ghost Rare, Starlight Rare, Quarter Century Secret Rare, Ultimate Rare,
Collector's Rare, Prismatic Collector's Rare. These have the strongest
collector search intent and the largest price multiples.

**Non-obvious behaviour:**
- Rarity taxonomy evolves — new families appear every 2-3 years. Our
  schema must treat rarity as an extensible enum, not a hardcoded set.
- OCG and TCG diverge on rarity naming; if we ever ingest OCG we need a
  normalisation layer.
- Some "rarities" are technically variants of parents (Pharaoh's Rare is
  a Parallel Rare variant). Our display should surface the parent
  family for filter grouping.

## F. Edition / 1st Edition / Unlimited

**Full reference:** [`research.md`](./research.md) §3.

Key product implications:

- **Edition is a first-class field on printings**, not a variant. A
  printing page for `LOB-001 1st Edition` and `LOB-001 Unlimited` are
  **distinct URLs**.
- 1st Edition typically commands a 2-5× premium over Unlimited for the
  same rarity in the same set, with vintage LOB 1st Edition premium
  reaching 10-20×.
- Concrete example (Sept 2026): LOB-001 Blue-Eyes 1st Ed raw NM
  $800-$2000, Unlimited raw NM $50-$150. PSA 10 1st Ed $8000-$15000+.
- Marketplaces encode edition inconsistently (TCGplayer has a native
  filter; Cardmarket doesn't and relies on browser extensions). Our
  product treats it as authoritative structured data — a real
  differentiator vs Cardmarket.
- Language variants add another axis. English is V1 canonical.
  French/German/Italian/Spanish/Portuguese variants exist and are worth
  supporting when demand justifies it (V1.5 at earliest).
- Japanese OCG cards are **not TCG-legal** in Europe/NA — must be
  labelled explicitly if we ever show them.

## G. Production-data audit

Access to production Supabase is not yet legitimate from this repo
(credentials live in the external MTGPrices project). Formal audit
happens in Slice 3 with the read-only anon/staging path.

**Known counts (from parent brief):**
- 38,435 logical cards
- 86,141 printings
- 100,306 current market-price rows
- 236,942 graded-series rows
- 203,373 slab rows (individual graded units)
- 33,569 raw-series rows

**Slice 3 must sample these categories** to verify field coverage
against [`data-gap.md`](./data-gap.md):
- Blue-Eyes White Dragon (many printings, iconic)
- Dark Magician (many printings, iconic)
- Exodia pieces (5 cards, vintage core)
- A vintage LOB-era 1st Edition
- Corresponding Unlimited equivalents
- A Ghost Rare (Accesscode Talker or similar)
- An Ultimate Rare
- A Quarter Century Secret Rare (retired era)
- A Starlight Rare (top-current chase)
- A Prismatic Collector's Rare (Rarity Collection 5, 2026)
- A promo / Limited Edition
- A current-meta card (post-Sept 2026 F&L; likely a Sky Striker or
  Dracotail engine card)
- A card with extensive reprints (10+ printings)
- A cheap staple (Ash Blossom, common printings)
- A card with extensive slab pricing (LOB Blue-Eyes 1st Ed)

Do not connect to production Supabase in this slice. Do not copy
credentials from other repos.

## H. Graded card opportunity

Yu-Gi-Oh! grading volume in 2025 was ~15% of ~8M total TCG cards graded
(~1.2M YGO cards). PSA graded ~600k YGO cards in 2025 alone. CGC
launched Yu-Gi-Oh! grading (English 2002-present) and grew rapidly.

**Ideal card-page relationship between raw and graded:**

- Raw price is the default headline number on a printing page.
- **A graded strip sits directly beneath the raw price**, showing PSA
  and CGC (BGS/SGC if data exists) at grades 7 / 8 / 9 / 10 (plus 9.5
  for BGS) in one row.
- Toggle: "Show all grades" (5-10) for the deep-collector view.
- Population badge next to each grade: `PSA 10 · pop 148`. Zero-pop
  grades collapse.
- Historical chart tabs: `Raw` (default), `Graded — PSA 10`, `Graded —
  All`.
- On the logical-card page, a "Graded highlights" panel picks the
  highest-value graded-available printings across all printings, sorted
  by absolute graded value.

**Where to lean into graded above and beyond MTGPrices:**
- Vintage LOB 1st Edition — LOB-001, LOB-005 (Dark Magician),
  LOB-006-008 (Exodia arms/head/pieces)
- Ghost Rare — where graded is 60-80%+ of realised sale value
- Starlight Rare — modern chase market
- Iconic anime cards regardless of rarity (Blue-Eyes, Dark Magician,
  Red-Eyes, Exodia, Egyptian Gods, Kuriboh)

**Where graded matters less** and shouldn't dominate the layout:
- Modern common/rare staples
- Bulk cards
- Current meta staples where raw prices are >$5 and graded pop is trivial

## I. Competitor gaps — the workflows we win

Full analysis in [`competitors.md`](./competitors.md). Top 5 that shape
V1 design:

1. **"I have this exact card — what is it, what's it worth?"** —
   printing pages with raw + graded + F&L + game data on one screen.
2. **"How much more is the 1st Ed worth than the Unlimited?"** —
   printing-comparison view on every logical-card page.
3. **"Which printings have graded data?"** — per-printing pop badges +
   graded-highlights roll-up on the logical-card page.
4. **"Which cards from this set are worth the most right now?"** — live
   most-valuable-per-set widget, updated automatically.
5. **"What's a Ghost Rare / Starlight Rare / QCSR of this card worth?"**
   — rarity-scoped landing pages with real prices.

## J. Core differentiation — why us not X

Not "we combine everything" — three specific claims:

1. **Exact-printing native.** Our URLs and search treat printings as
   the primary object, not variants. TCGplayer does this for buying;
   nobody does it for the full card page.
2. **Graded is first-class.** Raw + graded on the same page, at the
   printing level, with population context. PriceCharting has the pop
   data but no card page; TCGplayer sells graded as separate listings
   with no context; nobody unifies.
3. **Rarity/edition clarity for the current 2026 taxonomy.** Rarity
   filters that include Prismatic Collector's Rare, Starlight Rare
   returning as apex, Quarter Century Secret Rare as a retired era. Our
   competitors either lag (Cardmarket has no native rarity filters at
   all) or treat rarity as text metadata rather than a first-class
   discovery axis.

## K. Yu-Gi-Oh! game data model

The frontend must expose (with correct Konami terminology; verified in
[`research.md`](./research.md) §2):

**Monster cards:**
- Attribute — LIGHT, DARK, FIRE, WATER, WIND, EARTH, DIVINE
- Type — 25 monster types (Warrior, Spellcaster, Dragon, Cyberse, Wyrm,
  etc.)
- Level (1-12) OR Rank (1-13, Xyz) OR Link Rating (1-6, Link)
- Pendulum Scale (0-13) when applicable
- ATK / DEF (Link monsters have no DEF)
- Effect / Normal / Ritual / Effect
- Extra Deck class — Fusion / Synchro / Xyz / Pendulum / Link
- Sub-classifications — Tuner, Flip, Toon, Spirit, Union, Gemini

**Spell cards:**
- Subtype — Normal, Continuous, Equip, Quick-Play, Field, Ritual

**Trap cards:**
- Subtype — Normal, Continuous, Counter

**Additional card-page objects:**
- Archetype(s) — often a card belongs to one or two
- Related cards — links to other cards mentioned by name in text
- Legality — current TCG F&L status
- Card passcode (8-digit ID printed on the card)

**Above the fold on the card page** (mobile-first thinking): card image,
name, ATK/DEF (if applicable), rarity/edition of the current printing,
raw price, graded strip, F&L badge.

**Lower on the card page**: full card text, effect explanation,
archetype membership, related cards, printings list, graded highlights,
price history.

## L. Archetype strategy

Archetypes should be a **first-class navigation item** — one of the top
5 things in the main nav. 620+ archetypes exist; not all deserve pages
on day one but the schema and URL space should support the full set.

**Ideal archetype page:**

- Header: archetype name + one-line description
- Members (grid of cards, sortable by price / rarity / release)
- Support cards (cards that reference the archetype but aren't members)
- Most valuable printings across the archetype (graded highlighted)
- F&L impact (any members Forbidden / Limited / Semi-Limited)
- Recent competitive representation (V1.5 — needs tournament data)
- Related archetypes
- Notable printings (alt-arts, promos, chase rarities)

**V1 approach:** archetype membership is derivable from YGOPRODeck's
free API (their `archetype` filter is authoritative). Ingest into a
`tcg_card_archetypes` relation table in Slice 3-4 timeframe. Do not
build archetype pages in V1 launch (Slice 6-7) — build them in a
follow-up slice once membership data is confirmed and there's editorial
capacity for archetype overview text (2-3 sentences per archetype).

**V1 fallback:** display archetype tags on card pages as inline text
badges linking to a search-results-style listing.

## M. Set / product strategy

Yu-Gi-Oh! has distinct product types beyond boosters — Structure Decks,
Starter Decks, Tins, Duelist Packs, Collector Boxes, Speed Duel Boxes,
Rarity Collections, Legendary Modern Decks, Championship / WCS prize
cards, Promo distributions (tournament participation, movie tie-ins,
sneak-peek promos).

**Main navigation object should be "Sets" as the shorthand, with
product-type filtering** — not "Sets & Products" (avoid three-word
nav). The set page itself must show product-type prominently so a user
looking at LDS3 (Legendary Duelists Season 3) knows it's a boxed
collector product, not a booster.

**Ideal set page:**

- Header: set name, set code prefix, product type, release date, total
  cards, rarity distribution
- Checklist (grid) with rarity filter
- Most-valuable-in-set (auto-refreshed)
- Notable rarities (e.g. "1 Starlight Rare, 3 Prismatic Collector's
  Rares, 24 Ultra Rares, 40 Super Rares…")
- 1st Edition / Unlimited split where applicable
- Link to booster-box completion cost estimate (V1.5)

## N. Card page specification

The Yu-Gi-Oh! card page has to answer, in order:

1. **What card is this?** (name, image, type-line, ATK/DEF)
2. **Which exact printing is this?** (set code, card number, rarity,
   edition, language, foil/treatment)
3. **What is this printing worth?** (raw price, condition band)
4. **What is it worth graded?** (PSA/CGC 7-10, populations)
5. **What other printings exist?** (comparison view)
6. **What does the card do?** (full text, effect)
7. **What archetype / deck context does it have?** (archetype badge,
   competitive-relevance signal)
8. **What is its legality status?** (F&L badge)
9. **Where can I buy it?** (affiliate links)

**Two page types:**

- `/card/[slug]` — the **logical card page**. Represents "Blue-Eyes
  White Dragon" as a concept. Aggregates all printings; the featured
  printing at top is either the original (LOB-001) or user-selected via
  a query param.
- `/card/[slug]/printing/[set-code]-[number]` — the **printing page**.
  Represents the exact physical card. Prices, graded, buy links are
  specific to this printing.

### Desktop information order

Two-column layout above the fold:

**Left column** (card visual, ~40% width):
- Large card image (with alt-art badge if applicable)
- Rarity + edition ribbon overlay
- "Other printings" chip: `+27 more`

**Right column** (identity + market, ~60% width):
- Card name, sub-title (e.g. "Normal Monster · Dragon · LIGHT · Level 8")
- ATK / DEF row
- Set + card number + rarity + edition (secondary line)
- Raw price (big) with condition selector
- Graded strip (PSA 7-10 + CGC 7-10)
- F&L badge (colour-coded)
- Buy buttons (TCGplayer / Cardmarket / eBay)

Below the fold:
- Full card text + effect
- Archetype badges + related cards
- **Printings comparison table** (see §O below)
- **Graded highlights** panel
- Historical price chart (raw + PSA 10 toggles)
- Ruling notes (V1.5)
- Recent competitive appearances (V1.5+)

### Mobile information order

Single column, ruthlessly prioritised:

1. Card image (full width)
2. Card name + rarity/edition ribbon
3. Raw price (big) + condition selector
4. Graded strip (compact — top 3 grades with a "see all" expander)
5. F&L badge
6. Buy buttons (sticky footer)
7. Set / card number / language line
8. Full card text (collapsible after 3 lines)
9. Attribute / Type / Level / ATK / DEF row
10. Archetype badge
11. "Other printings" — 3 cheapest / most expensive with an "all
    printings" link to a dedicated view
12. Historical price chart
13. Related cards

**Mobile principle:** the page should answer "what is this and what's
it worth" in the first viewport, and let a user tap through to
comparison views on a subsequent screen rather than scroll a massive
desktop layout on mobile.

## O. Other printings UX — the killer feature

Given Yu-Gi-Oh!'s reprint density (staples are printed 10-40+ times),
the printing-comparison view is **the** feature that no competitor does
well. Both a logical-card-page section and a dedicated
`/card/[slug]/printings` deep page are needed.

**Dimensions displayed** (columns in a wide table on desktop; card
grid with badges on mobile):

- Set (with product-type badge)
- Set code + card number
- Rarity (with icon + colour band)
- Edition
- Language (if not English, badged)
- Artwork (Original / Alt-art indicator)
- Year
- Raw price (near-mint band, current)
- Graded PSA 10 price (or "no data" collapsed indicator)
- Graded pop (aggregate PSA + CGC 10) — sortable
- Direct buy link

**User must be able to sort by:**
- Rarity (Common → Starlight, or reverse)
- Edition (1st Ed first)
- Price (asc / desc)
- Graded value (with N/A last)
- Year (chronological)

**Filter chips:**
- Rarity family (Common, Rare, Super Rare, Ultra Rare, Ultimate Rare,
  Secret family, Ghost, Starlight, Collector's, Quarter Century, Gold,
  Parallel)
- Edition (1st Ed only / Unlimited only / All)
- Language
- Product type (Booster / Structure Deck / Tin / Promo / …)
- Has graded data (yes/no)

**Every printing row is a link** to that printing's canonical URL —
this is the primary UX loop that drives our long-tail SEO.

## P. Search experience

The search bar is the front door.

**Query types:**

- Card name (`blue-eyes white dragon`, `blue eyes`, `bewd`)
- Partial name (`blue e`)
- Set code + card number (`LOB-001`, `LOB 001`, `LOB001`)
- Set name (`legend of blue eyes`)
- Archetype (`sky striker`, `snake-eye`)
- Rarity + card (`ghost rare accesscode`)
- Card number search (`LOB-001` should jump straight to the printing
  page, not a list)
- Passcode (8-digit) — jumps to the card

**Typo tolerance:** yes. `blu eyes` should return Blue-Eyes.

**Autocomplete behaviour:**
- Under 3 chars: recent + popular
- 3+ chars: fuzzy match on card name, then set names, then archetypes,
  then set-code prefixes
- Each suggestion has an inline rarity/set badge
- Enter jumps to top result if confidence ≥ some threshold; else
  results page

**Card number + set code search is critical** — this is how
users identify a physical card in their hand. Bake it into the
autocomplete grammar as a first-class match, not a fallback.

## Q. Homepage specification

Must be unmistakably Yu-Gi-Oh! within 2 seconds and answer "what is this
site for" within 5.

**Above the fold:**
- Site name / logo
- Global search bar (huge, prominent, autofocused)
- Tagline positioning us as a collector-first Yu-Gi-Oh! resource
- Nav

**Below the fold:**
- **Top movers** (biggest 24h/7d raw + graded price changes; toggle)
- **Iconic cards** panel — Blue-Eyes, Dark Magician, Red-Eyes, Exodia,
  Egyptian Gods (fixed set, links to logical card pages)
- **Latest sets** — most recent 4-6 with cover images
- **Vintage highlights** — best-known valuable printings, curated
- **Graded highlights** — top-value graded singles in circulation right
  now
- **Forbidden & Limited status** — the current F&L list summary + link
  to the full page. Fresh at every list update.
- **Top rarities** — one-tile-each Starlight Rare, Ghost Rare, QCSR,
  Prismatic Collector's Rare (each linking to their rarity page)
- **Recently released** — cards from the most recent sets
- Footer — legal, sitemap, about the network

**Do not include on the homepage:**
- Editorial articles (V1.5+)
- Master Duel meta (defer)
- Deck lists (out of scope)
- Multi-game switcher (each site has its own domain; the hub site is
  the multi-game entry point)

## R. Navigation / Information architecture

**Primary nav (V1, five items):**

1. **Cards** — search-first; drop-down of popular rarities /
   archetypes / attributes
2. **Sets** — chronological + product-type browse
3. **Archetypes** — searchable index (V1.5 for full pages; V1 for
   basic redirects)
4. **Market** — top movers, rarity leaderboards, graded highlights,
   most-valuable-per-set landing pages
5. **F&L** — current banlist + history

**Not in the primary nav:**
- Decks (out of scope V1)
- Collection (auth-gated V1.5)
- Articles (V1.5+)
- Rulings (V1.5+)

**Secondary nav / footer:**
- About
- Data sources
- Affiliate disclosure
- Network hub link (to `apps/hub` when it exists)
- Privacy / cookies

## S. Gameplay scope

**V1 (launch):**
- Card game data (attribute, type, level, ATK/DEF, effect text)
- Card sub-classifications
- Extra Deck classes with correct badges
- TCG F&L status per card (up-to-date)
- Archetype badges on card pages

**V1.5:**
- Archetype pages (with tournament-derived competitive representation)
- Deck usage counts (`played in X% of tournament decks last 30 days`)
- Rulings tab on card pages (curated from Konami's official DB)

**Later:**
- Deck builder
- AI deck-building assistance
- Tournament deck analytics
- Master Duel meta integration
- Speed Duel / Rush Duel formats
- OCG legality display

## T. Collection requirements

Collection is not V1 (auth is a V1.5 slice). Field definitions here so
schema is ready.

**Network-generic fields** (all specialist sites share these):
- Printing ID
- Quantity
- Purchase price
- Purchase date
- Notes (free text)
- Acquired-from (marketplace or manual)

**Yu-Gi-Oh!-specific fields:**
- Condition (Near Mint / Lightly Played / Moderately Played / Heavily
  Played / Damaged — YGO uses the same standard as MTG here)
- Graded (yes/no)
- Grader (PSA / CGC / BGS / SGC / other)
- Grade (e.g. 9, 9.5, 10)
- Certification number
- 1st Edition (bool, derived from the printing but overridable for
  edge cases)
- Language (default from printing; overridable)
- Signed / Altered / Misprint (booleans; niche but real)
- Sleeved (bool; useful for insurance conversations)

## U. SEO opportunity

Full analysis in [`seo-opportunities.md`](./seo-opportunities.md).
Headline conclusions:

- **Query families to own:** card value, printing-specific
  (`[set-code]`, `[card-number]`), sets, archetypes, rarity-specific
  (`[card] ghost rare price`), collector head terms (`most valuable
  yugioh cards`).
- **Programmatic surfaces to build:** `/card/[slug]`,
  `/card/[slug]/printing/[set-code]-[number]`, `/set/[slug]`,
  `/archetype/[slug]` (V1.5), `/rarity/[slug]`,
  `/collector/most-valuable/[dimension]`.
- **What NOT to build programmatically:** per-condition price pages,
  per-tournament recaps, rulings pages, empty-pop pages, deck-list
  pages.
- **Editorial:** skip in V1. Revisit V1.5.
- **Technical:** IndexNow (Bing, Yandex, Naver, Seznam, Yep) on price
  changes; sitemap-index with per-object sitemaps capped at 50k URLs
  each; Google via clean sitemaps + URL Inspection API only. Google
  does not support IndexNow in 2026.

## V. URL / page graph

Canonical URL structure:

```
/                                                    homepage
/cards                                               card search
/card/[slug]                                         logical card (canonical)
/card/[slug]/printing/[set-code]-[number]            physical printing (canonical)
/card/[slug]/printings                               full printings comparison
/sets                                                set index
/set/[slug]                                          set page
/archetypes                                          archetype index (V1)
/archetype/[slug]                                    archetype page (V1.5+)
/rarity/[slug]                                       rarity landing page
/market                                              market overview
/market/movers                                       top movers
/market/most-valuable                                collector leaderboards
/collector/most-valuable/set/[slug]                  programmatic
/collector/most-valuable/rarity/[slug]               programmatic
/collector/most-valuable/year/[year]                 programmatic (only where >N cards)
/forbidden-limited                                   current F&L list
/forbidden-limited/history                           F&L revision archive
/search?q=…                                          fallback search results
```

**Logical vs physical URL rules:**
- Logical (`/card/[slug]`) is the canonical page for the card as a
  concept; features the primary printing (LOB-001 for BEWD) with a
  chooser to swap.
- Physical (`/card/[slug]/printing/[set-code]-[number]`) is the
  canonical page for a specific printing.
- Logical page has `rel="canonical"` pointing to itself and lists all
  printings.
- Printing page has `rel="canonical"` pointing to itself, `rel="alternate"`
  pointing to the logical page.
- Both are indexable — this is intentional and matches user search
  intent (both `blue-eyes white dragon` and `LOB-001` are real queries
  that deserve distinct pages).

**Avoid indexable duplicates:** search results, filter permutations,
sort-order permutations — all `noindex` or canonicalised.

## W. Brand / visual direction

The Yu-Gi-Oh! product should **feel like a modern collector platform
that respects the game's own mythology** — arcane, high-contrast,
premium, holographic, but not cartoon-anime and not
Egyptian-clipart-heavy.

**Mood:**
- Nocturnal, high-contrast, tactile
- Feels like handling a Secret Rare in dim light — the card is the
  hero, the UI is the frame
- Confident, not busy
- Refractive / iridescent accents where earned (rarity highlights,
  price movements)

**Colour territory (illustrative — a designer will refine):**
- Deep ink base (near-black, cool undertone)
- Off-white / bone typography for calm reading
- Rarity-family accents used deliberately:
  - Ultra family: gold/champagne
  - Secret family: iridescent cyan-magenta
  - Ghost: cold blue-white bloom
  - Starlight: prismatic gradient
  - Collector's: etched brass
- Reserve one signature high-saturation accent for interactive elements

**Typography direction:**
- One serif with strong personality for card names and headlines
  (evokes ancient / arcane without being medieval-fantasy)
- One neutral sans for interface + data
- Monospaced numerals for prices, ATK/DEF, dates

**Surface / material ideas:**
- Card thumbnails treated with subtle rarity-specific shine on hover
- Prices set on quiet card-slab backgrounds
- Rarity ribbons that reference actual card foil patterns without
  copying them
- Graded slabs presented as small "certificate" tiles when displayed
  in graded-highlights panels

**Visual signatures (things that become "ours"):**
- The rarity-family colour system
- The printings-comparison table (a distinctive data object)
- The graded strip beneath every price
- A one-glance F&L badge with colour semantics

**What NOT to do:**
- Do NOT use Konami's Yu-Gi-Oh! logo
- Do NOT use Konami's card frames or holographic textures directly
- Do NOT use anime screenshots or character art
- Do NOT lean on Egyptian hieroglyphic clip art (it reads amateur; it's
  also 1996 iconography, not 2026)
- Do NOT reuse MTGPrices' visual language (typography, layout, colour
  system, iconography)
- Do NOT reuse PokePrices' visual language
- Do NOT lean into cartoon energy — target the collector's sense of
  the object, not the anime's sense of the character

## X. Name / domain shortlist

Do not buy anything yet. Trademark check + availability check first.

**Direction A — collector-native, own noun:**
- `ArcaneSlab` — collector-forward, no game name in domain, extensible
  to graded content
- `SlabAndFoil` — puns on the two axes we own (graded + rarity)
- `Cardholder` — too generic; skip
- `DuelReserve` — evokes vault/collection; needs strong branding to
  land

**Direction B — descriptive, safer for search:**
- `YugiohIndex` — clearly on-topic; unofficial; probably not trademark-
  risky if we don't stylize as Yu-Gi-Oh!
- `YugiPrices` — direct but too close to `YuGiOhPrices.com` legacy
  (may exist / be defunct — verify before pursuing)
- `DuelistPrices` — sidesteps the trademarked name while remaining
  descriptive
- `DuelistIndex` — descriptive and evocative
- `MonsterPrices` — too Pokémon-adjacent; skip
- `TrapAndSpell` — too playful; not right for high-value collector
- `DuelistLedger` — evokes collector's log
- `MillenniumPrices` — leans anime canon; may be too fandom-inside

**Direction C — collector-network family style:**
If we want the specialist sites to share a naming convention (`XPrices`
like `PokePrices`, `MTGPrices`), then:
- `DuelistPrices` (recommended in this direction)
- `YugiPrices`
- `YGOPrices`

Any of these would sit obviously next to PokePrices and MTGPrices in
the network. **This is the recommended direction** because it inherits
the two existing sites' audience recognition and makes the umbrella
hub trivially explicable.

**Shortlist for verification:**
1. `DuelistPrices` — network-family fit, no trademark issue, unique
2. `DuelistIndex` — network-family adjacent; more collector-encyclopedic
3. `ArcaneSlab` — non-family; strongest as its own brand

**Trademark cautions:**
- Do not use `Yu-Gi-Oh!` in the visible brand name (Konami trademark).
- `Yugi` as a name segment has been used by community sites for two
  decades; low but non-zero risk.
- `Duelist` is a common English word and is not trademarked in a way
  that would prevent domain use — verify per jurisdiction.
- Do NOT use official card frames, logos, or Konami branding in
  marketing.

## Y. Data-gap table

Full table in [`data-gap.md`](./data-gap.md). Summary:

- **P0 (must have V1):** card images, set metadata + prefixes, card
  number, rarity, edition, card text, ATK/DEF, Level/Rank/Link/Pendulum
  Scale, Attribute, Type, Extra Deck class, Spell/Trap subtype, TCG
  legality, raw prices, current graded prices, graded series aggregate,
  external IDs, buy-link generation.
- **P1 (should have V1):** alt-art variants, language, Link Arrows,
  sub-classifications, archetype membership, historical prices,
  set/card release date, set product-type, passcode, artwork variant
  name.
- **P2 (V1.5):** series (loose grouping), non-TCG legality, deck usage,
  grader population data.
- **P3 (later):** rulings.

## Z. Shared vs Yu-Gi-Oh-specific architecture

**Shared in `@collector-network/*` packages:**

- `database` — Supabase client, generated types for the shared
  `tcg_*` tables, common query builders (get printings for card, get
  current market price for printing, get graded prices for printing).
- `market-data` — read helpers on top of `tcg_market_prices_*` and
  `tcg_graded_prices_*`. `getPrintingPricing(printingId)` and similar
  primitives with no game-specific rendering.
- `auth` — future shared auth (V1.5+).
- `affiliate` — link generation for TCGplayer / Cardmarket / eBay with
  tracking parameters. Game-agnostic.
- `analytics` — event vocabulary + reporting client. Game-agnostic.
- `seo` — sitemap generation utilities (per-object sitemap files,
  cap-splitting), IndexNow submission client, structured-data helpers
  (Product / BreadcrumbList / AggregateOffer builders), robots.txt
  primitives.
- `network-config` — already exists; game IDs + cross-site constants.

**Yu-Gi-Oh!-only under `apps/yugioh/src/**`:**

- The entire visual design system (colours, typography, motion, iconography)
- Rarity components (badge, ribbon, colour system)
- Edition components
- Card image treatments
- Card page layout
- Printing page layout
- Homepage layout
- Set page layout
- Archetype components (V1.5)
- Monster / Spell / Trap stat components
- ATK/DEF display components
- F&L badges + F&L page layout
- Search UI + autocomplete grammar
- Yu-Gi-Oh!-specific SEO copy templates
- Editorial voice (V1.5)

**Explicitly NOT to build**:
- `packages/ui` — no shared component library across specialist sites.
- Generic `CardPage`, `Homepage`, `SetPage`, `ArchetypePage` components
  intended to be themable per game. Each specialist site owns its own
  card/homepage/set page component tree.
- Cross-game rarity components (Pokémon and Magic have entirely
  different rarity systems).

## AA. Exact V1 launch scope

**In scope:**

1. Homepage (§Q)
2. Search — card name, set code + card number, archetype, rarity;
   typo-tolerant autocomplete (§P)
3. Logical card pages (`/card/[slug]`) with game data, all printings
   summary, F&L status, current featured printing (§N)
4. Physical printing pages
   (`/card/[slug]/printing/[set-code]-[number]`) with raw + graded on
   the same page and full identity (§N)
5. Printings comparison view (`/card/[slug]/printings`) with filter +
   sort (§O)
6. Set pages (`/set/[slug]`) with checklist, most-valuable-in-set, and
   product-type badge (§M)
7. Rarity landing pages (`/rarity/[slug]`) for the ~10 most
   collector-relevant rarity families (Ghost, Starlight, Collector's,
   Prismatic Collector's, Prismatic Ultimate, Ultimate, QCSR, Secret,
   Ultra, Ultra Secret)
8. F&L landing page + revision history (§K, §Q)
9. Market movers page (§Q)
10. Most-valuable programmatic pages (`/collector/most-valuable/set/…`,
    `/collector/most-valuable/rarity/…`)
11. Basic game data on card pages (attribute/type/level/ATK/DEF/text/
    subtypes)
12. Legality badges (TCG F&L only, V1)
13. Buy-link CTAs: TCGplayer + Cardmarket + eBay affiliate on every
    printing page and printing-comparison row
14. Technical SEO: sitemap-index with per-object sitemaps (cards,
    printings, sets, rarities, collector), IndexNow submission on data
    changes for the top ~20% of pages by traffic tier, structured data
    (`Product`, `BreadcrumbList`, `AggregateOffer`)
15. Analytics event vocabulary shipping day 1 (page views, search
    queries, filter interactions, buy-link clicks per marketplace)
16. Auth stub in place (Supabase Auth wired but no user-facing sign-in
    yet — schemas ready for collection tables)
17. Legal pages (About, Data sources, Affiliate disclosure, Privacy,
    Cookies)

**Explicitly out of V1:**

- Collection tracking (V1.5)
- Sign-in / sign-up UI (V1.5)
- Archetype pages beyond a badge link (V1.5)
- Deck usage signals (V1.5)
- Rulings tab (V1.5)
- Editorial articles (V1.5+)
- Master Duel data (later)
- OCG data (later)
- Speed Duel / Rush Duel (later)
- Deck builder (later)
- Historical price charts beyond a basic sparkline (V1.5 for full
  charts)
- Multi-language card text (V1.5+)
- User reviews / discussion

## AB. V1.5 and later

**V1.5** (post-launch iteration, 3-6 months out):
- Auth + collection tracker with YGO-specific fields (§T)
- Archetype pages (§L)
- Full historical price charts (raw + graded overlays)
- Editorial pipeline (F&L recaps, set previews, market retrospectives)
- Rulings tab (curated ingest)
- Master Duel meta cross-links on card pages
- Multi-language card text (French / German / Italian / Spanish /
  Portuguese)
- Booster-box completion cost calculator on set pages

**Later** (major expansion — Slice 12+):
- Deck builder
- AI deck-building assistance
- Tournament results ingest + deck-usage analytics
- Master Duel dedicated section
- OCG data + legality
- Speed Duel format
- Rush Duel format (English via Duel Links content)
- Advanced collection features (insurance valuation, portfolio
  performance, alerts)
- Graded population time-series charts
- Marketplace price alerts (drop-below thresholds)
- Public collection sharing

## AC. Development sequence (Slices 3-11)

Adjusted from the parent build-order in
[`../build-order.md`](../build-order.md).

| Slice | Objective | Acceptance gate |
| --- | --- | --- |
| **3** | Production data audit + read layer | Every P0 field in [`data-gap.md`](./data-gap.md) confirmed via read-only Supabase sample on 15 representative cards. `@collector-network/database` and `@collector-network/market-data` expose canonical query helpers. No production secrets committed. |
| **4** | Yu-Gi-Oh! design system | Design tokens, rarity colour system, typography scale, iconography set, motion primitives, one signature card-visual treatment. Storybook (or equivalent) of Yu-Gi-Oh!-specific primitives — no shared cross-game UI. |
| **5** | Homepage + search | Homepage renders live from real data. Search returns card + set + archetype + set-code matches with typo tolerance. Autocomplete <100ms. Mobile-first. |
| **6** | Card + printing pages | `/card/[slug]` and `/card/[slug]/printing/[set-code]-[number]` render with all §N above-the-fold elements. Raw + graded strip present. Printings comparison view accessible. Structured data emitted. |
| **7** | Set + rarity landing pages | `/set/[slug]` (all sets) and `/rarity/[slug]` (top 10 rarities) render with live data. Most-valuable-in-set widget powered by real market data. Programmatic collector-value pages online for the sensible dimension slices. |
| **8** | Auth + collection scaffolding | Auth wired via Supabase (or chosen provider). Sign-in/up UI hidden behind a feature flag. Collection tables in the shared schema with YGO-specific fields (§T). No public collection features shipped yet. |
| **9** | Affiliate + analytics + SEO polish | TCGplayer + Cardmarket + eBay affiliate deep links live on every printing page. Analytics event vocabulary tracking against the top 20 events. IndexNow submission on price changes. Sitemap index cap-splitting live. Structured data validated. |
| **10** | Yu-Gi-Oh! production launch | Own Vercel project, own production domain, own env vars. Public. |
| **11** | Post-launch iteration → V1.5 | Auth exposure, collection features, archetype pages, editorial pipeline, rulings tab. |

**Slices 12+**: One Piece research/build; Lorcana research/build;
hub/admin expansion. Per parent build-order.

---

## Acceptance gates for Slice 2 (this slice)

- [x] Current live research completed (Sept 2026 sources cited)
- [x] Important claims sourced (URLs in `research.md`, `competitors.md`,
      `data-gap.md`, `seo-opportunities.md`)
- [x] Physical Yu-Gi-Oh! printing complexity documented (§D, §F,
      research §3)
- [x] Edition + rarity requirements explicit (§E, §F, research §4)
- [x] Competitor gaps identified (§I, `competitors.md`)
- [x] Differentiated product clear (§J)
- [x] Exact V1 defined (§AA)
- [x] Data gaps explicit (§Y, `data-gap.md`)
- [x] Visual direction Yu-Gi-Oh!-native but original (§W)
- [x] No public frontend code written
- [x] Production data not mutated (no ingest, no writes; audit deferred
      to Slice 3)
- [x] Docs committed cleanly

**Slice 2 status: GREEN.** Recommend proceeding to Slice 3 (production
data audit + read layer) once this spec is approved.

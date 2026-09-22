# Yu-Gi-Oh! SEO opportunities

Snapshot 2026-09-22. Focus: what to index, what NOT to index, and the
programmatic vs editorial split.

## 1. Search intent map

### Card value (buy/inform)
- `[card name] price`
- `[card name] value`
- `[card name] 1st edition price`
- `[card name] psa 10 value`
- `[card name] psa 10 price`
- `[card name] worth`
- `[card name] cgc 10`
- `[card name] tcgplayer`
- `[card name] cardmarket`
- `[card name] ghost rare price`
- `[card name] starlight rare price`
- `[card name] quarter century secret rare`
- `[card name] secret rare value`

**Who ranks today**: Wargamer, TCG Stacked, PriceCharting, TCGplayer,
misprint.com, tcgpricelookup.com, editorial blogs. Konami is invisible.
**Programmatic**: yes — one page per printing per card, plus rarity-
specific query pages.

### Printing-specific (identify/collect)
- `[set code]-[card number]` (e.g. `LOB-001`)
- `[card] [set name]`
- `[card] [set year]`
- `[set name] card list`

**Who ranks**: Yugipedia, TCGplayer, PriceCharting. **Programmatic**: yes
— one page per printing with the set-code as an alias / breadcrumb.

### Sets (browse/inform)
- `[set name] card list`
- `[set name] checklist`
- `[set name] price guide`
- `[set name] most valuable cards`
- `[set name] booster box`
- `[set name] release date`

**Who ranks**: Yugipedia, PriceCharting, YGOPRODeck, TCGplayer, editorial
blogs. **Programmatic**: yes — set landing pages with dynamic
most-valuable widgets.

### Archetypes (inform/play)
- `[archetype] cards`
- `[archetype] deck`
- `[archetype] card list 2026`
- `[archetype] support cards`
- `[archetype] budget deck`
- `best [archetype] cards`

**Who ranks**: YGOPRODeck, Yu-Gi-Oh! Meta, YuScan, Yugipedia, editorial
sites. **Programmatic**: yes — one page per archetype with members +
current prices + graded highlights. This is territory we can win because
no competitor combines archetype + real-time price + graded well.

### Legality / rulings (play)
- `[card] banned`
- `[card] rulings`
- `current yugioh banlist`
- `yugioh forbidden list 2026`
- `yugioh limited list september 2026`
- `yugioh f&l list`

**Who ranks**: Yu-Gi-Oh! Meta, Konami, YGOPRODeck, Wargamer. **Programmatic**:
partially — a well-updated F&L landing page + per-card legality panel is
straightforward. Rulings should not be programmatic in V1 (thin content
risk).

### Collector head terms
- `most valuable yugioh cards`
- `rarest yugioh cards`
- `most expensive yugioh cards 2026`
- `yugioh 1st edition value`
- `yugioh ghost rare list`
- `yugioh starlight rare list`
- `yugioh quarter century secret rare list`
- `is my yugioh card worth anything`

**Who ranks**: Wargamer, TCG Stacked, Eneba, TCG Price Lookup, various
YouTube. **Editorial + programmatic**: mix — top-N landing pages backed
by real data, plus curated editorial pieces.

### Grading intent
- `yugioh psa 10`
- `yugioh grading worth it`
- `[card] psa population`
- `[card] cgc population`
- `yugioh cgc vs psa`
- `yugioh grading guide`
- `yugioh submit for grading`

**Who ranks**: PSA, CGC, PreGradeCards, PriceCharting, cardgrade.io.
**Programmatic**: yes for `[card] population` — thin risk if pop is zero,
so gate the template on `min_population > threshold`.

## 2. SERP gap analysis

| Family | Head-term winner | Long-tail winner | Where a specialist could break in |
|---|---|---|---|
| Card value | PriceCharting, TCGplayer | Wargamer, blogs | A **native card page with raw + graded + F&L status + printings comparison in one screen** beats blog content on user intent |
| Printing-specific | Yugipedia | TCGplayer | Live prices + graded on the printing page (Yugipedia has neither) |
| Sets | Yugipedia | PriceCharting | Set page with dynamic "most valuable now" powered by live data |
| Archetypes | YGOPRODeck | Meta, Yugipedia | Archetype page with collector angle (member card prices + graded highlights) — nobody does this |
| Legality | Yu-Gi-Oh! Meta, Konami | Konami | Combine F&L + card prices at time-of-restriction |
| Collector head terms | Wargamer, editorial | Blogs | Live-data top-N pages backed by real prices, updated automatically |
| Grading | PSA, CGC | PreGradeCards | Per-card pop + price context is a genuine gap |

## 3. Programmatic SEO — what to build vs what to skip

### Build (high scale, high intent, low thin-content risk)

1. **`/card/[slug]`** — canonical logical card page. ~38k pages. Rich
   content: game data, all printings summary, price ranges, graded
   highlights, F&L status. Zero thin-content risk given the data density.
2. **`/card/[slug]/printing/[set-code]-[number]`** — physical printing
   page. ~86k pages. This is where exact-printing SEO happens (`LOB-001`,
   `LOB-E001`, etc.). Rich content: rarity/edition/language, raw + graded
   prices, buy links, "other printings" cross-links.
3. **`/set/[slug]`** — one page per set (~1000+). Content: checklist,
   release date, most-valuable-now, notable rarities, product-type.
4. **`/archetype/[slug]`** — one page per archetype (~620+). Content:
   members, most-valuable, current F&L impact, competitive relevance
   signal, related archetypes.
5. **`/collector/most-valuable/[dimension]`** — e.g.
   `/collector/most-valuable/set/legend-of-blue-eyes-white-dragon`,
   `/collector/most-valuable/rarity/starlight-rare`,
   `/collector/most-valuable/year/2002`. Live-data pages, generated only
   where the dimension has ≥N cards to justify.
6. **`/rarity/[slug]`** — one page per rarity family. Content:
   explainer + list of top cards in that rarity. ~30 pages.

### Skip / gate carefully

- **Rulings pages** — thin content until we have curated data. Defer to
  V1.5.
- **Per-(printing, grade) pop pages** — most (printing, grade) combos
  have zero graded pop. Gate template on `pop ≥ threshold` (probably ≥5)
  to avoid tens of thousands of empty pages.
- **Deck-list pages** — YGOPRODeck already owns this and we don't have
  the data. Skip in V1.
- **Every-language variant page** — start with English only; adding
  French/German/Italian/Spanish/Portuguese later is a slice-11 decision.
- **Per-tournament recap pages** — editorial territory, not
  programmatic. Skip in V1.
- **Per-condition price pages** (`[card] near mint`, `[card] lightly
  played`) — condition varies per marketplace listing, not per printing.
  Skip.

## 4. Editorial opportunities (V1.5+)

Recurring beats worth committing to only when we have consistent output
capacity:

- F&L update recaps (~every 3-4 months, ~2 days after Konami publishes)
- YCS / regional results (monthly during season)
- New set previews (~monthly)
- "State of the Yu-Gi-Oh! market" quarterly retrospectives
- Grading market milestones (PSA pop crossing thresholds, high-profile
  sales)
- Retro market pieces (Quarter Century Secret Rare post-mortem — clear
  interest right now given 2026 retirement)

Recommendation: **skip editorial in V1**. Programmatic pages plus
excellent card/printing/set/archetype UX will produce more traffic per
hour of effort than editorial in the first 6-12 months. Revisit at V1.5.

## 5. Graded market — YGO-specific SEO angle

Yu-Gi-Oh! graded is ~15% of TCG grading volume (~8M cards total in
2025), so ~1.2M YGO cards graded in 2025 alone. This is a first-class
market, not a footnote. Concrete content angles:

- **Per-card pop growth**: `Blue-Eyes White Dragon LOB-001 PSA
  population growth 2020-2026` — with a chart.
- **Grader-choice pages**: `PSA vs CGC for Yu-Gi-Oh!` — genuine buyer
  intent, currently owned by generic content sites.
- **Ghost Rare pop reports** — extremely low pop cards where every new
  slab moves the market.
- **Vintage LOB 1st Edition population census** — the most-searched
  vintage segment.

## 6. Technical SEO — 2026 state

### IndexNow (Bing / Yandex / Naver / Seznam / Yep)
Live, mature, ~5B URLs/day submitted globally. Free. Non-standard
protocol but well-supported. Push a URL whenever a printing's price
changes materially or a new page is created.
Sources: [IndexNow — supported engines 2026](https://indexnowtool.com/indexnow/supported-search-engines);
[IndexerNow — Google position 2026](https://www.indexernow.com/google-indexnow).

### Google
**Does not support IndexNow as of 2026.** Rely on:
- Correct XML sitemap
- URL Inspection API for manual submission of individual URLs
- Fast, mobile-first, well-structured pages
- No indexing-API abuse (Google's Indexing API is scoped to job postings
  and broadcast events)

### Next.js App Router sitemap strategy at 100k+ URLs
- Use dynamic `sitemap.ts` files (Next 15 supports multiple sitemap
  files with the `id` export or grouped routes).
- Split into per-object sitemaps: `sitemap-cards.xml`,
  `sitemap-printings.xml`, `sitemap-sets.xml`, `sitemap-archetypes.xml`,
  `sitemap-rarity.xml`, `sitemap-collector.xml`.
- Cap each sitemap at 50k URLs (Google's per-file cap).
- Reference all from a `sitemap-index.xml` in the site root.
- Regenerate on-demand via ISR or a nightly build — do not do this at
  request time.
- `next-sitemap` package works but slows Next builds noticeably at
  100k+ URLs; a hand-rolled dynamic route is usually the better call at
  our scale.
Sources: [Next.js — sitemap metadata](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap);
[SitemapHost — Next.js guide](https://sitemaphost.app/blog/nextjs-sitemap-guide/);
[next-sitemap npm](https://www.npmjs.com/package/next-sitemap).

### Structured data (JSON-LD)
For V1, include:
- `Product` schema on printing pages (with `offers` for each available
  buy link)
- `BreadcrumbList` on all deep pages
- `Article` schema when we add editorial (V1.5)
- `AggregateOffer` where multiple sellers exist for the same printing

Skip `Game` schema — search engines don't do anything useful with it,
and the printing-as-product model already gives us commercial rich
results.

## 7. Domain-name SEO signal
Prefer a domain with `yugioh` or `duel` in it — matches user search
intent and disambiguates against Pokémon/Magic content on shared TLDs.
See `product-spec.md` §W for a shortlist. Avoid confusable
official-sounding names that risk trademark issues.

## Sources

- [IndexNow supported engines 2026 — IndexNow Tool](https://indexnowtool.com/indexnow/supported-search-engines)
- [Does Google support IndexNow in 2026? — Pressonify.ai](https://pressonify.ai/blog/indexnow-instant-indexing-press-releases-2026)
- [Google & IndexNow 2026 — IndexerNow](https://www.indexernow.com/google-indexnow)
- [Bing IndexNow explained — IndexerNow](https://www.indexernow.com/blog/indexnow-bing-explained)
- [Next.js sitemap metadata](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
- [Next.js XML sitemaps SEO guide](https://nextjs.org/learn/seo/xml-sitemaps)
- [SitemapHost — Next.js sitemap guide](https://sitemaphost.app/blog/nextjs-sitemap-guide/)
- [next-sitemap npm](https://www.npmjs.com/package/next-sitemap)
- [PreGradeCards — TCG Industry Guide 2026](https://pregradecards.com/blog/trading-card-games-industry-guide-2026) — grading market size
- [Misprint — YGO Market Report 2026](https://www.misprint.com/posts/yugioh-market-report-2026) — market shifts + rarity value bands

# apps/onepiece — implementation report

Slice: **Bootstrap 1 · MTGPrices → One Piece adaptation.**
Branch: `feat/onepiece`. Package: `@collector-network/onepiece`.
Dev port: `3002` (yugioh remains on `3001`).

## What shipped

A fresh Next.js 15 App Router application under `apps/onepiece/`,
adapted from MTGPrices' public product surfaces but rebuilt around One
Piece Card Game semantics. `pnpm --filter @collector-network/onepiece
typecheck` and `build` both pass clean; the app boots on
`http://localhost:3002` via `pnpm --filter @collector-network/onepiece
dev`.

## Route inventory

| Route | Purpose |
| ----- | ------- |
| `/` | Homepage — hero, latest sets, movers, treatments explainer, tools band |
| `/browse` | Set directory with variant / treatment counts per set |
| `/set/[slug]` | Set detail — every unique card in the set, grouped by name |
| `/set/[slug]/card/[cardSlug]` | Specific printing page — treatments in this set + "also printed in" |
| `/card/[slug]` | Logical card page — every printing grouped by treatment across every set |
| `/cards/search` | Full-text card name search (PARAM_VARIANT, noindex) |
| `/card-finder` | Filter vocabulary (colour, cost, power, counter, life, attribute, trigger, type/crew, treatment, language) |
| `/market` | Movers board with 7/30/90-day window switch |
| `/colours` + `/colours/[slug]` | Six-colour landing pages |
| `/leaders` | Leaders directory (placeholder pending gamedata index) |
| `/insights` | Editorial hub (placeholder) |
| `/contact`, `/privacy`, `/terms` | Static company pages |
| `/robots.txt` | SITE_LAUNCHED-gated |
| `/sitemap.xml` | Sitemap index → 5 sub-sitemaps |
| `/sitemap-pages.xml` | Hub + colour landing pages |
| `/sitemap-sets.xml` | Every set URL |
| `/sitemap-cards-{1,2,3}.xml` | Card URL shards (hash bucketed) |
| `/opengraph-image` | Root OG card via `@vercel/og` |

## What was reused from MTGPrices (patterns, not code)

- **Layout**: root `layout.tsx` with metadata factory, robots gate,
  preconnect + Google Fonts (Outfit / Figtree), `SiteStructuredData`
  script tag, sticky Navbar, `flex-1 main`, Footer.
- **Global CSS token system**: warm-parchment page + dark-treatment
  panel. Palette rebuilt around straw-hat gold + ocean blue + coral, six
  OP hue tokens on top.
- **Nav pattern**: wide / medium / mobile variants, `nav-link` active
  state, self-contained `ToolsDropdown`, mobile drawer with grouped
  sections.
- **Homepage rhythm**: Hero → Latest sets → Movers band → Treatments
  explainer → Collector tools. Each section fetches independently and
  degrades to an empty state on failure (`Promise.allSettled` +
  per-section error tracking).
- **Set page**: page hero, breadcrumbs, unique-name grouping,
  treatment-count chip, colour rail on each card tile.
- **Card page shape**: hero image with `op-card-halo`, breadcrumbs,
  gameplay-fact grid, effect text panel, treatment sections.
- **Sitemap sharding**: index → static sub-sitemaps for pages + sets +
  N literal card shards (deterministic hash bucket per URL).
- **SEO policy table**: `src/lib/seo.ts` with `IndexPolicy` union,
  regex table, `canonicalFor`, `isSitemapEligible`.
- **IndexNow helper**: canonical-only, batched at 10K, retries transient
  status codes only. Not wired into ingest — reserved for editorial and
  add/remove events.
- **Launch gate**: `SITE_LAUNCHED === 'true'` + `SITE_URL` in one file.

## What is genuinely One Piece-native (not a reskin)

- **Card model**: printing is not the top identity — **treatment is.**
  Every logical card fans out to standard / parallel / alternate art /
  manga rare / secret rare / special rare / promo. `src/lib/onepiece/
  treatment.ts` normalises the messy source strings.
- **URL structure**: two card surfaces instead of one.
  - `/card/[slug]` groups every treatment across every set — the OP
    "one card, many chases" view.
  - `/set/[slug]/card/[cardSlug]` is the MTGPrices-style
    set-specific printing page, restricted to treatments *in that
    set*, with an "also printed in" list linking to every other
    printing.
- **Domain vocabulary** (`src/lib/onepiece/*`):
  - `card-type.ts` — Leader / Character / Event / Stage / DON!!
  - `colour.ts` — Red / Green / Blue / Purple / Black / Yellow with
    chip classes and colour rails.
  - `rarity.ts` — C / UC / R / SR / SEC / L / P / SP / TR normaliser.
  - `treatment.ts` — inference from edition + finish + rarity plus
    display metadata and per-treatment CSS class.
  - `gamedata.ts` — typed parse of `tcg_cards.gamedata` JSON into a
    strict `OpGamedata` shape: cost / power / counter / life /
    attribute / trigger / types / language / effectText.
  - `slug.ts` — card-name slugifier + printing-slug splitter with
    ambiguity-tolerant candidate resolution.
  - `ebay.ts`, `format-price.ts`, `image.ts` — small helpers.
- **Design tokens** (`src/app/globals.css`):
  - Cream page (`--bg #FBF5E6`), navy ink (`--text #0F2140`).
  - Straw-hat gold brand (`--gold-*`) + ocean-blue interactive
    secondary (`--ocean-*`) + coral hot accent (`--coral-*`).
  - Six-hue OP palette on `--hue-*` — used by `.chip-red`,
    `.chip-green`, …, `.op-colour-rail`, treatment badges.
  - Signature classes: `.op-page-hero`, `.op-colour-crest`,
    `.op-colour-rail`, `.treatment-badge--*`, `.op-fingerprint`,
    `.op-card-halo`, `.op-chase-panel`, `.op-engraved`.
- **Homepage & footer copy** rewritten around the "every printing,
  every treatment" thesis rather than a "prices + decks + rules" hub.
- **Nav taxonomy**: Cards / Sets / Leaders / Colours / Card Finder /
  Movers / Insights + Tools. No formats module (OP tournament format
  is not visible yet). No decks module (deferred).
- **Card-finder facets**: colour, cost, power, counter, life,
  attribute, trigger, type/crew, treatment, language — MTG concepts
  (mana cost, colour identity, keyword abilities, format legality) do
  not appear anywhere in the code.

## What was intentionally not built (respect scope)

- **Auth, collection, decks, watchlist, sharing** — waiting for
  Yu-Gi-Oh's shared `@collector-network/auth` work to land.
- **Analytics wiring** — root layout has no `<Analytics />` yet.
  Vercel Web Analytics can drop in when the Vercel project exists.
- **Charts, price history detail** — hooks into
  `@collector-network/market-data` `getPrintingPriceHistory` exist at
  the composition layer but the UI component is deferred.
- **Insights / editorial content** — hub route is in the sitemap but
  the article store is empty.
- **AI / deck-simulation surfaces** — MTGPrices' Claude-backed
  features are out of scope for V1.
- **Prewarm cron** — no `vercel.json` cron yet; sitemap and page
  routes rely on ISR with 15-minute / 1-hour revalidation.
- **Interactive card-finder** — filter UI is data-ready but currently
  static explainer chips until the ingest reliably populates
  `gamedata.colours` / `gamedata.type` for filtering at scale.
- **Colour landing card grids** — `/colours/[slug]` explains its role
  but does not yet enumerate cards. Same reason as above.
- **Login / account / settings routes** — reserved in the SEO policy
  table as `AUTH`, no UI.

## Data layer

Reads exclusively through the pre-existing shared packages:

- `@collector-network/database` — game-agnostic reads over `tcg_*`
  tables scoped by `game_id`.
- `@collector-network/market-data` — retail + graded quote helpers,
  currency-safe throughout.

`apps/onepiece/src/server/` composes these into OP-native views:

- `client.ts` — process-cached Supabase client + `getOnepieceGameId`
  with a fallback to `'op'` (the abbreviation convention YGO uses in
  `tcg_games.id`, e.g. `'ygo'`). Never crashes when the OP row hasn't
  been seeded — downstream queries return empty result sets.
- `read.ts` — `getCardBundleByName`, `getCardBundleByCardId`,
  `getPrintingBundle`; each returns an `OpCardBundle` where every
  printing carries its inferred treatment.
- `browse.ts` — `listSetsWithCounts`, `listRecentSetsWithCounts`,
  `getSetBundle`.
- `search.ts` — thin wrapper over `getCardSuggestionsByPrefix` +
  `searchCardsByName`.
- `market.ts` — `getMovers(windowDays, limit)`. Reads
  `tcg_market_price_daily` directly, filters to signal (≥ 3 observed
  days, ≥ $2 headline).
- `homepage.ts` — `getHomepageData()` fans out with
  `Promise.allSettled` so no single query can crash the page.
- `sitemap-cards.ts` — shared shard builder for the three
  `sitemap-cards-N.xml` route files.

## Testing / verification

- `pnpm typecheck` — full monorepo clean.
- `pnpm --filter @collector-network/onepiece build` — clean; 24 route
  outputs, static + dynamic mix correct (data-driven routes are `ƒ`
  dynamic with ISR revalidate; static content-only routes are `○`
  static).
- Manual verification against a live One Piece dataset is blocked on
  the shared Supabase project being seeded with `game_id='op'`. Every
  read path is written to return empty rather than crash when the
  dataset is missing, so all pages already render coherently on an
  empty catalogue.

## Deferred items to revisit once Yu-Gi-Oh completes shared-package work

- Wire `@collector-network/auth` for account / collection / decks
  surfaces.
- Wire `@collector-network/analytics` once it becomes real (currently
  event names live in `apps/yugioh/src/lib/analytics-events.ts` — a
  candidate for extraction, per the "extract only when duplicated"
  guardrail in `docs/build-order.md`).
- Adopt whatever Slice CN-A introduces for `customer` / `membership` /
  `consent` (`e336ee9`) once the corresponding auth SDK is stable.
- Consider a shared `@collector-network/seo-scaffolding` package once
  a third site (Lorcana) proves the sitemap + robots + IndexNow
  boilerplate is genuinely identical, not merely similar.

## Follow-up work suggested by this slice

1. Populate the `gamedata` index / column on `tcg_cards` for OP so the
   interactive card-finder + colour-scoped grids can be turned on.
2. Confirm the OP `game_id` in `tcg_games` (assumed `'op'` matching the
   YGO `'ygo'` convention). If it differs, `src/server/client.ts`
   already resolves via `slug='onepiece'` first and only falls back —
   no code change needed once the row exists.
3. Ingest treatments as first-class metadata on `tcg_printings`
   (`edition` field) so `inferTreatment` doesn't have to guess from
   `finish`.
4. Add an OG image generator per set + per card as MTGPrices does.

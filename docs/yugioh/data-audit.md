# Yu-Gi-Oh! production data audit (Slice 3)

Audit performed **2026-09-22** against the shared production Supabase
project used by PokePrices, MTGPrices and this repo. Access: **anon key
only** (JWT role `anon`, no service-role, RLS untouched). Credentials
pulled once from Vercel project `mtgprices-web` env vars via authorised
MCP session; written only to `apps/yugioh/.env.local` (gitignored via
`.gitignore:14`). No writes were performed.

Supabase project: `egidpsrkqvymvioidatc.supabase.co`.

## 1. RLS / read access

Anon SELECT succeeds on all seven audited `tcg_*` tables. Yu-Gi-Oh! game
row resolves via `slug=yugioh` → `id=ygo`. No permission errors during
any read. Writes were not attempted; RLS was not modified.

Tables readable with anon:
- `tcg_games`
- `tcg_sets`
- `tcg_cards`
- `tcg_printings`
- `tcg_external_ids` (empty for YGO — see §3)
- `tcg_market_prices_current`
- `tcg_graded_prices_current`
- `tcg_market_price_daily` (schema verified via a sample row)
- `tcg_graded_price_daily` (schema verified via a sample row)

## 2. YGO row counts (matches parent brief exactly)

| Table | Row count |
| --- | ---: |
| `tcg_sets` (game_id=ygo) | 661 |
| `tcg_cards` (game_id=ygo) | 38,435 |
| `tcg_printings` (game_id=ygo) | 86,141 |
| `tcg_market_prices_current` (game_id=ygo) | 100,306 |
| `tcg_graded_prices_current` (game_id=ygo) | 236,942 (33,569 raw + 203,373 slab) |

## 3. Real column shapes

### `tcg_games`
```
id, slug, name, active, created_at
```
YGO row: `{id: "ygo", slug: "yugioh", name: "Yu-Gi-Oh!", active: true}`.
Five games total: `mtg`, `ygo`, `onepiece`, `swu` (Star Wars Unlimited),
`lorcana`.

### `tcg_sets`
```
id (composite: {game}:set:{code}), game_id, code, name, released_at, tcggraph_meta (jsonb), created_at, updated_at
```

### `tcg_cards`
```
id (composite), game_id, tcggraph_card_id, name, english_id, language,
rarity, artist, rules_text, images (jsonb), gamedata (jsonb),
set_id, collector_number, created_at, updated_at
```

**Key finding**: `tcg_cards.rarity` is on the card row, and each rarity
in each set produces a **distinct `tcg_cards` row**. A Blue-Eyes White
Dragon printed at Ultra Rare in LOB and at Secret Rare in BLMM are two
separate `tcg_cards`, not one card with two printings.

**`images`** JSON shape:
```
{ "large": "https://cards.tcggraph.io/.../large.webp",
  "normal": "https://cards.tcggraph.io/.../normal.webp",
  "small":  "https://cards.tcggraph.io/.../small.webp" }
```

**`gamedata`** JSON shape (Yu-Gi-Oh!):
```
{ "atk": 3000, "def": 2500, "race": "Dragon", "level": 8,
  "attribute": "LIGHT", "frameType": "normal",
  "archetypes": ["Blue-Eyes"], "linkRating": null,
  "linkMarkers": [], "pendulumScale": null,
  "banlist": { "tcg": "unlimited", "ocg": "unlimited" } }
```

**Everything YGO-specific lives inside `gamedata`.** No top-level YGO
columns exist on `tcg_cards`. Rules_text carries the effect text.
`frameType` covers the "Normal / Effect / Fusion / Synchro / Xyz /
Pendulum / Link / Ritual" axis; `race` is the monster type.

### `tcg_printings`
```
id (composite: {game}:print:{tcggraph_card_id}:{key}:{lang}), game_id,
tcg_card_id (FK → tcg_cards.id), set_id, tcggraph_card_id,
tcggraph_printing_key ("normal" | "1st-edition" | ...), finish,
edition, language, collector_number, mtg_printings_id, cardmarket_id,
tcgplayer_id, mapping_confidence, created_at, updated_at
```

**Edition** is a first-class string field.
**Marketplace IDs** are stored **inline on the printing row**, not in
`tcg_external_ids`.

### `tcg_external_ids`
**Empty in production** (0 rows for YGO in the general sample). External
IDs are stored on the printing row instead. Assume this table is
deprecated for our purposes.

### `tcg_market_prices_current`
```
tcg_printing_id (FK), game_id, source, list_type, region, currency,
finish, price, price_low, price_trend, avg_1d, avg_7d, avg_30d,
updated_at, ingested_at, source_run_id
```

### `tcg_graded_prices_current`
```
tcg_printing_id (FK), game_id, grader, grade, currency, price,
card_sales_volume, updated_at, ingested_at, source_run_id
```

### `tcg_market_price_daily` / `tcg_graded_price_daily`
Same shape as `*_current` but with `observed_on` replacing `updated_at`
+ `ingested_at`. Forward-accumulating snapshots (no historical
backfill).

## 4. Logical card vs physical printing — resolved

Slice 2 assumed:
- `tcg_cards` = logical card
- `tcg_printings` = physical printing

**Reality** is more granular:
- `tcg_cards` = one row per **(set × collector_number × rarity)** —
  effectively "one physical variant excluding edition / language / finish".
- `tcg_printings` = one row per **(tcg_card × edition × language ×
  finish)** — the actual physical printing.
- The "logical card" concept is not a stored row. It's reconstructed by
  **grouping `tcg_cards` on `name`**.

Example: Blue-Eyes White Dragon returns **69 `tcg_cards` rows** — one
per set × rarity — and **127 `tcg_printings` rows** across those cards.
LOB-001 alone has 1 `tcg_cards` row (Ultra Rare) and 2 `tcg_printings`
(1st Edition + Unlimited).

**URL implication for Slice 2's model:** The proposed
`/card/[slug]/printing/[set-code]-[number]` is *nearly* right but
ambiguous in rare Rarity-Collection cases where the same
`set+collector_number` is issued at multiple rarities in the same set
(same `set_id`, same `collector_number`, different `tcggraph_card_id`
suffix, different `rarity`). Recommended URL evolution:

- `/card/[name-slug]` → aggregates all 69 tcg_cards for BEWD
- `/card/[name-slug]/[collector-number]` → resolves to one tcg_card row
  when rarity is unambiguous; disambiguates via query param when not
- `/card/[name-slug]/[collector-number]/[edition]` → the physical
  printing (1st-edition / unlimited-or-unknown / limited)

Slice 2 §V URL model does not need to change materially; the ambiguity
is captured for Slice 6 (card + printing pages) implementation.

## 5. Edition coverage

Distinct values in `tcg_printings.edition` for YGO:

| Value | Rows | Share |
| --- | ---: | ---: |
| `1st_edition` | 29,517 | 34% |
| `limited` | 2,196 | 3% |
| `duel_terminal` | 0 | 0% |
| NULL | 54,428 | 63% |
| Total | 86,141 | |

**No `unlimited` value is ever stored.** NULL is ambiguous between "post
first-print run of a set that historically had 1st Editions" (i.e.
Unlimited) and "no edition axis for this product" (promo cards,
Structure Deck singles, Duelist Pack singles).

**Slice 2 assumption**: 1st Ed vs Unlimited is directly queryable.
**Reality**: 1st Ed is reliably marked; Unlimited must be inferred as
"NULL edition on a printing whose parent set has any `1st_edition`
printings". The `apps/yugioh` layer normalises `edition` into
`1st_edition | limited | unlimited_or_unknown` — see
`apps/yugioh/src/server/edition.ts`.

## 6. Rarity taxonomy discovered

Sample probe against `tcg_cards.rarity` (YGO game_id=ygo), counts are
exact per-value:

| Rarity | Rows |
| --- | ---: |
| Common | 17,999 |
| Super Rare | 4,932 |
| Ultra Rare | 4,534 |
| Rare | 3,906 |
| Secret Rare | 2,223 |
| Collector's Rare | 628 |
| Prismatic Secret Rare | 479 |
| Ultimate Rare | 456 |
| Duel Terminal Normal Parallel Rare | 456 |
| Short Print | 429 |
| Platinum Secret Rare | 393 |
| Quarter Century Secret Rare | 341 |
| Gold Rare | 330 |
| Starlight Rare | 273 |
| Premium Gold Rare | 105 |
| Gold Secret Rare | 97 |
| Ghost Rare | 54 |
| Mosaic Rare | 53 |
| Platinum Rare | 44 |
| Shatterfoil Rare | 29 |
| Starfoil Rare | 23 |
| Extra Secret Rare | 4 |
| Ultra Secret Rare | 1 |
| **NULL** | 0 |

Probes that returned zero (worth flagging):
- Prismatic Collector's Rare — 0 (Slice 2 flagged this as a NEW 2026
  rarity introduced with Rarity Collection 5)
- Prismatic Ultimate Rare — 0 (same)
- Pharaoh's Rare — 0
- Parallel Rare — 0 (only its Duel Terminal sub-variant is present)

Rough total from probes: ~37,700 rows out of 38,435. Remaining ~735 rows
carry rarity values I didn't enumerate (further Duel Terminal parallel
variants and small tails).

**Data quality issues** observed:
- `"Extra Secret"` (missing " Rare") — 2 rows in the 1000-row sample.
  Should be `"Extra Secret Rare"`. Normalisation candidate.
- `"New artwork"` (1 row) — not a rarity value; should be an artwork
  variant flag.
- The three 2026 rarities above are not yet ingested. Ingest pipeline
  in the external MTGPrices repo may need to be extended.

## 7. Graded coverage — the shape of the graded market

`tcg_graded_prices_current` graders observed for YGO (probe counts):

| Grader | Rows |
| --- | ---: |
| `raw` | 33,569 |
| `psa` | 26,973 |
| `bgs` | 26,974 |
| `cgc` | 26,985 |
| `sgc` | 26,973 |
| `any` (wildcard grader — aggregate cross-company) | ~95,000 (inferred: 236,942 total − 33,569 raw − 4×27k) |

Grade values seen: `"7"`, `"8"`, `"9"`, `"9.5"`, `"10"`, `"ungraded"`
(all strings).

**Currency: 100% USD** for graded pricing.

**Distinct printings with at least one non-raw slab quote**: to be
confirmed at scale, but the sample suggests the top-value printings
(LOB-001 Unlimited, BLMM-EN001, key vintage/chase cards) have full
coverage across all four majors plus `any`.

**Critical data-quality finding — graded/edition mismatch on vintage
cards.** For LOB-001, all graded rows attach to
`ygo:print:ygo_lob_001:normal:en` (the Unlimited variant). Zero graded
rows on `ygo:print:ygo_lob_001:1st-edition:en`. Modern cards
(BLMM-EN001) do carry graded data on the 1st Edition variant
specifically. Implication: the graded ingest for vintage sets does not
split graded pricing by edition — it attaches everything to the
Unlimited printing regardless of what was actually graded. This is
exactly the case Slice 2 identified as the core wedge ("what's a 1st Ed
PSA 10 LOB Blue-Eyes worth?") and the current data cannot answer it
truthfully. **Enrichment required — see `data-ingestion-plan.md` § G1.**

## 8. Market pricing coverage

`tcg_market_prices_current` sources observed for YGO:
- `tcggraph.tcgplayer` — USD, region NA — appears on popular cards
  (LOB-001, BLMM-EN001, 25YC-ENP01 Blue-Eyes)
- `tcggraph.cardmarket` — EUR, region EU — dominates the tail of
  older/less-tracked printings

Earlier "100% Cardmarket" impression from a 1000-row sample was biased
by the alphabetical order of `tcg_printing_id`. On a Blue-Eyes-family
walk, both sources appear side by side. **Market data is heterogeneous
by source and currency. Slice 2 §22 (product-spec collection fields)
and the printing page (§N) must treat currency as first-class** — do
not sum EUR and USD.

Other facts:
- `list_type` is always `retail` (no buylist observed for YGO).
- `finish` on the market row is sometimes null, sometimes `nonfoil`,
  sometimes `1st_edition` (a cross-cutting concern — finish and edition
  are conflated in some ingest sources).
- `updated_at` is populated (`2026-09-11` on TCGplayer rows, freshest
  observed).
- Averages (`avg_1d`, `avg_7d`, `avg_30d`) are populated for Cardmarket
  rows, null for TCGplayer rows.
- `price_low` sometimes appears larger than `price` (LOB-001 1st Ed had
  price 14.99 / price_low 2999.99 — an upstream data-quality anomaly to
  flag; may indicate `price_low` = "lowest listed floor" while `price`
  = "median" or similar).

## 9. Blue-Eyes end-to-end proof — result

Ran `pnpm --filter @collector-network/yugioh audit:blue-eyes` against
production. Output confirmed:

- Game row resolves via `slug=yugioh` → `id=ygo`
- Bundle for "Blue-Eyes White Dragon": **69 tcg_cards rows**
- **127 printings** across those cards
- **131 retail market quotes** (mix of tcgplayer USD + cardmarket EUR)
- **58 raw grader observations**
- **455 graded slab quotes**
- LOB-001 Ultra Rare has 2 printings (1st Ed + Unlimited). Graded data
  is on the Unlimited row only. TCGplayer USD pricing on both.
- BLMM-EN001 Secret Rare 1st Edition has all four graders + `any` at
  grade 10, plus raw at $13.99 (ungraded volume 305).
- 25YC-ENP01 Rare, edition=`limited`, TCGplayer USD $190.53.
- 2020-EN001 Extra Secret Rare, edition=NULL → normalises to "Unlimited
  / unmarked", Cardmarket EUR €360.18.

All values pass through:
Supabase → `@collector-network/database` → `@collector-network/market-data`
→ `apps/yugioh/src/server/read.ts` cleanly. Raw and graded stay
separate; currencies are preserved; printing IDs never contaminate
across rows.

## 10. Performance (representative timings, local Sept 2026)

Anecdotal from the audit script (single machine, EU→US Supabase, no
cache):

- `getGameBySlug("yugioh")` — ~180ms cold, ~50ms warm.
- `getCardsByName(ygo, "Blue-Eyes White Dragon", exact=true)` — ~250ms
  (returns 69 rows).
- `getPrintingsForCards([69 ids])` — ~350ms (returns 127 rows).
- `getPrintingPricingBatch([127 ids])` — ~800ms wall clock: retail
  quotes fetch and graded fetch run in parallel.
- Total end-to-end BEWD bundle: **~1.6-1.8 seconds** cold.

**Indexing recommendation deferred to Slice 5** — for card-page reads
in isolation this is acceptable. For search-time (Slice 5) we'll want:
- Trigram / `pg_trgm` index on `tcg_cards.name`
- Composite index on `(game_id, collector_number)` for set-code lookup
- Composite index on `(tcg_printing_id, grader)` on
  `tcg_graded_prices_current` (already implicit from the row cardinality
  but worth confirming with `EXPLAIN`)

Do NOT create these indexes from `apps/yugioh` — they belong to the
upstream schema owner. Ticket in `data-ingestion-plan.md § I3`.

## 11. Security verification

- Anon key committed only to `apps/yugioh/.env.local` (gitignored;
  verified via `git check-ignore -v`).
- No service-role key present anywhere in the repo.
- `git diff` and `git status` show no environment files staged.
- `@collector-network/database` reads env at runtime only; never
  hardcodes.
- Package `main` fields point at `.ts` sources — bundling will happen
  at the Next.js app level. Server-only code (`apps/yugioh/src/server/`)
  is not imported from any client boundary in this slice.
- RLS not modified. Zero writes attempted.

## 12. What Slice 3 changes vs Slice 2 spec

Two Slice 2 assumptions are contradicted by production data and worth
propagating into `product-spec.md`:

1. **Unlimited is not a stored edition value.** Slice 2 assumed 1st Ed
   / Unlimited / Limited would be filterable enum values. Reality:
   1st_edition / limited / NULL. The `apps/yugioh` normaliser maps NULL
   → `unlimited_or_unknown`. Filter UX must show three options; the
   third label must acknowledge the ambiguity.

2. **Graded data for vintage cards is not reliably split by edition.**
   LOB-001 1st Ed has no graded rows in production — everything attaches
   to the Unlimited variant. The wedge of "1st Ed PSA 10 vintage LOB
   pricing" cannot be delivered honestly without a graded ingest
   enrichment. This must be reflected in the Slice 2 spec's product
   promises and in the graded-market opportunity section.

Product-spec.md is updated in this slice with a "Post-Slice-3
corrections" callout rather than being rewritten.

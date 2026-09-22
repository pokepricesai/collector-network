# Yu-Gi-Oh! data-gap report

**Reconciled with production audit 2026-09-22** — see
[`data-audit.md`](./data-audit.md). Every P0 field is now marked
**PRESENT**, **PARTIAL** or **MISSING** with real observed coverage.

## Field-by-field (reconciled)

| # | Data | Required for | Status | Coverage / notes | If gap: likely upstream | V1 priority |
|---|---|---|---|---|---|---|
| 1 | Card images (base art) | Card + printing pages | **PRESENT** | `tcg_cards.images` JSON has `large`/`normal`/`small` URLs served from `cards.tcggraph.io`. Non-null on all sampled rows. | — | P0 |
| 2 | Alt-art / extended-art variants | Printing disambiguation | **MISSING (as flag)** | Data quality issue: `"New artwork"` seen in `rarity` column (1 row). No dedicated flag for alt-art. Alt-art variants exist as separate `tcg_cards` rows with distinct `tcggraph_card_id` but no explicit label. | Curation + Yugipedia set gallery | P1 |
| 3 | Set metadata (name, code, release date) | Set pages, browse | **PRESENT** | `tcg_sets` has `code`, `name`, `released_at`. 661 YGO sets. | — | P0 |
| 4 | Set product-type (booster / structure / tin / promo) | Category pages | **MISSING** | No product_type column on `tcg_sets`. `tcggraph_meta` JSON may contain hints — needs deeper inspection. | Curation from Yugipedia + Konami product pages | P1 |
| 5 | Set prefixes (LOB, RA05, L26D…) | Search by set code | **PRESENT** | `tcg_sets.code` carries the prefix; `tcg_cards.collector_number` starts with the prefix (e.g. `LOB-001`). | — | P0 |
| 6 | Card number per printing | Physical identification | **PRESENT** | `tcg_cards.collector_number` + `tcg_printings.collector_number` (redundant but consistent). | — | P0 |
| 7 | Rarity per printing | Filter, discovery, SEO | **PARTIAL** | `tcg_cards.rarity` populated (no nulls in YGO). 23+ distinct values covering the current taxonomy. **Missing 2026 rarities**: Prismatic Collector's Rare (0 rows), Prismatic Ultimate Rare (0 rows), Pharaoh's Rare (0 rows). Also 2 data-quality anomalies (`"Extra Secret"` typo, `"New artwork"` misuse). | External MTGPrices ingest to add new rarity vocab | P0 |
| 8 | Edition (1st Ed / Unlimited / Limited / Duel Terminal) | Physical identification, pricing tier | **PARTIAL** | `1st_edition` (29,517), `limited` (2,196), NULL (54,428). **Unlimited is never explicitly stored** — inferred from NULL on a printing whose parent set has any 1st_edition printings. Normalisation done in `apps/yugioh/src/server/edition.ts`. | Upstream ingest could set `unlimited` explicitly | P0 (present, needs normalisation) |
| 9 | Language / region variant | Physical identification | **PRESENT** | `tcg_printings.language` populated ("en" observed). Multi-language coverage not verified — probably `en` only at this stage. | — | P0 for `en`; P1 for others |
| 10 | Card text (effect text) | Card pages, search | **PRESENT** | `tcg_cards.rules_text`, English. | — | P0 |
| 11 | ATK / DEF | Monster card page | **PRESENT** | Inside `gamedata.atk` / `gamedata.def`. | — | P0 |
| 12 | Level / Rank / Link Rating / Pendulum Scale | Card page + filter | **PARTIAL** | Only `gamedata.level` observed on Blue-Eyes (no distinction from Rank in the payload). `linkRating`, `pendulumScale` present as separate fields. Rank presumably encoded as `level` for Xyz monsters (verify in Slice 5). | Verify with a Xyz sample in Slice 4/5 | P0 (verify) |
| 13 | Link Arrows | Link monster display | **PRESENT** | `gamedata.linkMarkers` string array. | — | P1 |
| 14 | Attribute (LIGHT/DARK/FIRE/WATER/WIND/EARTH/DIVINE) | Filter, card page | **PRESENT** | `gamedata.attribute` = `"LIGHT"` (etc.) — matches the seven-value enum. | — | P0 |
| 15 | Monster Type (25 types: Warrior / Spellcaster / Dragon / ...) | Filter, card page | **PRESENT** | `gamedata.race`. Blue-Eyes = `"Dragon"`. | — | P0 |
| 16 | Sub-classifications (Effect / Normal / Tuner / Flip / Toon / Spirit / Union / Gemini) | Filter, card page | **PARTIAL** | Not explicitly enumerated in `gamedata`. `frameType` covers the base class ("normal") but sub-classifications may live in `rules_text` only. Needs Slice 5 verification. | Derive from `rules_text` or extend `gamedata` | P1 |
| 17 | Extra Deck class (Fusion / Synchro / Xyz / Pendulum / Link) | Card page | **PRESENT** | `gamedata.frameType`. | — | P0 |
| 18 | Spell / Trap subtype (Normal / Continuous / Equip / Quick-Play / Field / Ritual / Counter) | Card page | **PARTIAL** | Likely in `gamedata.frameType` for Spell/Trap cards; sample used a monster. Verify Slice 5. | YGOPRODeck if missing | P0 (verify) |
| 19 | Archetype membership | Archetype pages (V1.5), filter | **PRESENT** | `gamedata.archetypes` string array. Blue-Eyes = `["Blue-Eyes"]`. | — | P1 |
| 20 | Series (looser than archetype) | Editorial / SEO | **MISSING** | Not represented. | Curation | P2 |
| 21 | Legality (TCG F&L) | Card page, filter | **PARTIAL** | `gamedata.banlist.tcg` = `"unlimited"` (etc.). Verify freshness against the Sept 21 2026 F&L list. May lag if the ingest hasn't run since. | External ingest cadence | P0 (verify freshness) |
| 22 | Legality (OCG / Master Duel / Speed Duel / Rush Duel) | Later filters | **PARTIAL** | `gamedata.banlist.ocg` present. Master Duel / Speed Duel / Rush Duel banlists not represented. | YGOPRODeck banlist endpoint | P2 |
| 23 | Rulings | Card page rulings tab (later) | **MISSING** | — | Konami DB; needs licensing/scraping | P3 (defer) |
| 24 | Deck usage / competitive representation | Card page relevance | **MISSING** | — | Yu-Gi-Oh! Meta / YGOPRODeck decklists / YCS | P2 |
| 25 | Current raw retail prices | Card pages | **PRESENT** | `tcg_market_prices_current` — 100,306 rows for YGO. Two sources (TCGplayer USD + Cardmarket EUR). | — | P0 |
| 26 | Historical raw prices (daily) | Price charts | **PRESENT** | `tcg_market_price_daily` populated. Forward-accumulating (no historical backfill). | — | P1 |
| 27 | Current graded prices (per grader × grade) | Card pages | **PARTIAL** | `tcg_graded_prices_current` — 203,373 slab rows. All USD. **Vintage graded is not split by edition** (LOB-001 has graded on Unlimited only). | Enrichment — see ingestion plan §G1 | P0 (with caveat) |
| 28 | Historical graded prices (daily) | Graded charts | **PRESENT** | `tcg_graded_price_daily`. Same forward-accumulating property. | — | P1 |
| 29 | Raw grader observations (grader='raw') | Raw sales aggregate | **PRESENT** | 33,569 rows in `tcg_graded_prices_current` with `grader='raw'`. All USD. `card_sales_volume` populated. | — | P0 |
| 30 | Grader population data (PSA / CGC pop counts) | Rarity / scarcity context | **MISSING** | — | PSA CardFacts API; CGC pop reports; PriceCharting combined pop | P2 |
| 31 | Set release date | Set page sort; "recently released" | **PRESENT** | `tcg_sets.released_at`. | — | P1 |
| 32 | Card release date (first printing) | Card page context | **DERIVABLE** | Derived from `min(released_at)` across the card's `tcg_cards` set family. | — | P1 |
| 33 | External IDs — TCGplayer / Cardmarket | Buy-link generation, ingest joins | **PARTIAL** | Inline `tcgplayer_id` / `cardmarket_id` on `tcg_printings`. **`tcg_external_ids` table is empty for YGO — deprecated.** Coverage is uneven — vintage LOB-001 printings have both IDs null; modern printings mostly populated. | Upstream ingest improvement | P0 (present but sparse for vintage) |
| 34 | Card passcode (8-digit Konami ID) | Search, disambiguation | **MISSING** | Not present in `tcg_cards` at all. Not in `gamedata`. Not in `english_id` (that column is always null on YGO samples). | YGOPRODeck exposes `id` (passcode) — could be joined via `tcggraph_card_id` | P1 |
| 35 | Buy-link generation | Affiliate CTA | **DERIVABLE** | From `tcgplayer_id` / `cardmarket_id` + eBay search-URL construction on printing identity. Implementation in `@collector-network/affiliate` (Slice 9). | — | P0 |
| 36 | Artwork variant name (Alternate Artwork / Retro-Pack Alt Art) | Alt-art disambiguation | **MISSING** | See #2. `rarity="New artwork"` anomaly hints at unstructured storage. | Curation | P1 |

## Reconciliation summary

**P0 status:**
- **Present (10):** #1, #3, #5, #6, #10, #11, #14, #15, #17, #25
- **Present (derivable) (2):** #29, #35
- **Partial (5):** #7 (rarity — 2026 additions missing), #8 (edition —
  Unlimited inferred), #12 (Level/Rank verify), #18 (Spell/Trap verify),
  #21 (legality freshness), #27 (graded — vintage edition split
  missing), #33 (external IDs sparse for vintage)
- **Missing (0)**

**P1 status:** #2 alt-art, #4 product-type, #9 language coverage, #13,
#16, #19, #20, #26, #28, #31, #32, #34, #36 — of these, several are
already present or derivable; a small number need enrichment.

**P2 / P3:** unchanged from Slice 2.

## What this means for Slice 2 spec

Two Slice 2 §AA V1 promises need adjustment based on real data:

1. **"1st Edition / Unlimited filter"** — must present as three
   options: 1st Edition (29,517), Limited (2,196), Unlimited/unmarked
   (54,428) with UX copy acknowledging the third bucket includes both
   post-1st-Ed printings and products that never had a 1st Ed.
2. **"Vintage LOB 1st Ed PSA 10"** — cannot be honestly delivered from
   current data. Graded values attach to the Unlimited printing only.
   Either enrich the graded ingest (ingestion plan §G1) or drop this
   from V1 headline claims.

See [`data-ingestion-plan.md`](./data-ingestion-plan.md) for the
enrichment queue.

# Yu-Gi-Oh! data ingestion plan (Slice 3 output)

Ingestion itself currently lives in the external MTGPrices repository.
This document specifies **what** needs to be added or fixed there for
`apps/yugioh` V1 to ship, **not** how to build a new ingestion pipeline
in `collector-network`.

The document should be handed over to whoever owns the ingest workers
and revisited if we deliberately relocate ingestion into this
monorepo later.

## Ordering

Priority reflects Slice 2 V1 requirements plus Slice 3 audit findings.

## G-track: graded enrichment

### G1 — split vintage graded prices by edition
- **Field**: `tcg_graded_prices_current.tcg_printing_id`
- **Problem**: For vintage cards (LOB era), all graded quotes attach to
  the Unlimited printing (`ygo:print:...:normal:en`). The 1st Edition
  printing (`ygo:print:...:1st-edition:en`) has zero graded rows. This
  contradicts the actual grading market — PSA CardFacts lists LOB-001
  1st Edition separately from Unlimited.
- **Source**: PSA CardFacts, CGC pop reports, PriceCharting per-printing
  pages (they distinguish `LOB-001 1st Edition` from `LOB-001`).
- **Matching key**: `(tcggraph_card_id, edition)`. The current ingest
  presumably matches on `tcggraph_card_id` alone.
- **Refresh cadence**: on the existing graded ingest schedule.
- **Estimated impact**: reroutes existing ~200-500 graded rows across
  the top ~50 vintage cards; may double the row count on those cards.
- **Risk**: low — pure re-routing, no new sources needed.
- **V1 blocker?** Yes for the "1st Ed vintage graded" wedge claim in
  Slice 2 §J. Without this fix, Slice 2's differentiation is honest
  only for modern cards.

### G2 — PSA / CGC population counts
- **Field**: new `tcg_graded_prices_current.population` or a companion
  `tcg_graded_populations_current` table
- **Problem**: We have prices but not populations. Slice 2 §H proposed
  population badges next to graded price rows.
- **Source**: PSA CardFacts, CGC pop reports, PriceCharting combined
  pop.
- **Refresh cadence**: weekly (populations move slowly).
- **Volume**: ~200k rows across (printing × grader × grade).
- **Risk**: PSA API access requires an approval process; PriceCharting
  and CGC public pages can be scraped politely.
- **V1 blocker?** No — pop badges are V1.5.

## R-track: rarity enrichment

### R1 — add 2026 rarity values
- **Values missing**: `Prismatic Collector's Rare`,
  `Prismatic Ultimate Rare`, `Pharaoh's Rare`.
- **Source**: Rarity Collection 5 (RA05, April 2026) and current
  official product pages.
- **Impact**: ~200-500 new `tcg_cards` rows once ingested, plus
  associated printings and prices.
- **Risk**: low.
- **V1 blocker?** Soft — we can ship V1 with 2026 rarities as an "empty
  filter" but the site would look outdated.

### R2 — normalise anomalous rarity values
- **Values**: `"Extra Secret"` should be `"Extra Secret Rare"` (2 rows).
  `"New artwork"` is not a rarity — should be an artwork variant flag
  (1 row + likely more that haven't surfaced).
- **Action**: schema-side data-fix in the ingest layer; do NOT mutate
  from `apps/yugioh`.
- **Risk**: none.

### R3 — rarity family / parent normalisation
- **Field**: new `rarity_family` derived from `rarity` (e.g.
  `Pharaoh's Rare` → family `Parallel Rare`).
- **Purpose**: Slice 2 §E "filter by rarity family" requirement.
- **Location**: could live in `apps/yugioh` as a static mapping table
  (no schema change) — that's the recommended approach unless MTG also
  needs it.

## E-track: edition enrichment

### E1 — populate Unlimited explicitly
- **Field**: `tcg_printings.edition`
- **Problem**: NULL means "Unlimited or no edition axis". Ambiguous.
- **Action**: for each printing where NULL and the parent set contains
  any `1st_edition` printings, set `edition='unlimited'`. For
  promo/Structure Deck cards, leave `edition` as a distinct new value
  or leave NULL with a `product_type` field on the set.
- **Risk**: medium — needs care around Speed Duel Boxes, tournament
  promos, WCS prize cards.
- **V1 blocker?** No — `apps/yugioh` normalises client-side and shows
  "Unlimited / unmarked" as the third filter option.

## X-track: external-ID enrichment (buy-link coverage)

### X1 — TCGplayer / Cardmarket IDs on vintage printings
- **Field**: `tcg_printings.tcgplayer_id`, `tcg_printings.cardmarket_id`
- **Problem**: LOB-001 has both null. Modern printings mostly have
  Cardmarket IDs; TCGplayer IDs are sparser.
- **Source**: TCGplayer product API (requires affiliate approval);
  Cardmarket API. Alternatively, deterministic URL construction from
  set-code + collector-number can bypass the ID requirement — the
  affiliate URL for TCGplayer supports search-by-product-string.
- **Action**: Slice 9 (`@collector-network/affiliate`) will implement
  the fallback URL construction; ingest enrichment is optional.

### X2 — Konami passcode (8-digit)
- **Field**: currently missing. Add either as a new column on
  `tcg_cards` or via `tcg_external_ids` (which is currently empty and
  could be repurposed for game-agnostic identifiers).
- **Source**: YGOPRODeck exposes it as their `id` field; Konami DB
  exposes it directly.
- **Purpose**: Slice 2 §P search grammar includes passcode lookup.
- **V1 blocker?** No — search will function on name + set-code + card
  number without it. Passcode is a nice-to-have for advanced users.

## I-track: index / performance

### I1 — trigram index on `tcg_cards.name`
- Enable `pg_trgm`; index `tcg_cards.name gin_trgm_ops` for fuzzy
  search.
- Justified in Slice 5 (search UI).

### I2 — composite `(game_id, collector_number)` on `tcg_cards`
- Speeds set-code lookup dramatically.

### I3 — composite `(tcg_printing_id, grader, grade)` on
`tcg_graded_prices_current`
- Speeds "show graded strip for this printing" queries.

All three are **schema-owner tasks**, not `apps/yugioh` tasks.
`apps/yugioh` should file them and wait.

## L-track: legality freshness

### L1 — F&L ingest cadence
- Verify that `gamedata.banlist.tcg` reflects the Sept 21 2026
  Forbidden & Limited List. If it lags, the ingest cadence needs to
  align with Konami's ~3-month F&L publication schedule.
- **Source**: Konami EU F&L page + Yu-Gi-Oh! Meta F&L articles.
- **Cadence**: fetch within 24 hours of each F&L publication.

## S-track: series / archetype metadata

### S1 — series curation
- Series (looser than archetype) not represented. Curation only, not a
  large ingest project. Defer to V1.5.

## Not in scope

- **Rulings** — deferred to V1.5+, requires licensing consideration.
- **Deck usage** — separate tournament-data ingest project. V1.5+.
- **Master Duel / Speed Duel / Rush Duel banlists** — V1.5+.
- **Alt-art flag** — depends on `rarity` normalisation and probably
  needs a new `variants` JSON field on `tcg_cards` in the future.

## Hand-off

This plan should be:
1. Attached to the next MTGPrices sprint that touches YGO ingest
2. Cross-referenced from `data-audit.md` in this repo
3. Revisited at the start of Slice 5 (search) — I1/I2/I3 blocking

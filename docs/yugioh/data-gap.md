# Yu-Gi-Oh! data-gap report

Drives Slice 3 (data audit + read layer). "Have?" means present in the
shared Supabase project today per the known counts in the parent brief
(38,435 logical cards, 86,141 printings, 100,306 current market rows,
203,373 slab rows, 236,942 graded-series rows, 33,569 raw-series rows).
Confirm in Slice 3 with real read-only queries.

## Field-by-field

| # | Data | Required for | We have (per known counts)? | Missing | Likely source if missing | V1 importance |
|---|---|---|---|---|---|---|
| 1 | Card images (base art) | Card + printing pages | Likely (via existing pipeline) | Confirm hosting + alt-art variants coverage | YGOPRODeck image endpoint; Yugipedia | **P0** |
| 2 | Alt-art / extended-art variants | Printing disambiguation | Partial — depends on how printings row treats alt-arts | Explicit alt-art flag | YGOPRODeck; Yugipedia per-set gallery | **P1** |
| 3 | Set metadata (name, code, release date, product type: booster/deck/tin/promo) | Set pages, browse | Partial (sets exist as rows) | Product-type classification; release date sanity check | Yugipedia set pages; YGOPRODeck cardsets endpoint | **P0** |
| 4 | Set prefixes (LOB, SDK, RA05, L26D…) | Search by set code | Likely (in printings) | Confirm every printing has a resolvable prefix | Yugipedia [TCG set prefixes](https://yugipedia.com/wiki/TCG_set_prefixes) | **P0** |
| 5 | Card number per printing | Physical identification | Yes | — | — | **P0** |
| 6 | Rarity per printing | Filter, discovery, SEO | Likely | Confirm rarity vocabulary matches current 2026 taxonomy (Prismatic Collector's Rare, Prismatic Ultimate Rare, Pharaoh's Rare, etc.) | Yugipedia [Rarity](https://yugipedia.com/wiki/Rarity); YGOPRODeck | **P0** |
| 7 | Edition (1st Edition / Unlimited / Limited / Duel Terminal) | Physical identification, pricing tier | Uncertain — may be encoded loosely | Explicit edition field, normalised | TCGplayer; Cardmarket | **P0** |
| 8 | Language / region variant | Physical identification | Uncertain | Explicit language on printing rows | Yugipedia per-region set galleries | **P1** |
| 9 | Card text (effect text) | Card pages, search | Likely | Confirm English + optional other languages | YGOPRODeck; Konami DB | **P0** |
| 10 | ATK / DEF | Monster card page | Likely | — | YGOPRODeck | **P0** |
| 11 | Level / Rank / Link Rating / Pendulum Scale | Card page display + filter | Likely | Ensure both Rank + Level as separate fields, plus Link Rating | YGOPRODeck | **P0** |
| 12 | Link Arrows (direction bitfield) | Link monster display | Uncertain | Structured 8-arrow representation | YGOPRODeck (has `linkmarkers`) | **P1** |
| 13 | Attribute (LIGHT/DARK/FIRE/WATER/WIND/EARTH/DIVINE) | Filter, card page | Likely | — | YGOPRODeck | **P0** |
| 14 | Monster Type (25 values) | Filter, card page | Likely | Confirm enum matches current 25 types (incl. Cyberse, Wyrm) | YGOPRODeck | **P0** |
| 15 | Sub-classifications (Effect/Tuner/Flip/Toon/Spirit/Union/Gemini) | Filter, card page | Likely | Confirm coverage | YGOPRODeck | **P1** |
| 16 | Extra Deck class (Fusion/Synchro/Xyz/Pendulum/Link) | Card page | Likely | — | YGOPRODeck | **P0** |
| 17 | Spell/Trap subtype (Normal/Continuous/Equip/Quick-Play/Field/Ritual/Counter) | Card page | Likely | — | YGOPRODeck | **P0** |
| 18 | Archetype membership | Archetype pages (V1.5), filter | Partial — YGOPRODeck exposes this via API | Explicit archetype relation table, ingestable | [YGOPRODeck API](https://ygoprodeck.com/api-guide/) | **P1** |
| 19 | Series (looser than archetype) | Editorial / SEO | Missing likely | Curation required | Yugipedia | **P2** |
| 20 | Legality (TCG F&L status) | Card page, filter | Uncertain — may need ingest of current banlist | Per-card `tcg_legality` field with revision | [Konami F&L](https://www.yugioh-card.com/eu/play/forbidden-and-limited-list/); YGOPRODeck banlist endpoint | **P0** |
| 21 | Legality (OCG / Master Duel / Speed Duel / Rush Duel) | Later filters | Missing likely | Per-format legality fields | YGOPRODeck (has format-specific banlist per card) | **P2** |
| 22 | Rulings | Card page rulings tab (later) | Missing | Fragmented — Konami official rulings, judge-program clarifications | Konami DB; needs licensing/scraping consideration | **P3** (defer) |
| 23 | Deck usage / competitive representation | Card page relevance signal, archetype pages | Missing | Ingest of tournament decklists | [Yu-Gi-Oh! Meta](https://www.yugiohmeta.com/); YGOPRODeck decklists; YCS coverage | **P2** |
| 24 | Current raw prices per printing | Card + printing pages | **Yes** (100k+ rows) | Confirm freshness + which sources feed it | Existing ingest (external repo) | **P0** |
| 25 | Historical raw prices (daily) | Price charts | **Yes** (`tcg_market_price_daily`) | Confirm retention window | Existing ingest | **P1** |
| 26 | Current graded prices per (printing, grader, grade) | Card + printing pages, graded highlights | **Yes** (203k+ slab rows) | Confirm coverage across PSA / BGS / CGC / SGC | Existing ingest | **P0** |
| 27 | Historical graded prices (daily) | Graded charts | **Yes** (`tcg_graded_price_daily`) | Confirm | Existing ingest | **P1** |
| 28 | Raw graded-series (aggregated by grade) | Graded market summary | **Yes** (33k+ rows in `tcg_graded_prices_current`, 236k+ series) | Confirm which is the "current" object vs series | Existing ingest | **P0** |
| 29 | Grader population data (PSA/CGC pop counts) | Rarity/scarcity context on card page | Missing likely | PSA CardFacts; CGC pop reports; PriceCharting combined pop | **P2** |
| 30 | Set release date | Set page sort; "recently released" | Likely | — | Yugipedia set pages | **P1** |
| 31 | Set product-type (booster/structure deck/tin/collector box/promo) | Set browse, category pages | Uncertain | Curation from Yugipedia + Konami product pages | **P1** |
| 32 | Card release date (first printing) | Card page context | Derivable from earliest printing + set release | — | — | **P1** |
| 33 | External IDs (YGOPRODeck ID, Konami passcode, Yugipedia URL slug) | Deep linking, ingest joins | Yes (`tcg_external_ids`) | Confirm coverage per source | — | **P0** |
| 34 | Card passcode (8-digit Konami ID printed on the card) | Search, disambiguation, external lookup | Likely (as external ID) | Confirm | Konami DB | **P1** |
| 35 | Buy-links (TCGplayer / Cardmarket / eBay affiliate URLs) | Affiliate CTA | Missing | Constructed at query time from IDs | — | **P0** |
| 36 | Artwork variant name (e.g. "Alternate Artwork", "Retro-Pack Alt Art") | Alt-art disambiguation | Missing likely | Curation from Yugipedia set gallery | **P1** |

## Ranked priority summary

**P0 — must exist by V1 launch (Slice 3-6):**
Card images (1), set metadata (3), set prefixes (4), card number (5),
rarity (6), edition (7), card text (9), ATK/DEF (10),
Level/Rank/Link/Pendulum Scale (11), Attribute (13), Monster Type (14),
Extra Deck class (16), Spell/Trap subtype (17), TCG legality (20), raw
prices (24), current graded prices (26), graded series aggregate (28),
external IDs (33), buy-link generation (35).

**P1 — should exist by V1 launch:**
Alt-art variants (2), Language (8), Link Arrows (12), sub-classifications
(15), archetype membership (18), historical raw prices (25), historical
graded (27), set release date (30), set product-type (31), card release
date (32), passcode (34), artwork variant name (36).

**P2 — V1.5:**
Series (19), non-TCG legality (21), deck usage / competitive
representation (23), grader population data (29).

**P3 — later:**
Rulings (22).

## Slice 3 acceptance criteria (proposed)

Slice 3 (data audit / read layer) is done when:

- Every P0 field has been confirmed present in production Supabase via a
  read-only sample query on a representative set of ~15 cards
  (Blue-Eyes/Dark Magician/Exodia pieces/a Ghost Rare/an Ultimate Rare/a
  Quarter Century Secret Rare/a modern chase/a heavily reprinted staple/a
  common/a promo).
- Every P0 gap has a documented ingest strategy (which upstream, which
  cadence, who owns it — likely still the external repo).
- The `@collector-network/database` package can `select` a card by ID and
  return all of its printings joined with rarity, edition, current raw
  price and current graded prices, in one call.
- The `@collector-network/market-data` package exposes a canonical
  `getPrintingPricing(printingId)` returning `{ raw: {...}, graded:
  Array<{ grader, grade, price, asOf }> }`.
- No production credentials committed. Local development uses a staging
  Supabase project or read-only anon key with row-level restrictions.

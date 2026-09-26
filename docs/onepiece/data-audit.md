# One Piece production data audit (Phase A)

Audit performed **2026-09-26** against the shared production Supabase
project used by PokePrices, MTGPrices, YGOPrices and this repo. Access:
**anon key only** (JWT role `anon`, no service-role, RLS untouched).
Credentials pulled once from Vercel project `mtgprices-web` env vars via
authorised MCP session; written only to `apps/onepiece/.env.local`
(gitignored — verified via `git check-ignore -v`). No writes performed.

Supabase project: `egidpsrkqvymvioidatc.supabase.co`.

Raw probe output: `apps/onepiece/scripts/probe-onepiece.mts` — the
transcript this audit summarises lives at `tmp/probe-onepiece.txt`.

## 1. RLS / read access

Anon SELECT succeeds on all seven audited `tcg_*` tables. One Piece
game row resolves via `slug=one-piece` → `id=onepiece`. No permission
errors during any read. Writes were not attempted; RLS was not modified.

Tables readable with anon:
- `tcg_games`
- `tcg_sets`
- `tcg_cards`
- `tcg_printings`
- `tcg_market_prices_current`
- `tcg_graded_prices_current`
- `tcg_market_price_daily`
- `tcg_graded_price_daily`

## 2. `tcg_games` row (correction to YGO audit)

```
{ id: "onepiece", slug: "one-piece", name: "One Piece Card Game",
  active: true, created_at: "2026-09-21T15:48:10.749388+00:00" }
```

**Important correction to `docs/yugioh/data-audit.md` §3.** The YGO audit
(2026-09-22) recorded the OP row as `slug=onepiece` (unhyphenated). By
2026-09-26 the slug is `slug=one-piece` (hyphenated). The `id` is still
`onepiece`. The row was created on 2026-09-21 (four days before this
audit), which is consistent with a first-ingest event that renamed the
slug shortly after landing.

Consequences for `apps/onepiece`:
- `getOnepieceGameId` looks up `tcg_games` by slug — updated from
  `'onepiece'` to `'one-piece'` in `src/server/client.ts` this pass.
- Every `tcg_*.game_id` column filter uses `'onepiece'` — no change.

## 3. Row counts (per `game_id='onepiece'`)

| Table                        | Rows       |
| ---------------------------- | ---------- |
| `tcg_sets`                   | 65         |
| `tcg_cards`                  | 5,538      |
| `tcg_printings`              | 7,774      |
| `tcg_market_prices_current`  | 9,293      |
| `tcg_graded_prices_current`  | 8,025      |
| `tcg_market_price_daily`     | 18,568     |
| `tcg_graded_price_daily`     | 16,034     |

Ingest is fresh: `tcg_market_prices_current.updated_at` runs
`2026-09-21T22:30:37 → 2026-09-22T08:17:58`. Whatever schedule the
external MTGPrices ingest uses, it ran within the last five days.

Daily-price tables (18k retail, 16k graded) are populated — matches the
`market-data/history.ts` helpers in the shared package. Historical
range and daily cadence are unverified in this pass and should be
sampled in Phase B before we wire history charts on OP.

## 4. `tcg_cards` — column shape (matches YGO)

Same shape as YGO. Composite id: `{game}:card:{key}`. Example row IDs:

```
onepiece:card:op_eb02_010
onepiece:card:op_eb02_010_p1
onepiece:card:op_eb02_010_p2
onepiece:card:op_eb02_010_p3
onepiece:card:op_eb02_061
onepiece:card:op_eb02_061_p1
onepiece:card:op_eb02_061_p2
onepiece:card:op_eb02_061_p3
onepiece:card:op_eb02_061_r1
```

**Key finding — treatment axis lives in `collector_number` suffixes,
not in `edition` or `finish`.** See §7 for a full breakdown.

## 5. Rarity distribution

| Rarity value | Rows  | Share |
| ------------ | ----- | ----- |
| `C`          | 1,884 | 34%   |
| `R`          | 1,077 | 19%   |
| `UC`         |   849 | 15%   |
| `SR`         |   762 | 14%   |
| `L`          |   359 | 6.5%  |
| `P`          |   315 | 5.7%  |
| `SEC`        |   144 | 2.6%  |
| `SP CARD`    |   137 | 2.5%  |
| `TR`         |    11 | 0.2%  |
| **NULL**     |     0 | —     |
| **Total**    | 5,538 | 100%  |

Notes:
- No NULL rarities — every card row carries a rarity.
- `SP CARD` (with the literal space in the string) is a rarity value —
  our `apps/onepiece/src/lib/onepiece/rarity.ts` `CANONICAL` map treats
  `sp` and `special card` as canonical; we need to add the exact
  `"SP CARD"` key alias for a clean lookup.
- `TR` (Treasure Rare) is present but rare (11 rows).
- **No explicit `Parallel Rare`, `Alternate Art`, `Manga Rare` values.**
  The alt-treatment rarities are encoded either as `SP CARD` (special)
  or via `collector_number` suffixes — see §7.

## 6. Editions, finishes, languages on `tcg_printings`

| Axis                     | Value      | Rows  |
| ------------------------ | ---------- | ----- |
| `edition`                | **NULL**   | 7,774 |
| `finish`                 | nonfoil    | 5,220 |
| `finish`                 | foil       | 2,554 |
| `language`               | en         | 7,774 |
| `tcggraph_printing_key`  | normal     | 5,220 |
| `tcggraph_printing_key`  | foil       | 2,554 |

- **`edition` is 100% NULL** across every OP printing. YGO uses this
  column for `1st_edition`/`limited`; OP does not. Our
  `treatment.inferTreatment` logic should stop trying to derive
  treatment from `edition` for OP.
- `finish` is a clean binary: `nonfoil` vs `foil`. Every card has both
  variants ingested where TCGGraph has them.
- **`language` is 100% English.** No Japanese printings are in the
  shared DB today. If we want JP price data, ingest needs to add a
  Japanese source (or duplicate rows with `language='jp'`).
- `tcggraph_printing_key` mirrors `finish` exactly — a redundant axis
  for OP but useful upstream.
- **Marketplace-ID coverage is high**: `cardmarket_id` populated on
  89% of printings, `tcgplayer_id` on 88%. Good enough for affiliate
  links today; the ~10% gap will be filled by fallback URL construction
  in the affiliate helper.

## 7. **Treatments — how OP encodes them in production**

This is the collector-defining discovery of this audit. The user's
core requirement — *"logical card → treatment/printing → individual
price, so standard, parallel, alt art, manga rare, promo, language
variants must not be merged incorrectly"* — hinges on how these
distinctions land in the shared tables.

**They land in `tcg_cards.collector_number`, not in `edition`, not in
`finish`, and only partially in `rarity`.**

### 7.1. Collector-number suffix vocabulary

Cards in the shared DB use suffixes on the collector number to denote
treatment. Observed in this audit:

| Collector-number pattern | Meaning                                 | Rarity typically              |
| ------------------------ | --------------------------------------- | ----------------------------- |
| `OP##-###`               | Base printing (standard)                | Base rarity (L / SEC / SR / R / UC / C / P) |
| `OP##-###_p1`            | Parallel / first alt-art treatment      | Same rarity or `SP CARD`      |
| `OP##-###_p2`            | Second alt-art / higher parallel        | Same rarity or `SP CARD`      |
| `OP##-###_p3`            | Third alt-art / manga-rare-tier chase   | Same rarity or `SP CARD`      |
| `OP##-###_r1`            | Reprint (subsequent print run of card)  | Base rarity                   |

Example — Leader Monkey.D.Luffy in `EB02` (Anime 25th Collection):

```
EB02-010     rarity=L    → base Leader printing
EB02-010_p1  rarity=L    → alt-art / parallel #1 — $977 / €... foil variant $1006
EB02-010_p2  rarity=L    → alt-art / parallel #2 — €398 / $1427 foil
EB02-010_p3  rarity=L    → alt-art / parallel #3 — $710 foil (only foil ingested)
```

Prices swing radically between the base printing (cents on TCGplayer)
and the alt-art parallels (four figures on TCGplayer). **They are
priced individually because they are distinct `tcg_cards` rows with
distinct `tcg_printings` under them.** The shared schema does exactly
what OP requires — the trick is that the axis of variation is
`collector_number`, not `edition` or `rarity`.

Second example — the Warlord chase `EB02-061`:

```
EB02-061     rarity=SEC     → base Secret Rare — $13 foil, €5.93 nonfoil
EB02-061_p1  rarity=SEC     → parallel #1 — $102 foil, €70 nonfoil
EB02-061_p2  rarity=SEC     → parallel #2 — €4649 nonfoil (chase)
EB02-061_p3  rarity=SP CARD → SP CARD treatment — $478 foil, €394 nonfoil
EB02-061_r1  rarity=SEC     → reprint — $13 foil, €7 nonfoil (same tier as base)
```

Note `_p3` has a different rarity (`SP CARD`) — the suffix marks the
variant slot, the rarity value marks the visual class. `_r1` shares the
same rarity as the base and prices similarly — it is a reprint, not a
chase.

### 7.2. How this maps onto the user's requested treatment vocabulary

| User's treatment name  | Production signal                             |
| ---------------------- | --------------------------------------------- |
| standard               | Base collector number, base rarity (L/R/SR/C…)|
| parallel / alt-art     | `_p1` / `_p2` / `_p3` suffix                  |
| manga rare             | Not distinguishable from `_p*` at this layer  |
| special rare           | `rarity='SP CARD'`                            |
| secret rare            | `rarity='SEC'`                                |
| promo                  | `rarity='P'`                                  |
| treasure rare          | `rarity='TR'`                                 |
| leader                 | `rarity='L'`                                  |
| English / Japanese     | `language`, but currently only `'en'` exists  |
| reprint                | `_r1` suffix (not a treatment; new print run) |

**Gap**: TCGGraph does not surface manga-rare as a distinct signal in
the current OP ingest. It collapses into the `_p*` slot alongside other
alt-arts. To keep the OP-native distinction the app promises, ingest
will eventually need a data source that names the treatment (Bandai's
own product listings do). For V1, showing `_p1/_p2/_p3` as "Parallel /
Alternate Art" without further split is truthful — better than
promising a manga-rare label we can't back with data.

### 7.3. Consequences for `apps/onepiece/src/lib/onepiece/treatment.ts`

`inferTreatment` currently derives treatment from `(edition, finish,
rarity)`. Given §6 findings that means for OP:

- **`edition` is always NULL** → drop from the inferrer.
- **`finish` is `foil` vs `nonfoil`** → keep, but this is a per-treatment
  finish axis, not a treatment axis. A single treatment (`_p1`) exists
  in both nonfoil and foil forms.
- **`rarity` alone** can distinguish `SEC`, `SP CARD`, `TR`, `P`, `L`.
- **`collector_number` suffix is the missing signal** for standard vs
  parallel vs alt-art.

Phase B work: extend the inferrer to accept `collector_number` and
regex-match `_p([0-9]+)$` and `_r([0-9]+)$`. Group the resulting
treatments as:
- `standard` — no suffix
- `parallel` — `_p1`
- `alt-art` — `_p2`, `_p3` (or route `_p2/_p3` by rarity: `SP CARD` →
  `special-rare`, `SEC` → still `alt-art` in that colour band)
- `reprint` — `_r*` (visually indistinguishable from standard at the
  UI layer, worth showing only as a fingerprint on the printing page)

## 8. Retail pricing coverage

| Source                | Rows  | Currency | Region |
| --------------------- | ----- | -------- | ------ |
| `tcggraph.tcgplayer`  | 4,655 | USD      | NA     |
| `tcggraph.cardmarket` | 4,638 | EUR      | EU     |
| **Total**             | 9,293 | —        | —      |

Almost perfectly balanced. Every printing that has one source usually
has the other, giving OP a proper two-currency market from the outset.

- **`list_type` = `retail` for all 9,293 rows.** No buylist yet.
- **`finish` on the retail row IS populated** for OP (unlike YGO). The
  `finish` value on the price row matches the printing's `finish`
  string. No cross-cutting concern here — the shared price row is
  clean on OP.
- **Averages**: unverified in this pass. Sampled traces show
  `avg_1d`/`avg_7d`/`avg_30d` on some rows. Confirm coverage in Phase B.
- **`updated_at` range**: 2026-09-21T22:30 → 2026-09-22T08:17. Fresh.

## 9. Graded pricing coverage

| Grader | Rows  |
| ------ | ----- |
| `raw`  | 2,702 |
| `any`  | 1,424 |
| `cgc`  |   996 |
| `bgs`  |   987 |
| `sgc`  |   958 |
| `psa`  |   958 |

| Grade      | Rows  |
| ---------- | ----- |
| `10`       | 3,899 |
| `9.5`      |   646 |
| `9`        |   518 |
| `8`        |   205 |
| `7`        |    55 |
| `ungraded` | 2,702 |

- **All 8,025 rows are `attribution='printing'`.** OP does not have any
  card-scoped graded rows. The shared `PrintingPricing` shape is safe
  to render underneath a specific treatment — no risk of accidentally
  showing card-family graded prices under a specific printing on OP.
- **Currency: 100% USD** for graded, matching YGO.
- **`raw` grader = raw-market observations** (ungraded floor price with
  volume) — the shared package's `RAW_GRADER` constant handles this;
  they stay out of the `graded[]` bucket.
- Graded coverage is thinner than retail (roughly 40% by row count vs
  retail) and concentrated on high-tier chase cards — expected.

## 10. `tcg_cards.gamedata` JSON shape

Sample payloads from the probe:

```json
{ "cost": 7, "life": null, "power": 9000, "types": ["Big Mom Pirates"],
  "colors": ["Yellow"], "counter": 1000, "trigger": null,
  "cardType": "CHARACTER", "attribute": "Wisdom" }

{ "cost": 3, "life": null, "power": null, "types": ["Straw Hat Crew"],
  "colors": ["Black"], "counter": null, "trigger": null,
  "cardType": "EVENT", "attribute": null }

{ "cost": 5, "life": null, "power": 7000, "types": ["Animal","Impel Down"],
  "colors": ["Purple"], "counter": 1000, "trigger": null,
  "cardType": "CHARACTER", "attribute": "Strike" }
```

**Verified fields vs `apps/onepiece/src/lib/onepiece/gamedata.ts::OpGamedata`
expectations:**

| App field       | JSON key       | Present? | Notes                                             |
| --------------- | -------------- | -------- | ------------------------------------------------- |
| `type`          | `cardType`     | ✓        | UPPER case: `LEADER` / `CHARACTER` / `EVENT` / `STAGE` / `DON` — our `normaliseCardType` already lowercases so this works. |
| `colours`       | `colors`       | ✓        | TitleCase array. `parseColours` already lowercases. Present values seen: Red, Green, Blue, Purple, Black, Yellow. |
| `cost`          | `cost`         | ✓        | number.                                           |
| `power`         | `power`        | ✓        | number or null (Events have null).                |
| `counter`       | `counter`      | ✓        | number or null.                                   |
| `life`          | `life`         | ✓        | number or null (only Leaders).                    |
| `attribute`     | `attribute`    | ✓        | TitleCase — Strike / Wisdom / Slash observed.     |
| `trigger`       | `trigger`      | ✓        | null in most rows sampled. Shape uncertain.       |
| `types`         | `types`        | ✓        | Array of Title Case strings.                      |
| `language`      | (top-level)    | —        | Lives at `tcg_cards.language`, not inside gamedata|
| `effectText`    | not present    | ✗        | **Missing.** No rules-text field in the sample payloads. Falls into `tcg_cards.rules_text` if there is one — needs Phase B check. |
| `triggerText`   | not present    | ✗        | Same story — not in gamedata.                     |

**Consequences:**
- `toOpGamedata` will parse cleanly for every sampled field except
  `effectText` and `triggerText`, which will consistently return null.
- Card pages will show the stat grid + colours + attribute + type/crew
  + language correctly, but the "Effect" and "Trigger" text blocks
  will not render until either (a) `tcg_cards.rules_text` is checked
  in the composition layer, or (b) ingest starts writing effect text
  into `gamedata.effect_text`.

## 11. Representative trace — Monkey.D.Luffy end-to-end

Note the punctuation: TCGGraph names the Luffy family `Monkey.D.Luffy`
(dots, no spaces) rather than the user-facing `Monkey D. Luffy`. Our
`slugifyCardName` handles either — but user-typed URL slugs still need
to resolve.

- Bundle for `"Monkey.D.Luffy"`:
  - **231 `tcg_cards` rows** (65 sets × several treatments per set)
  - **345 `tcg_printings` rows** across those cards (`~1.5 printings/card`
    — most cards exist as nonfoil + foil; some as one or the other)
  - **357 retail quotes** (mix of tcgplayer USD + cardmarket EUR)
  - **392 graded quotes** — all `attribution='printing'`

Every value passes through the shared package types cleanly. Raw stays
in the `raw` bucket. Currency is preserved per row. No collisions.

The trace also exposes the treatment story concretely — the same
logical name resolves to a Leader `EB02-010` at €0.14 nonfoil, plus
three parallels (`_p1`/`_p2`/`_p3`) priced $977–$1427. The site's
`/card/monkey-d-luffy` bundle will group all 231 rows under one logical
name with a treatment breakdown per printing.

## 12. Security verification

- Anon key committed only to `apps/onepiece/.env.local` (gitignored;
  verified via `git check-ignore -v apps/onepiece/.env.local` →
  `.gitignore:47:.env*`).
- No service-role key present anywhere in this checkout.
- `git status` shows `.env.local` absent from the working tree listing.
- The probe imports `createTcgClient` directly from
  `../../../packages/database/src/client.ts` to bypass `server-only`
  (which throws outside RSC). No shared-package code was modified.
- RLS not modified. Zero writes attempted.

## 13. Delta vs the Phase 0 audit assumptions

The pre-Phase-A audit assumed:

1. **`game_id='onepiece'`, slug='onepiece'** — Half right. `game_id` is
   correct; `slug` is actually `'one-piece'`. Fixed in
   `src/server/client.ts` this pass.
2. **Treatments encoded via edition + finish + rarity** — Wrong for OP.
   `edition` is 100% NULL. Treatments live in `collector_number`
   suffixes (`_p1` / `_p2` / `_p3` / `_r1`). Rarity distinguishes
   `SP CARD` / `SEC` / `TR` / `L` / `P` etc.
3. **Both English and Japanese printings present** — Currently English
   only. If we want JP prices the ingest needs a JP source.
4. **`gamedata` matches our `OpGamedata` shape** — Mostly yes. The
   effect text and trigger text fields are not in `gamedata` today;
   they may live on `tcg_cards.rules_text` (Phase B follow-up).

## 14. Follow-ups for Phase B (not started this pass)

Ordered by user impact:

1. **`treatment.inferTreatment` rewrite** — swap the `edition` axis for
   a `collector_number` regex on `_p([0-9]+)` and `_r([0-9]+)`. Keep
   `rarity` handling for `SEC` / `SP CARD` / `TR` / `L` / `P`. Add
   unit tests using the representative fingerprints from §7.
2. **`rarity.ts::CANONICAL` — add the exact `"SP CARD"` key** so lookup
   is O(1) rather than falling to the "unknown, use raw" branch.
3. **Effect / trigger text sourcing** — probe `tcg_cards.rules_text`
   for OP. If populated, teach `getCardBundleByName` to lift it into
   `OpGamedata.effectText`. If not, mark the "Effect" panel as "Text
   coming soon" until ingest catches up.
4. **Card-page treatment grouping** — with §7 vocabulary confirmed,
   the logical-card page's treatment sections should read: `Standard`
   / `Reprint` / `Parallel` / `Alt Art` / `Special Card` / `Secret` /
   `Treasure`. Currently the page still uses the placeholder groupings
   from the fixture era.
5. **Historical price sampling** — confirm the daily-price cadence and
   depth before wiring history charts. 18k retail + 16k graded daily
   rows exist; we don't know how far back they go.
6. **Sanity-run** `pnpm --filter @collector-network/onepiece dev` with
   real env and confirm homepage / browse / set / card / printing /
   market all render live data cleanly. Screenshot compare against the
   fixture-era QA screenshots to catch regressions.
7. **Update `apps/onepiece/src/server/preview-fixture.ts`** — the
   fixture currently mints cards without `_p*` suffixes. Update the
   fixture to include one card with the full `base + _p1 + _p2 + _p3`
   fan-out so dev-mode without env still shows the treatment axis.

## 14a. Phase B implementation notes (2026-09-26 evening)

Follow-ups from §14 landed. Findings from live implementation:

### rules_text coverage confirmed

Probed `tcg_cards.rules_text` for `game_id='onepiece'`:
**5,083 of 5,538 rows populated (91.8%)**. Format is the OP effect
grammar — `[On Play] Draw 1 card.`, `[Trigger] ...`, `[Blocker] (...)`,
`[Activate: Main] ...`, `[When Attacking] ...`, `[Counter] ...`.

The composition layer now lifts `rules_text` into `OpGamedata.effectText`
when the JSON `gamedata` lacks it (which is always for OP). Card pages
display the effect text under the Effect panel without a separate probe.

### Daily-history depth (probed 2026-09-26)

`tcg_market_price_daily` for OP currently spans **2026-09-20 → 2026-09-22**
— **three days of history**. Ingest is fresh. Consequences:
- Movers board renders "No movers in this window yet" for the 7d / 30d
  / 90d chips. Correct empty state; not a bug.
- Sparkline on the printing page renders 1–3 dots per series with the
  literal "single day" or "3 days" label. Graceful degradation.

### Retail outlier scan (probe-supplementary.mts §C)

- **15 legitimate rows above $1,000** — the top is €23,227 for
  `op_op13_118_p4:normal:en` (a Purple Leader parallel #4). Real market.
- **No rows with `price_low > price × 5`** — structural anomaly filter
  wouldn't trigger on current data.
- **6 rows above $10,000** — all match known chase-tier printings
  (`_p2`/`_p4`/`_p7`/`_p8` variants of Purple / SEC / Leader cards).

Guard rails added to the movers pipeline (`src/server/market.ts`):
- Reject `latestPrice > $50,000` (never observed; would indicate a
  malformed row).
- Reject `|changePct| > 20` (20x price change over a window is either a
  stale zero flipping to fair value or a data glitch).
- Flag `latestPrice ≥ $5,000` with `flags.highPrice: true` so editorial
  placements can gate on review. No filtering — legitimate chase cards
  stay on the board.

### Treatment inferrer rewrite (production-verified)

`inferTreatment` now derives the treatment from
`(collector_number suffix, rarity)` — `edition` and `finish` no longer
contribute. Priority order:

1. `_r#` on collector number → **Reprint** (with variant index)
2. Rarity chase tier — `SP CARD` / `SEC` / `TR` / `P` — outranks
   `_p#` for the label but keeps the variant index for the fingerprint.
3. Rarity `L` with `_p#` → **Parallel #N** (parallel of a Leader)
4. Rarity `L` alone → **Leader**
5. `_p#` on non-chase rarity → **Parallel #N**
6. Fall through → **Standard**

Verified on the printing pages for a base card, a Leader with `_p1`,
a SEC + SEC `_r1` reprint, an `SP CARD _p1` (now correctly labelled
Special Card #1, not Parallel #1), a `TR _p1` (Treasure Rare #1), and
a P promo. Prices never bleed between variants or currencies.

### rarity.ts alias

Added the literal `'SP CARD'` (with a space) to the `CANONICAL` map so
`normaliseRarity` returns `{ code: 'SP', label: 'Special Card' }`
directly instead of falling through to the "unknown" branch.

### homepage `countRows` fix

Discovered while verifying live data: `tcg_market_prices_current` has no
`id` column (composite PK), so
`.select('id', { count: 'exact', head: true })` returned `count=null`.
Changed the count projection to `game_id`, which every table carries.

### Deferred (not shipped this pass)

- Movers with 7/30/90-day history require the daily table to grow beyond
  three days. No code change needed; the surface will populate as ingest
  accumulates snapshots.
- Manga-rare treatment remains not-inferrable. Every `_p#` is labelled
  Parallel — we do not fabricate a manga label without a signal.
- Multi-line effect text (some cards carry two blocks of `[Trigger]` /
  `[Blocker]`) renders as a single paragraph today; a per-block breakout
  is a small polish item and hasn't been done.

## 15. Bottom line

Real One Piece data is **already in the shared DB** as of five days
ago. 5,538 cards across 65 sets, 7,774 priced printings, ~9k current
retail rows, ~8k graded rows, plus ~34k historical daily rows. The
tcggraph → tcgplayer + cardmarket pipeline is running fresh (last
update yesterday).

The shared schema already carries every distinction OP requires —
standard, parallel, alt-art (as `_p*` suffixes), secret rare, special
card, treasure rare, promo, leader, reprint, foil/nonfoil — as
separate priced entities. The only OP-native axis that would have been
lost is manga-rare (currently collapsed into the `_p*` slot with no
distinguishing label); every other treatment survives the round-trip
into and out of the shared tables cleanly.

**No shared-schema change is required to turn on real data.** Phase B
is a small, contained set of edits inside `apps/onepiece/src/lib` +
`src/server` (treatment inferrer, rarity aliases, effect text sourcing)
plus one preview-fixture update. Everything remains under this branch;
`@collector-network/database`, `@collector-network/market-data`, and
`@collector-network/auth` stay untouched.

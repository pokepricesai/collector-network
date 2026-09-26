# Lorcana production data audit — 2026-09-26

Read-only audit against the shared Collector Network Supabase project
(`egidpsrkqvymvioidatc`). Run script: `apps/lorcana/scripts/probe-lorcana.mts`.
Anon SELECT only. No writes.

The transcript is the source of truth; this file is the shorter reading
of it that the site build depends on.

---

## 0 — Game identity

Confirmed by `apps/lorcana/scripts/probe-games.mts`:

| id | slug | name | active |
|---|---|---|---|
| `lorcana` | `disney-lorcana` | Disney Lorcana | true |

All Lorcana data filters by `game_id = 'lorcana'`.

## 1 — Row counts

| Table | Rows |
|---|---:|
| `tcg_sets` | 23 |
| `tcg_cards` | 3,198 |
| `tcg_printings` | 6,076 |
| `tcg_market_prices_current` | 11,826 |
| `tcg_graded_prices_current` | 7,004 |
| `tcg_market_price_daily` | 29,432 |
| `tcg_graded_price_daily` | 20,912 |

Ingestion cron is live — the retail `updated_at` range for the sample
was 2026-09-25T22:45 → 2026-09-26T02:25. Both cardmarket and tcgplayer
touched every printing.

## 2 — Sets (23)

23 sets, oldest 2023-08-18 (The First Chapter), newest 2026-07-28
(Format Coconut / PD1). Set codes are mostly single small integers
(`1`–`13`) plus:

| code | name | released |
|---|---|---|
| `1` | The First Chapter | 2023-08-18 |
| `2` | Rise of the Floodborn | 2023-11-17 |
| `3` | Into the Inklands | 2024-02-23 |
| `4` | Ursula's Return | 2024-05-17 |
| `5` | Shimmering Skies | 2024-08-09 |
| `6` | Azurite Sea | 2024-11-15 |
| `7` | Archazia's Island | 2025-03-07 |
| `8` | Reign of Jafar | 2025-05-30 |
| `9` | Fabled | 2025-08-29 |
| `10` | Whispers in the Well | 2025-11-07 |
| `11` | Winterspell | 2026-02-13 |
| `12` | Wilds Unknown | 2026-05-08 |
| `13` | Attack of the Vine! | 2026-07-17 |
| `p1`/`p2`/`p3` | Promo Set 1–3 | 2023-08-18 → 2025-08-18 |
| `d23` | D23 Collection | 2024-08-09 |
| `cp`/`c2` | Challenge Promo / Lorcana Challenge Year 3 | 2024-05-17 / 2026-01-16 |
| `dis` | EPCOT Festival of the Arts | 2026-01-16 |
| `pd1` | PD1 | 2026-07-28 |
| `cc1` | Curator's Collection: Heroines Edition | 2026-07-17 |
| `coconut` | Format Coconut | 2026-07-28 |

Codes are lowercase — canonical set URLs should be
`/sets/<code>-<slugified-name>` and lookups should treat set `code` as
the natural key. Slug helper must be tolerant of names with colons and
apostrophes (`Curator's Collection: Heroines Edition`).

## 3 — Rarity vocabulary (9 tiers)

`tcg_cards.rarity` values, ordered by count:

| rarity | rows |
|---|---:|
| Common | 943 |
| Uncommon | 704 |
| Rare | 630 |
| Super rare | 238 |
| Enchanted | 224 |
| Promo | 199 |
| Legendary | 160 |
| Epic | 90 |
| Iconic | 10 |

Values are Title Case. Any UI ordering should follow the collector
ladder: Common → Uncommon → Rare → Super rare → Legendary → Epic →
Iconic → Enchanted, with Promo treated as an orthogonal collectible
axis (promo cards live in promo sets rather than base sets).

## 4 — Printings: finishes and language

`tcg_printings` has exactly two treatments for base cards:

| finish | rows |
|---|---:|
| `foil` | 3,149 |
| `nonfoil` | 2,927 |

`tcggraph_printing_key` follows the same split (`foil` / `normal`).

- `edition` is 100% NULL across all 6,076 printings — there is no
  separate edition axis to render.
- `language` is 100% `en` on both `tcg_cards` and `tcg_printings`.
  There is no EN/JP distinction to expose (unlike One Piece).
- Cardmarket IDs: 6,048 / 6,076 populated. TCGplayer IDs: 6,042.
  Mapping is essentially complete.

**So Lorcana's collectible variant space is one axis on `tcg_cards`
(rarity, especially Enchanted/Promo/Iconic) × one axis on
`tcg_printings` (foil vs nonfoil).** Nothing else. There is no
parallel/alt-art/JP/Manga machinery to model.

## 5 — Retail pricing

- Sources: `tcggraph.cardmarket` (6,044 rows, EUR/EU) and
  `tcggraph.tcgplayer` (5,782 rows, USD/NA).
- `list_type` is `retail` for every row. No marketplace/dealer split.
- `finish` on the retail row echoes the printing finish, so we can
  render foil/nonfoil prices side-by-side without joining printings.
- Freshness: last full crawl ~4 hours before probe run.

## 6 — Graded pricing

7,004 rows. Attribution is roughly 82% `card`-scoped, 18%
`printing`-scoped — so most graded quotes describe a whole logical
card (all finishes together) rather than a specific finish.

| grader | rows |
|---|---:|
| `raw` | 3,006 |
| `any` | 1,451 |
| `cgc` | 664 |
| `sgc` | 632 |
| `bgs` | 626 |
| `psa` | 625 |

Grades observed: `7`, `8`, `9`, `9.5`, `10`, and `ungraded` (for raw).
Currency is uniformly USD. This matches the One Piece / MTG graded
panel — the existing UI generalises without change.

## 7 — Gameplay dimensions (`tcg_cards.gamedata`)

Every card carries the same 10-key jsonb payload:

| key | example | notes |
|---|---|---|
| `ink` | `"Emerald"` | Six-colour ink wheel — Amber, Amethyst, Emerald, Ruby, Sapphire, Steel. Confirmed sample also shows Emerald / Amethyst / Sapphire / Ruby. |
| `inkCost` | `5` | Integer 0–~10. |
| `inkable` | `true` | Bool — whether the card can be spent as ink. |
| `lore` | `3` | Integer or null (items/actions). |
| `strength` | `2` | Integer or null. |
| `willpower` | `4` | Integer or null. |
| `moveCost` | `null` | Integer for LOCATION cards, null otherwise. |
| `cardType` | `"CHARACTER"` | Observed so far: `CHARACTER`, `ITEM`. Expect also `ACTION`, `LOCATION`, `ACTION - SONG` per game rules. |
| `version` | `"Gracious Host"` | The subtitle after the `-` in the display name. |
| `classifications` | `["Storyborn","Villain","Dragon"]` | Array; combines Storyborn/Dreamborn/Floodborn plus race/role tags. |

Card display names follow `"<Character> - <Version>"`. `Magic Golden
Flower` shows an item card without a version — the pattern is
character cards get `<Name> - <Version>`, non-character cards use bare
name.

## 8 — Collector-number patterns

3,185 of 3,198 (99.6%) collector numbers are pure integers. 13 have an
alpha suffix (`0A` shape). Enchanted / rare-treatment overprints in
Lorcana traditionally use collector numbers past the base set count
(`225/204` etc.), which the ingestion appears to store as plain
integers here.

## 9 — Representative trace

`Mickey Mouse - Brave Little Tailor` — 3 tcg_cards rows across sets 1
(Legendary, 115/…), d23 (Promo), and p1 (Promo). 4 printings across
those. Full retail from both cardmarket and tcgplayer resolved cleanly.
Graded rows attach at the `card` level for the Legendary printing
(volume 157, PSA 10 = $81.30, BGS 10 = $106, CGC 10 = $74.99, SGC 10 =
$49).

The card-scoped graded → logical card page mapping used on OP/YGO
carries over unchanged.

## 10 — Modelling implications for the site

1. **Logical card = one `tcg_cards` row.** No "collapse across Enchanted
   into a parent" step. Enchanted, Promo, D23, etc. are separate
   logical cards, each with their own set + collector number + rarity.
2. **Printing = one `tcg_printings` row.** Two printings per logical
   card in the base sets (foil, nonfoil). Promos are often foil-only or
   nonfoil-only, so don't assume both exist.
3. **Six inks** are the primary colour discovery surface. Even though
   the sample only surfaced 4, Lorcana officially has six: Amber,
   Amethyst, Emerald, Ruby, Sapphire, Steel. The site's colours page
   should hard-code the six with counts computed from `gamedata.ink`.
4. **Enchanted is the top chase axis** and deserves a first-class
   discovery view (see Enchanted card count 224 vs 3,198 total).
5. **Card types** should filter to Character, Action, Action - Song,
   Item, Location (as the game defines them), fed by `gamedata.cardType`.
6. **No JP/EN split.** The One Piece language toggle has no home here.
   Retail dual-currency (EUR from Cardmarket, USD from TCGplayer) is
   the useful axis and is already generalised on OP.

## 11 — Non-blockers surfaced

- Graded card-scoped rows dominate — the site should default to
  card-scoped graded display and fall back to printing-scoped only for
  the ~18% of rows carrying finish specificity.
- No `edition`, no language multi-select, no parallel art logic.
  Delete or hide those OP/YGO surfaces rather than porting them.
- Set codes include unusual keys (`coconut`, `pd1`, `cc1`) — never
  regex-restrict set codes to short digits.

## 12 — Not present in the data

- No French, German, Italian, Spanish, Japanese, or Simplified Chinese
  cards yet, despite Lorcana shipping in those languages upstream. The
  site should not expose a language selector.
- No `NM/LP/MP/HP` condition axis in the retail rows.
- No sales-history/volume series beyond the graded `card_sales_volume`.

---

**Verdict:** the shared schema fits Lorcana cleanly. No modelling
blocker. Proceed with scaffolding apps/lorcana on this shape.

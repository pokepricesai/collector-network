# Yu-Gi-Oh! research notes

Live-web research supporting `product-spec.md`. Compiled 2026-09-22. Sources
are current-as-of the linked pages; where a claim depends on a snapshot in
time (banlist, meta, prices) that date is called out inline.

Not exhaustive — deliberately structured for product decisions rather than
encyclopedic coverage. For deeper coverage, follow the linked Yugipedia and
Konami pages.

---

## 1. Ecosystem snapshot (Sept 2026)

Yu-Gi-Oh! is played across five distinct product ecosystems. Our V1 must
pick which ones to expose and which to defer:

| Ecosystem | Owner | Region | V1 relevance |
| --- | --- | --- | --- |
| **TCG** (Trading Card Game) | Konami of America / Europe | Worldwide ex-Asia | **Primary** — this is our product surface |
| **OCG** (Official Card Game) | Konami (Japan) | Japan, Korea, other Asia | Later — separate legality, separate banlist, separate print runs |
| **Master Duel** | Konami (digital) | Global | Later — cross-links only in V1 |
| **Speed Duel** | Konami | TCG regions | Deferred — small product line |
| **Rush Duel** | Konami | Japan / Korea physical, global via Duel Links | Deferred — no English physical release |

Sources: Yugipedia [TCG-only](https://yugipedia.com/wiki/TCG-only) and
[OCG-only](https://yugipedia.com/wiki/OCG-only) categories confirm ~24 legal
TCG-only cards vs hundreds of OCG-only cards at any point; the OCG runs its
own banlist and product cycle. Rush Duel physical release is Japan/Korea
only, English-language players only via the Duel Links integration
([Yugipedia — Rush Duel](https://yugipedia.com/wiki/Yu-Gi-Oh!_Rush_Duel);
[Duel Links Meta — Rush WCS 2026](https://www.duellinksmeta.com/articles/tournaments/world-championship-2026-rush)).
Master Duel remains actively supported in 2026 with 13,000+ cards across
PS4/5, Xbox, Steam, Switch, Switch 2, iOS, Android; WCS 2026 was held in
August 2026 ([Konami — WCS 2026](https://www.konami.com/games/us/en/topics/3385/)).

## 2. Card data model — official terminology

Verified against the Konami official card database and Yugipedia. This is
the vocabulary our schema, filters and card page must use verbatim.

### Attributes (7)
LIGHT, DARK, FIRE, WATER, WIND, EARTH, DIVINE. DIVINE is reserved for the
three Egyptian God monsters and a handful of derivatives.
Source: [Yugipedia — Attribute](https://yugipedia.com/wiki/Attribute).

### Monster Types (25)
Aqua, Beast, Beast-Warrior, Cyberse, Dinosaur, Divine-Beast, Dragon, Fairy,
Fiend, Fish, Illusion, Insect, Machine, Plant, Psychic, Pyro, Reptile, Rock,
Sea Serpent, Spellcaster, Thunder, Warrior, Winged Beast, Wyrm, Zombie.
Cyberse (2017, VRAINs era) and Wyrm (2014, Duel Terminal / Yang Zing era)
are the most recent additions.
Source: [Yugipedia — Type](https://yugipedia.com/wiki/Type).

### Monster classes
- **Main Deck**: Normal, Effect, Ritual (`Level`, `ATK`, `DEF`)
- **Extra Deck**: Fusion, Synchro, Xyz (`Rank` instead of Level), Pendulum
  (both Main and Extra depending on state; has `Pendulum Scale`), Link
  (`Link Rating`, `Link Arrows`, no `DEF`)

### Sub-classifications (orthogonal to class)
Tuner, Flip, Toon, Spirit, Union, Gemini. Any of these can appear alongside
Effect and interact with archetype support cards.

### Spell subtypes
Normal (no icon), Continuous, Equip, Quick-Play (lightning icon), Field,
Ritual.

### Trap subtypes
Normal (no icon), Continuous, Counter.

### Level / Rank / Link Rating
- Levels 1-12 (Main Deck monsters)
- Ranks 1-13 (Xyz)
- Link Ratings 1-6 in practice (theoretical to 8)
- Pendulum Scales 0-13

## 3. Physical printing model

Every physical Yu-Gi-Oh! card is uniquely identified by the tuple:

**(set code, card number, rarity, edition, language)**

Two "Blue-Eyes White Dragons" printed in different sets, or in different
rarities within the same set, or as 1st Edition vs Unlimited, are legally
distinct collectibles. Our data model and card URLs must reflect this.

### Set code
Format `AAAA-RR###` where `AAAA` is a 2-5 character set prefix, `RR` is a
region/language code, `###` is the numeric slot within the set.
Examples: `LOB-001` (Legend of Blue Eyes, English), `LOB-E001` (European
English printing), `L26D-ENS24` (Legendary Modern Decks 2026, English,
slot 24).
Source: [Yugipedia — Card Number](https://yugipedia.com/wiki/Card_Number)
and [TCG set prefixes](https://yugipedia.com/wiki/TCG_set_prefixes).

### Edition
- **1st Edition** — original scarce print run, stamped "1st Edition"
- **Unlimited Edition** — no edition text, reprint run
- **Limited Edition** — special-product cards (World Championship prize
  cards, promo tie-ins)
- **Duel Terminal Edition** — arcade-machine origin, distinct foil pattern
- Regional variants: English, French, German, Italian, Spanish, Portuguese,
  Asian-English, Korean, Chinese, Japanese OCG. Japanese OCG cards are
  **not TCG-legal in Europe/NA** even though genuine.
Source: [Wargamer — 1st Edition explainer](https://yugioh.fandom.com/wiki/1st_Edition)
and Cardstralia's [print code guide](https://cardstralia.com/article/understanding-yugioh-print-codes-and-set-numbers).

### 1st Edition financial premium — concrete example
Blue-Eyes White Dragon LOB-001 1st Edition, Sept 2026 pricing:

| State | Raw / grade | Price band |
| --- | --- | --- |
| Raw, Played/Damaged | — | $200–$400 |
| Raw, Lightly Played | — | $400–$700 |
| Raw, Near Mint | — | $800–$2,000 (TCGplayer sale Feb 2026: $4,000) |
| Graded | PSA / CGC 7 | $800–$1,200 |
| Graded | PSA / CGC 8 | $1,200–$2,000 |
| Graded | PSA / CGC 9 | $2,500–$5,000 |
| Graded | PSA 10 | $8,000–$15,000+ |

Sources: [PriceCharting LOB-001 1st Edition](https://www.pricecharting.com/game/yugioh-legend-of-blue-eyes-white-dragon/blue-eyes-white-dragon-1st-edition-lob-001);
[Curio Comp 1st Ed BEWD 2026 guide](https://curiocomp.com/trading-cards/1st-edition-blue-eyes-white-dragon-yu-gi-oh);
[TCG Price Lookup — BEWD 2026 price guide](https://tcgpricelookup.com/blog/how-much-is-blue-eyes-white-dragon-worth).
The market corrected 60-70% from 2021-2022 peaks but appears to have
stabilised.

## 4. Rarity taxonomy (current, 2026)

Yu-Gi-Oh! rarity expanded aggressively during the 25th Anniversary era
(2023-2026). The Quarter Century Secret Rare "era" formally closed in 2026;
**Alliance Insight (May 2025)** was among its last TCG appearances, and
Konami reintroduced **Starlight Rare** as the top-tier chase pull starting
with **Battles of Legend: Monster Mayhem (June 2025)**.
Source: [Misprint — YGO Market Report 2026](https://www.misprint.com/posts/yugioh-market-report-2026);
[TCG Price Lookup — Rarity Tiers 2026](https://tcgpricelookup.com/blog/yugioh-rarity-tiers-explained).

### Rarities currently in circulation (must be filterable)
| Family | Marker |
| --- | --- |
| Common | Silver name, no foil |
| Short Print | Physically Common but statistically rare |
| Rare | Silver/holo name letters |
| Super Rare | Holofoil card art |
| Ultra Rare | Gold-foil name + holofoil art |
| Ultimate Rare | 3D embossed relief on art and borders |
| Secret Rare | Diagonal-glitter foil across entire card + silver name |
| Ultra Secret Rare | Ultra + Secret treatments combined |
| Extra Secret Rare | Modern extended Secret variant |
| Prismatic Secret Rare | Prismatic-pattern Secret Rare |
| Ghost Rare | 3D "ghost" holographic effect on monster art, very scarce |
| Starlight Rare | Full-card horizontal-glitter foil, top modern chase |
| Collector's Rare | Etched foil borders + name (originally Asia-exclusive) |
| Prismatic Collector's Rare | Rainbow-reflective etched borders (introduced Rarity Collection 5, 2026) |
| Prismatic Ultimate Rare | Raised 3D varnish with prismatic sheen (Rarity Collection 5, 2026) |
| Quarter Century Secret Rare | Champagne-gold speckled name + "25th QC" watermark. **Retired 2026.** Retains high market value |
| Platinum Rare / Platinum Secret Rare | Platinum-family treatments |
| Gold Rare / Premium Gold Rare / Gold Secret Rare | Gold-family treatments (Premium Gold sets) |
| Parallel Rare (family) | Includes Mosaic, Shatterfoil, Starfoil, Duel Terminal Parallels, **Pharaoh's Rare** (hieroglyphic overlay, introduced Rarity Collection era) |

Sources:
- [Yugipedia — Rarity](https://yugipedia.com/wiki/Rarity)
- [Yugipedia — Quarter Century Secret Rare](https://yugipedia.com/wiki/Quarter_Century_Secret_Rare)
- [Konami EU — 25th Anniversary luxury rarities announcement](https://www.konami.com/games/eu/en/topics/17556/)
- [Beckett — Rarity Collection 5 checklist](https://www.beckett.com/news/tcg-checklist-everything-you-need-to-know-about-yu-gi-oh-rarity-collection-5/)
- [Konami — Rarity Collection V product page](https://www.yugioh-card.com/en/products/ra05/)
- [Misprint — Starlight Rares explained](https://www.misprint.com/posts/starlight-rare-cards-explained)

### Rarity price bands (order of magnitude, Sept 2026)
- Starlight Rare of a playable card: $100–$1,500+. Top: Dark Magician the
  Pharaoh's Servant Starlight Rare Extended Art ~$1,642.
- Ghost Rare: raw $2,000–$7,000; PSA 10 $5,000–$12,000.
- Quarter Century Secret Rare: $100–$1,000, top QCSRs >$2,000.
Sources: [TCG Stacked Top 100 2026](https://www.tcgstacked.com/yugioh/most-valuable);
[Misprint — YGO Market Report 2026](https://www.misprint.com/posts/yugioh-market-report-2026).

### Non-obvious pitfalls
- **Same-name, different-set**: Blue-Eyes White Dragon exists in LOB, SDK,
  DDS, DPBC, LDK2, LCKC, LC01, MP-anniversary sets, plus recent alt-arts.
  Each is legally distinct and priced differently.
- **Alt-art / extended-art printings**: Ghosts From the Past series
  reprinted staples with alt art; these are also collectible categories in
  their own right.
- **Misprint/error cards**: A niche but real collector market. Some of the
  highest sales in YGO history are misprints (see
  [misprint.com](https://www.misprint.com/)).
- **OCG-only cards**: Legal in Master Duel and Japan/Asia physical events
  but not in TCG events. Rarity naming diverges between OCG and TCG (OCG
  has native Ultimate Rare and Collector's Rare stock; TCG has to import
  those treatments in special products).

## 5. Format & legality

- **Advanced Format** — the standard tournament format
- **Traditional Format** — legacy format where Forbidden cards are treated
  as Limited; effectively unused competitively
- **Current TCG F&L List** — effective **21 September 2026**. New
  additions include Kewl Tune Rotary → Forbidden; Elder Entity Norden and
  Mind Master fully off restriction from 28 Sept 2026.
  Sources: [Yu-Gi-Oh! Meta — Sept 21 2026 F&L](https://www.yugiohmeta.com/articles/news/september-2026/tcg-forbidden-list);
  [Yu-Gi-Oh! Meta — F&L List page](https://www.yugiohmeta.com/forbidden-limited-list);
  [Konami EU F&L](https://www.yugioh-card.com/eu/play/forbidden-and-limited-list/);
  [YGOPRODeck banlist](https://ygoprodeck.com/banlist/).
- **OCG banlist** — separate publication, separate rotation.
- **Master Duel banlist** — separate again; a card can be Forbidden in TCG
  and Unlimited in Master Duel.
- **Speed Duel / Rush Duel** — separate banlists per format.

## 6. Current meta snapshot (Sept 2026)

Meta is unusually diverse in Q3 2026.

- **Kewl Tune** — most consistently top-representing archetype (until the
  Sept 2026 hit that Forbidden'd Kewl Tune Rotary)
- **Sky Striker** — captured 2026 North America World Championship
  Qualifier
- **Dracotail** — won YCS Columbus
- Also actively tiering: Light and Darkness Ritual, Branded, Elfnote,
  DoomZ, Mitsurugi, Artmage, Power Patron

Sources: [Yu-Gi-Oh! Meta — TCG weekly roundups (Aug/Sept 2026)](https://www.yugiohmeta.com/articles/tournaments/tcg/weekly-roundup/2026/sept/1);
[Wargamer — YGO banlist Sept 2026](https://www.wargamer.com/yugioh-trading-card-game/yu-gi-oh-banlist);
[Tistaminis — 2026 Meta Update](https://tistaminis.com/blogs/blog/yu-gi-oh-2026-meta-update-the-best-decks-right-now).

Master Duel WCS 2026 final was Called By Army vs Glory Future.
Source: [Konami — WCS 2026 recap](https://www.konami.com/games/us/en/topics/3385/).

## 7. Archetypes

Archetype is a Konami-official concept: cards that reference a specific
proper-noun string in their text are archetype members and unlock support
cards. Community databases catalogue this exhaustively.

- **YuScan** lists 620+ archetypes as of 2026.
  Source: [YuScan — Most Playable Archetypes 2026](https://yuscantcg.com/blog/yugioh-best-archetypes-2026/).
- Yugipedia maintains authoritative membership per archetype.
- YGOPRODeck exposes archetype filtering in its free API.
  Source: [YGOPRODeck API guide](https://ygoprodeck.com/api-guide/).

Konami often uses "series" (a looser thematic grouping) alongside
"archetype". For product purposes we should treat archetype as the
primary object and expose series only where users search for it (e.g.
"Blue-Eyes" series encompasses both archetype and legacy support).

## 8. Grading market — Yu-Gi-Oh! specifically

Yu-Gi-Oh! grading volume is very large in absolute terms and has been
growing:

- **PSA graded ~600,000 YGO cards in 2025.**
- Most-submitted cards: Blue-Eyes White Dragon, Dark Magician, Ghost Rare
  chase cards.
- **CGC** entered YGO grading in 2024 (English cards 2002-present at
  launch) and has grown rapidly with strict standards and detailed labels.
- Total TCG grading in 2025 exceeded 8M cards; approximate split:
  Pokémon 45%, Magic 25%, **Yu-Gi-Oh! 15%**, Other 15%.
- **PriceCharting** (Feb 2026 upgrade) now surfaces combined PSA + CGC
  populations on set/card pages; coverage 4× prior.

Sources:
- [CGC — Now grading Yu-Gi-Oh!](https://www.cgccards.com/news/article/10070/yu-gi-oh/)
- [CGC — YGO population report](https://www.cgccards.com/population-report/tcg/yu-gi-oh!/135/)
- [Misprint — YGO Market Report 2026](https://www.misprint.com/posts/yugioh-market-report-2026)
- [PreGradeCards — YGO Grading Guide 2026](https://pregradecards.com/blog/yugioh-card-grading-guide)
- [PreGradeCards — TCG Industry Guide 2026](https://pregradecards.com/blog/trading-card-games-industry-guide-2026)
- [PriceCharting blog — PSA + CGC combined pop reports](https://blog.pricecharting.com/2026/02/population-reports-for-psa-cgc.html)

**Implication**: graded value is not a secondary concern for Yu-Gi-Oh!
collectors — it's a first-class part of the market. Cards where graded is
disproportionately important include vintage LOB 1st Editions, Ghost
Rares, Ultimate Rares, iconic anime cards (Blue-Eyes, Dark Magician,
Exodia, Red-Eyes), and top-rarity modern chase cards (Starlight, Quarter
Century Secret).

## 9. Marketplaces and where transactions actually happen

| Marketplace | Region | Notes |
| --- | --- | --- |
| **TCGplayer** | NA-primary | Set/rarity/edition search built in. YGO ranked 4th in TCGplayer bestsellers Q4 2025 (behind MTG, Pokémon, One Piece; briefly overtaken by OP in Oct/Nov). Rebounded Q1 2026 driven by Burst Protocol.<br/>Source: [TCGplayer — Q4 2025 bestsellers](https://seller.tcgplayer.com/blog/bestselling-trading-card-games-q4-2025); [Q1 2026 bestsellers](https://seller.tcgplayer.com/blog/bestselling-trading-card-games-q1-2026). |
| **Cardmarket** | EU-primary | ~5-15% premium over TCGplayer due to smaller EU print runs. No native first-edition/language filters — community browser extensions ([Enhanced Cardmarket](https://enhanced-cardmarket.mave.me/), [Cardmarket Format Filter](https://chromewebstore.google.com/detail/cardmarket-format-filter/hipcjiomfcalaochhjdccgighnocbpop)) fill the gap. |
| **eBay** | Global | ~120-146k active YGO listings on any given date. 13-15% fees + shipping. Largest audience for graded, rare, oddball. Ideal affiliate target. |
| **PriceCharting** | Global | Price aggregator + combined PSA/CGC pop reports. Not a marketplace itself. |
| **PSA / CGC official** | Global | Grading services; publish pop reports and cert lookups. |
| **YGOPRODeck** | Global | Not a marketplace; a card database + deck-sharing platform with free API. |
| **Neuron** (Konami official) | Global | Official card database + duel utility app. Not a marketplace. |

## 10. What we could enrich vs what needs licensing

- **Card metadata** (attribute, type, text, ATK/DEF, etc.): freely
  available via YGOPRODeck API — no licensing burden.
- **Archetype membership**: derivable from YGOPRODeck; light curation only
  needed for edge cases.
- **Prices (raw)**: our shared Supabase already has 100k+ market price
  rows; ingestion is external.
- **Prices (graded)**: our shared Supabase has 203k+ slab rows and 33k raw
  series rows — already unusually deep vs competitors.
- **Rulings**: fragmented — Konami official rulings, YGO Card Database
  ruling text, Judge Program clarifications, community write-ups. No open
  API. **Defer to a later slice**.
- **Tournament results / deck usage**: multiple sources
  ([Yu-Gi-Oh! Meta](https://www.yugiohmeta.com/),
  [YGOPRODeck decklists](https://ygoprodeck.com/), YCS coverage,
  [DuelLinksMeta](https://www.duellinksmeta.com/) for Rush/DL). Scraping
  or partnership required. **Defer**.
- **Master Duel meta**: [Master Duel Meta](https://www.masterduelmeta.com/)
  and YGOPRODeck cover this. **Defer**.

## 11. Editorial territory (potential)

Recurring news beats worth covering later:
- F&L list updates (~every 3-4 months)
- YCS results (roughly monthly during season)
- New TCG core booster previews
- Grading population milestones / high-profile sales
- Retro market retrospectives (Quarter Century era post-mortem)

## Bibliography

Compiled during Slice 2 research. All accessed 2026-09-22.

### Konami / official
- [Konami — WCS 2026 recap](https://www.konami.com/games/us/en/topics/3385/)
- [Konami EU — 25th Anniversary Rarity Collection luxury rarities](https://www.konami.com/games/eu/en/topics/17556/)
- [Konami — Neuron product page](https://www.yugioh-card.com/en/products/neuron/)
- [Konami EU — Forbidden & Limited List](https://www.yugioh-card.com/eu/play/forbidden-and-limited-list/)
- [Konami — Rarity Collection V product page](https://www.yugioh-card.com/en/products/ra05/)
- [Konami — Neuron worldwide launch](https://www.konami.com/games/eu/en/topics/15555/)
- [Konami official card database (Neuron web)](https://www.db.yugioh-card.com/yugiohdb/?request_locale=en)

### Yugipedia / community reference
- [Yugipedia — Attribute](https://yugipedia.com/wiki/Attribute)
- [Yugipedia — Type](https://yugipedia.com/wiki/Type)
- [Yugipedia — Rarity](https://yugipedia.com/wiki/Rarity)
- [Yugipedia — Quarter Century Secret Rare](https://yugipedia.com/wiki/Quarter_Century_Secret_Rare)
- [Yugipedia — Starlight Rare](https://yugipedia.com/wiki/Starlight_Rare)
- [Yugipedia — Card Number](https://yugipedia.com/wiki/Card_Number)
- [Yugipedia — TCG set prefixes](https://yugipedia.com/wiki/TCG_set_prefixes)
- [Yugipedia — TCG-only](https://yugipedia.com/wiki/TCG-only)
- [Yugipedia — OCG-only](https://yugipedia.com/wiki/OCG-only)
- [Yugipedia — Card legality](https://yugipedia.com/wiki/Card_legality)
- [Yugipedia — Rush Duel](https://yugipedia.com/wiki/Yu-Gi-Oh!_Rush_Duel)
- [Yugipedia — 25th Anniversary Rarity Collection](https://yugipedia.com/wiki/25th_Anniversary_Rarity_Collection)

### Meta / tournament coverage
- [Yu-Gi-Oh! Meta — Sept 21 2026 F&L List](https://www.yugiohmeta.com/articles/news/september-2026/tcg-forbidden-list)
- [Yu-Gi-Oh! Meta — F&L List page](https://www.yugiohmeta.com/forbidden-limited-list)
- [Yu-Gi-Oh! Meta — TCG weekly roundup Sept 1 2026](https://www.yugiohmeta.com/articles/tournaments/tcg/weekly-roundup/2026/sept/1)
- [Tistaminis — 2026 Meta Update](https://tistaminis.com/blogs/blog/yu-gi-oh-2026-meta-update-the-best-decks-right-now)
- [Wargamer — YGO banlist Sept 2026](https://www.wargamer.com/yugioh-trading-card-game/yu-gi-oh-banlist)
- [Duel Links Meta — WCS 2026 Rush Day 1](https://www.duellinksmeta.com/articles/tournaments/world-championship-2026-rush)
- [YGOPRODeck — Banlist](https://ygoprodeck.com/banlist/)

### Grading and market
- [CGC — Now grading Yu-Gi-Oh!](https://www.cgccards.com/news/article/10070/yu-gi-oh/)
- [CGC — YGO population report](https://www.cgccards.com/population-report/tcg/yu-gi-oh!/135/)
- [PreGradeCards — YGO Grading Guide 2026](https://pregradecards.com/blog/yugioh-card-grading-guide)
- [PreGradeCards — TCG Industry Guide 2026](https://pregradecards.com/blog/trading-card-games-industry-guide-2026)
- [PriceCharting — PSA/CGC combined pop reports](https://blog.pricecharting.com/2026/02/population-reports-for-psa-cgc.html)
- [PriceCharting — LOB-001 1st Edition](https://www.pricecharting.com/game/yugioh-legend-of-blue-eyes-white-dragon/blue-eyes-white-dragon-1st-edition-lob-001)
- [PSA CardFacts — 2002 LOB Dark Magician 1st Ed](https://www.psacard.com/cardfacts/non-sports-cards/2002-yu-gi-oh-legend-blue-eyes-white-dragon/dark-magician-1st-edition-005/669850)
- [Misprint — YGO Market Report 2026](https://www.misprint.com/posts/yugioh-market-report-2026)
- [Misprint — YGO Rarities Explained](https://www.misprint.com/posts/yugioh-card-rarities-explained)
- [Misprint — Starlight Rares explained](https://www.misprint.com/posts/starlight-rare-cards-explained)
- [Misprint — QCSR explained](https://www.misprint.com/posts/quarter-century-secret-rares-explained)
- [TCGplayer — Q4 2025 bestsellers](https://seller.tcgplayer.com/blog/bestselling-trading-card-games-q4-2025)
- [TCGplayer — Q1 2026 bestsellers](https://seller.tcgplayer.com/blog/bestselling-trading-card-games-q1-2026)
- [TCG Stacked — Top 100 Most Expensive 2026](https://www.tcgstacked.com/yugioh/most-valuable)
- [TCG Price Lookup — Rarity Tiers 2026](https://tcgpricelookup.com/blog/yugioh-rarity-tiers-explained)
- [TCG Price Lookup — BEWD price guide 2026](https://tcgpricelookup.com/blog/how-much-is-blue-eyes-white-dragon-worth)
- [Curio Comp — 1st Ed BEWD 2026 guide](https://curiocomp.com/trading-cards/1st-edition-blue-eyes-white-dragon-yu-gi-oh)
- [Cardstralia — Print codes guide](https://cardstralia.com/article/understanding-yugioh-print-codes-and-set-numbers)
- [Enhanced Cardmarket extension](https://enhanced-cardmarket.mave.me/)

### Databases / APIs
- [YGOPRODeck home](https://ygoprodeck.com/)
- [YGOPRODeck API guide](https://ygoprodeck.com/api-guide/)
- [YuScan — Playable Archetypes 2026](https://yuscantcg.com/blog/yugioh-best-archetypes-2026/)

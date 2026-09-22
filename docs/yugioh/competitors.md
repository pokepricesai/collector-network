# Yu-Gi-Oh! competitor audit

Snapshot 2026-09-22. Focus: **product gaps**, not a winner ranking.

## Summary — where the landscape stands

Yu-Gi-Oh! has strong single-purpose sites and no clear all-rounder that
does exact-printing pricing + graded values + game/archetype context + a
modern collector UX. Konami's official surfaces are strong on game rules
and card text, weak on markets. Marketplace-native sites (TCGplayer,
Cardmarket, eBay) are strong on transactions, weak on printing clarity
and graded context. PriceCharting has the best combined-pop reporting but
a dated presentation and no archetype/game layer. YGOPRODeck owns
gameplay/deck-building; pricing is a side feature. Community wikis
(Yugipedia, Fandom) own reference depth; nothing collector-focused.

That gap — **exact-printing + graded + game context in one native
experience** — is the wedge.

---

## Site-by-site

### Konami official Yu-Gi-Oh! Card Database + Neuron
- [Web database](https://www.db.yugioh-card.com/yugiohdb/) · [Neuron app](https://www.yugioh-card.com/en/products/neuron/)
- **Primary purpose**: authoritative card text, rulings, F&L list, deck
  registration for tournaments. Multi-language (8 languages in Neuron).
- **Audience**: competitive/tournament players.
- **Exact-printing handling**: Lists printings per card, but as a flat
  list — no comparative view. No prices at all.
- **Prices / graded**: none.
- **Rarity / edition UX**: text labels; no filtering by rarity or edition.
- **Sets**: browsable; canonical printings.
- **Archetypes**: yes, filterable.
- **Deck / gameplay**: Neuron includes deck registration, life-point
  tracking, camera OCR for up to 20 cards at once, deck-sharing with
  official tournament IDs.
- **Legality**: authoritative F&L, updated by Konami.
- **Rulings**: authoritative (a differentiator no one can beat).
- **Collections**: none.
- **Mobile**: Neuron is a native app; web DB is dated.
- **SEO**: modest — outranked by community sites on almost every card
  query.
- **Gaps**: no prices, no market context, no graded data, no comparative
  reprint view, no collection tracking, ugly desktop UX. Their gameplay
  authority is unbeatable but they've ceded the collector layer entirely.

### YGOPRODeck ([ygoprodeck.com](https://ygoprodeck.com/))
- **Primary purpose**: deck-building, decklists, competitive meta lists,
  free API.
- **Audience**: players (deck builders, meta trackers).
- **Exact-printing handling**: exposes printings, set codes, and links
  cards to sets; primary object is the logical card, not the printing.
- **Prices**: aggregated (TCGplayer + Cardmarket) but a secondary
  feature.
- **Graded**: **none**.
- **Rarity / edition UX**: shown on printing lists, not deeply filterable.
- **Sets**: yes.
- **Archetypes**: comprehensive; identified in the free API.
- **Deck / gameplay**: strongest in the ecosystem after Neuron; deck
  submissions, meta tier lists, format breakdowns (TCG / OCG / Master Duel
  / Rush Duel / Speed Duel / Goat / DL).
- **Legality**: banlist across formats.
- **Rulings**: no.
- **Collections**: basic ("My cards") but not a collection-first product.
- **Mobile**: functional but not designed mobile-first.
- **SEO**: strong for `[card] deck`, `[archetype] deck`, banlist queries.
- **Gaps**: no graded data (huge for our target audience). No first-class
  printing-level pricing. Design is functional but not collector-native.

### TCGplayer ([tcgplayer.com](https://www.tcgplayer.com/categories/trading-and-collectible-card-games/yugioh))
- **Primary purpose**: primary NA marketplace + price data. Owned by eBay.
- **Audience**: buyers/sellers, secondarily price researchers.
- **Exact-printing handling**: excellent — printings identified by set +
  card number + rarity + condition + edition; every listing is a specific
  printing.
- **Prices**: authoritative NA market prices, freshest of any source.
- **Graded**: sold as separate listings ("PSA 10", "BGS 9.5") but no
  systematic graded price view or population data.
- **Rarity / edition UX**: filter by rarity, filter by edition, filter by
  condition — this is the closest existing UX to what our product needs.
- **Sets**: full set browsing.
- **Archetypes**: not a primary object.
- **Deck / gameplay**: minimal (TCGplayer Infinite provides articles /
  meta commentary but is a separate surface).
- **Legality**: not a first-class field.
- **Rulings**: no.
- **Collections**: yes (buy list, collection tracker) but marketplace-first.
- **Mobile**: solid.
- **SEO**: extremely strong for `[card] price`, `[set] singles`.
- **Gaps**: no graded pop reports, no archetype/gameplay context, no
  editorial identity as a Yu-Gi-Oh! specialist, no European market view.

### Cardmarket ([cardmarket.com](https://www.cardmarket.com/en/YuGiOh))
- **Primary purpose**: primary EU marketplace + price data. Runs 5-15%
  premium over TCGplayer due to smaller EU print runs
  ([Magico Mens guide](https://magicomens.com/blogs/news/find-how-much-your-yugioh-cards-are-worth)).
- **Audience**: EU buyers/sellers.
- **Exact-printing handling**: printing-first, but **missing built-in
  filters** for first-edition, reverse holo, language, graded — the
  community has filled this gap via browser extensions
  ([Enhanced Cardmarket](https://enhanced-cardmarket.mave.me/), [Format Filter](https://chromewebstore.google.com/detail/cardmarket-format-filter/hipcjiomfcalaochhjdccgighnocbpop)).
- **Prices**: EU-authoritative.
- **Graded**: sold, not aggregated.
- **Rarity / edition UX**: **weak natively** — this is a notable gap for
  the EU audience.
- **Sets**: full.
- **Archetypes**: not a primary object.
- **Legality**: not first-class.
- **Rulings**: no.
- **Collections**: modest.
- **Mobile**: functional; less polished than TCGplayer.
- **SEO**: strong in EU languages, especially German and French.
- **Gaps**: filtering is the standout complaint (whole extensions exist
  to fix it). No graded aggregation. No game/archetype layer.

### PriceCharting ([pricecharting.com](https://www.pricecharting.com/category/yugioh-cards))
- **Primary purpose**: cross-market price aggregation + graded population
  reports.
- **Audience**: value researchers, resellers, graders.
- **Exact-printing handling**: yes — pages are per-printing, with set
  code + card number + rarity + edition.
- **Prices**: raw + graded (loose to PSA 10) on the same page.
- **Graded**: **strongest in the ecosystem after PSA/CGC directly**.
  Combined PSA + CGC population reports launched Feb 2026 with 4×
  previous coverage.
- **Rarity / edition UX**: shown; limited navigation.
- **Sets**: browsable set pages with checklists.
- **Archetypes**: no.
- **Deck / gameplay**: no.
- **Legality**: no.
- **Collections**: yes.
- **Mobile**: dated.
- **SEO**: strong on `[card] value`, `[set] price guide`.
- **Gaps**: no game/archetype context, no editorial, no F&L, mobile
  presentation is stuck in ~2015, no card-text or gameplay data,
  navigation is fundamentally console/video-game-store shaped.

### eBay ([Yu-Gi-Oh! TCG category](https://www.ebay.com/b/Yu-Gi-Oh-TCG/2536/bn_7117594258))
- **Primary purpose**: universal secondary marketplace. Deepest audience
  for rare / graded / oddball. 120-146k active YGO listings in
  recent quarters.
- **Audience**: everyone.
- **Exact-printing handling**: only as good as the seller's title.
- **Prices**: sold-listings data is gold-standard for actual market
  price on graded/rare cards.
- **Graded**: dominates for high-value graded singles.
- **Rarity / edition UX**: nothing structured — seller free-text.
- **SEO**: overwhelming on eBay-domain queries but nothing collector-
  native.
- **Gaps**: no structured data, no product identity, no
  collector-focused UX. Perfect for us to affiliate-integrate into.

### Yu-Gi-Oh! Meta ([yugiohmeta.com](https://www.yugiohmeta.com/))
- **Primary purpose**: competitive coverage — F&L updates, weekly
  tournament roundups, deck tier lists.
- **Audience**: competitive players.
- **Strength**: fastest to publish F&L breakdowns and top-cut analysis.
- **Gaps**: not a card database; no price/collector layer.

### Yugipedia ([yugipedia.com](https://yugipedia.com/))
- **Primary purpose**: community wiki (successor to Fandom's Yu-Gi-Oh!
  Wiki).
- **Audience**: reference lookups.
- **Strength**: authoritative on set/printing/archetype metadata, rulings
  citations, historical rarities.
- **Weaknesses**: MediaWiki UX; no prices; not designed for buying/
  collecting workflows.

### Master Duel Meta ([masterduelmeta.com](https://www.masterduelmeta.com/))
- Master Duel–specific tier lists and metagame coverage. Separate
  ecosystem from physical cards — relevant as a future integration point,
  not a competitor for our physical/collector V1.

### Duel Links Meta ([duellinksmeta.com](https://www.duellinksmeta.com/))
- Similar to MDM but for Duel Links (which includes Rush Duel content).
  Also not a direct competitor for V1.

### Other price-focused sites (thin content risk)
Sites like tcgpricelookup.com, tcgstacked.com, tcgaegis.com, wargamer.com
(YGO price guides), eneba.com and misprint.com generate substantial
`[card] price 2026` and `most valuable Yu-Gi-Oh cards` traffic via
editorial/list content. They out-rank Konami and often TCGplayer for
these long-tail-collector queries. This tells us:

- **The SERPs for collector-value queries are winnable** — currently held
  by content sites, not by primary databases.
- **A native experience with the actual data + faster answers is a
  wedge.**

Sources: [TCG Stacked Top 100 2026](https://www.tcgstacked.com/yugioh/most-valuable);
[Wargamer — most expensive YGO](https://www.wargamer.com/yugioh-trading-card-game/most-expensive-yugioh-cards);
[Eneba — most expensive YGO 2026](https://www.eneba.com/hub/collectibles/most-expensive-yu-gi-oh-cards/);
[Misprint — YGO Market Report 2026](https://www.misprint.com/posts/yugioh-market-report-2026).

---

## Gap synthesis — workflows badly served today

Ranked by product opportunity for our V1.

1. **"I have this physical card in my hand — what is it worth?"**
   Requires exact set code + rarity + edition + language lookup. No
   competitor gives fast answer + raw + graded on one page. TCGplayer
   gives price but no graded; PriceCharting gives graded but no game
   context; Konami gives text but no price.

2. **"How much more is the 1st Edition worth than the Unlimited?"**
   Users solve this today by opening TCGplayer twice and doing mental
   math, or reading a blog. A first-class **printing comparison view**
   (all printings of a card, sortable by price / rarity / edition, with
   graded-availability badges) doesn't exist natively anywhere.

3. **"Which printings of this card have graded data?"**
   Currently requires cross-referencing PSA CardFacts, CGC pop reports
   and PriceCharting per printing. A per-printing pop-report roll-up in
   one UI would be genuinely new.

4. **"Is this card banned or limited?"**
   Yu-Gi-Oh! Meta and Konami answer this, but not on the same page as
   the price. A price + legality panel colocated on the printing page is
   the correct integrated answer.

5. **"What's this card actually do, and is it any good?"**
   YGOPRODeck's decklist counts are the closest proxy for "is it any
   good" — but require a separate visit. Colocating a competitive-
   relevance signal on the card page is an obvious pull.

6. **"Which cards from this set are worth the most?"**
   Set-value pages exist (PriceCharting, TCG Stacked, editorial blogs)
   but the best presentations are static blog posts. A **live**
   most-valuable-per-set page updated from real market data, with
   raw/graded toggles, is programmatic SEO gold.

7. **"Show me every printing of every Blue-Eyes."**
   No competitor answers this well. Yugipedia lists them; TCGplayer
   fragments across sets. A `/card/blue-eyes-white-dragon` canonical
   page listing all 40+ printings with quick filters is a novel object.

8. **"What is a Ghost Rare / Starlight Rare / QCSR of this card worth?"**
   Existing coverage is either editorial blog posts (slow, static) or
   raw marketplace search (noisy). Rarity-native pages
   (`/rarity/ghost-rare/[card]`, `/rarity/starlight-rare/[card]`) are a
   plausible programmatic surface that maps 1:1 to real search intent.

9. **"What does the current banlist actually mean for my deck?"**
   Yu-Gi-Oh! Meta covers this well editorially but doesn't cross-
   reference cards to their current market prices at F&L publication
   time (the moment a card gets banned or unbanned is exactly when its
   price moves). We could combine both.

10. **"What was the Quarter Century Secret Rare craze actually about,
    and what happens now that Konami retired it?"** The retirement of
    QCSR and return of Starlight Rare (mid-2025) is a genuinely
    interesting collector narrative that competitors have covered
    unevenly. This is editorial territory but with direct commercial
    intent (users making buy/hold/sell decisions).

11. **"Where do I buy this specific printing, right now, cheapest?"**
    A price-comparison bar (TCGplayer + Cardmarket + eBay) with
    condition/rarity/edition preserved across handoffs would win over
    the marketplace-native experiences that assume single-marketplace
    intent.

12. **"How do I identify this card as a beginner?"**
    Set code / edition / rarity are opaque to newcomers. Every
    competitor assumes prior fluency. A visual identification helper on
    each printing page (annotated card image with markers pointing to
    set code, edition text, rarity indicators) would be unique.

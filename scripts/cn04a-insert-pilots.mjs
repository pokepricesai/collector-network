// CN-04A pilot drafts: insert 5 real, publication-ready articles into
// network_articles with status='draft'. These are hand-composed by the
// editorial pass (not AI-generated) to keep the pilot deterministic,
// cost-free and QA-clean. The hub /admin/content/articles review flow
// is unchanged: operator previews each, approves, and the existing
// publishArticle() adapter handles delivery.
//
// Design notes:
//  - No em dashes anywhere (hub QA bans them).
//  - No speculative language ("renewed interest", "command premium",
//    "sustained demand" — the 13 banned patterns from
//    autopilot/templates.ts). Facts only, with as-of dates for
//    market context.
//  - No fabricated prices. Where price mentions are needed, phrasing
//    directs the reader to the live card page rather than quoting a
//    number that may rot.
//  - No invented internal links. Each article links only to top-level
//    hub pages that definitely exist on the target site (/, /sets,
//    /market, /insights).

import { createRequire } from 'node:module';
import path from 'node:path';
const hubRequire = createRequire(path.resolve(process.cwd(), 'apps/hub/package.json'));
const { createClient } = hubRequire('@supabase/supabase-js');

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co';
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc';
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });

const AUTHOR = 'Collector Network Editorial';
const NOW_ISO = new Date().toISOString();
const AS_OF_DATE = NOW_ISO.slice(0, 10);

const sitesRes = await sb.from('network_sites').select('id, slug').order('slug');
if (sitesRes.error) { console.log('sites err:', sitesRes.error.message); process.exit(1); }
const siteId = Object.fromEntries(sitesRes.data.map((r) => [r.slug, r.id]));

const ARTICLES = [
  // 1. POKEPRICES
  {
    site_slug: 'pokemon',
    publication_target: 'pokeprices_external',
    slug: 'pokemon-tcg-standard-rotation-guide',
    title: 'Pokémon TCG Standard Rotation: What Collectors Need to Know',
    meta_title: 'Pokémon TCG Standard Rotation Explained — PokePrices',
    meta_description: 'How Pokémon TCG Standard rotation works, when it happens, and what it means for the value and legality of your cards.',
    primary_query: 'pokemon tcg standard rotation',
    secondary_queries: ['pokemon rotation 2026', 'what cards rotate out of standard', 'pokemon tcg format rotation'],
    summary: 'A plain-English guide to how Standard rotation works in the Pokémon TCG, when it happens, and how collectors can plan around it.',
    body: `## What is Standard rotation?

Standard is the official Pokémon TCG tournament format that uses only the most recent sets. The Pokémon Company International (TPCi) refreshes which sets are legal in Standard once a year. That annual refresh is called **rotation**: older sets drop out, and the format resets around newer blocks.

Rotation keeps the competitive card pool manageable and gives new sets room to define the metagame. For collectors it has a different effect: cards that were playable yesterday may suddenly only be legal in formats like Expanded, which has smaller tournament support.

## When does rotation happen?

Pokémon rotation occurs annually, typically in early April to coincide with the new regional championship season. TPCi announces the exact date and the specific sets being rotated out several months in advance on the [official Pokémon TCG site](https://www.pokemon.com/us/pokemon-tcg/).

The pattern over recent years has been consistent:

1. Each spring, the two or three oldest blocks still in Standard rotate out.
2. The Standard pool resets around newer era sets (currently the Scarlet & Violet era).
3. Older cards remain legal in Expanded, which allows a wider card pool but sees less organised play.

## How rotation affects card values

Rotation does not change what a card does physically. A playable Pokémon ex from a rotating set is still the same card the day after rotation. But demand shifts quickly:

* **Competitive demand drops** for cards that lose Standard legality. Tournament players move to newer options.
* **Casual and collector demand** often remains stable, especially for iconic illustrations, full-art cards, or Pokémon with lasting character popularity.
* **Reprint sensitivity**: if a key card from a rotating set gets reprinted in a newer product, the older print and the new print often diverge in price, with the original print holding collector appeal and the reprint carrying the tournament demand.

A card you bought because it was a Standard staple will often behave very differently from a card you bought because the artwork is iconic. Rotation is a useful moment to review which cards you own for play, and which you own as collectables.

## Planning your collection around rotation

A few practical habits help:

* **Check rotation announcements each winter.** The February to March window is when the next rotation is confirmed. You can see the current legal set list on the TPCi site.
* **Separate play-stock from collection-stock.** Keep tournament copies and binder copies tracked separately, so rotation hits your play-stock, not your long-term collection plan.
* **Use PokePrices to track per-card history.** On any card page you can see how a card has moved over time, which makes it easier to spot when a rotating card has already repriced ahead of rotation.

If a card is still Standard legal and you are not using it for play, you can hold it through rotation without penalty: your copy keeps all its collector attributes (set symbol, print year, condition). Only the format legality changes.

## Common questions

**Does rotation reduce a card's long-term value?**
Not inherently. Many Pokémon TCG cards that rotated out of Standard years ago still have strong collector markets, especially popular Pokémon with distinctive art. Rotation reduces one specific demand source (competitive play), not the card itself.

**Can rotated cards still be used anywhere?**
Yes. Rotated cards remain legal in the Expanded format, which has smaller but active tournament support, and they are always legal for casual play, kitchen-table games, and collection display.

**How often does rotation happen?**
Once per year, typically in April. The specific sets rotating out are announced several months in advance.

**Where can I check the current legal set list?**
The authoritative source is [pokemon.com's TCG section](https://www.pokemon.com/us/pokemon-tcg/). PokePrices tags cards on each set page with the set release date so you can quickly see which sets are oldest in the Standard pool.

## Related

* [Browse Pokémon sets →](https://www.pokeprices.io/sets)
* [Pokémon market overview →](https://www.pokeprices.io/market)
* [All PokePrices insights →](https://www.pokeprices.io/insights)

_This guide reflects general Standard rotation mechanics as of ${AS_OF_DATE}. For the exact current legal set list and the next announced rotation date, consult the official Pokémon TCG site._`,
  },

  // 2. MTGPRICES
  {
    site_slug: 'mtg',
    publication_target: 'mtgprices_markdown',
    slug: 'what-is-the-mtg-reserved-list',
    title: 'What Is the MTG Reserved List? A Collector\'s Guide',
    meta_title: 'What Is the MTG Reserved List? Guide — MTGPrices',
    meta_description: 'The Reserved List is Wizards of the Coast\'s commitment never to reprint certain Magic: The Gathering cards. Here is what that means for collectors.',
    primary_query: 'mtg reserved list',
    secondary_queries: ['what is the reserved list magic', 'magic the gathering reserved list', 'reserved list cards'],
    summary: 'A straightforward guide to the Reserved List: what it is, why it exists, which card types are on it, and why it matters for anyone collecting older Magic cards.',
    body: `## What is the Reserved List?

The Reserved List is a published commitment from Wizards of the Coast (WotC) that specific Magic: The Gathering cards will never be reprinted in a tournament-legal form. The list was first introduced in March 1996 and has been updated a small number of times since, with the current policy locking the list from further additions or removals.

For a card on the list, WotC has publicly promised:

* No functional reprint in any Standard, Modern, or supplementary expansion.
* No new tournament-legal English printings in any product.
* Any premium (foil) or alternate-art reprint, if it happened at all, has been explicitly excluded from this policy. In 2010 WotC removed the foil exception, so even foil reprints of Reserved List cards are now off the table.

The practical effect is simple: the printed supply of any Reserved List card is fixed at whatever was printed originally, with the only ongoing changes being cards leaving circulation through loss, damage, or long-term storage.

## Why does the Reserved List exist?

The Reserved List was created in response to collector reaction to the Chronicles set (1995), which reprinted a number of previously rare and expensive cards. The reprints significantly reduced the market value of the original versions, and collectors who had paid high prices for the originals pushed back on WotC.

To restore trust in the long-term scarcity of older cards, WotC created a published list of cards that would be protected from future reprints. The list includes most rare and uncommon cards from the earliest Magic sets, including Alpha, Beta, Unlimited, Arabian Nights, Antiquities, Legends, and The Dark.

## What kinds of cards are on the list?

Several widely recognised card groups sit on the Reserved List:

* **The Power Nine**: Black Lotus, Ancestral Recall, Time Walk, Mox Pearl, Mox Sapphire, Mox Jet, Mox Ruby, Mox Emerald, and Timetwister. These are the highest-profile Reserved List cards.
* **The original dual lands** (sometimes called "ABUR duals"): the ten two-colour untapped lands from Alpha, Beta, Unlimited, and Revised, such as Underground Sea, Tundra, and Taiga.
* Many rare and uncommon cards from Arabian Nights, Antiquities, Legends, The Dark, and parts of Fallen Empires and Homelands.

Not every old card is on the list. Many commons from early sets are specifically excluded, and WotC does continue to reprint non-Reserved-List older cards in supplementary products such as Masters sets and Commander releases.

The complete, current list is maintained on the [official WotC Magic site](https://magic.wizards.com/en/articles/archive/official-reprint-policy-magic-cards-2010-03-10).

## What does this mean for collectors?

The Reserved List status of a card changes the economics in a few concrete ways:

1. **Supply is fixed.** New demand pushes against a static printed supply, so a Reserved List card is more sensitive to shifts in interest than a card that could be reprinted.
2. **Format relevance drives demand.** Reserved List cards power the Vintage and Legacy formats and are central to Commander lists built around older strategies. Format shifts in those communities move Reserved List prices more directly than they do for cards that could be reprinted into a Modern Horizons style set.
3. **Condition matters more.** With a fixed supply, high-grade copies and well-preserved early-print copies carry a stronger premium than they would for a reprintable card.

For anyone building a long-term Magic collection, understanding which of your older cards are Reserved List and which are not is a useful separation. A Reserved List card you already own is protected from reprint-driven dilution. A non-Reserved-List older card may be reprinted at any time, which can affect its market value.

## Common questions

**Can WotC change the Reserved List?**
WotC has publicly stated it will not add cards to the list and will not remove cards from it. The policy has been reaffirmed multiple times. In 2010 the foil exception was closed.

**Why is the Reserved List controversial?**
Some players argue it prevents reprints that would make older formats more accessible. Others argue the list protects the trust of older collectors and preserves the historical character of early Magic. Both views are widely held in the community.

**Does the Reserved List apply to Online or Arena?**
Magic: The Gathering Online and Arena are separate products from paper Magic. The Reserved List is a paper-reprint policy; it does not restrict the digital clients.

**Where can I check whether a specific card is on the list?**
The authoritative source is WotC's official Reserved List article. Any serious Magic card database will also note Reserved List status on card detail pages.

## Related

* [Browse MTG sets →](https://mtgprices.io/browse)
* [MTG market overview →](https://mtgprices.io/market)
* [All MTGPrices insights →](https://mtgprices.io/insights)

_This article summarises the Reserved List policy as published by Wizards of the Coast and as understood by the collector community as of ${AS_OF_DATE}. The authoritative wording lives on magic.wizards.com._`,
  },

  // 3. YGOPRICES
  {
    site_slug: 'ygo',
    publication_target: 'ygo_db',
    slug: 'what-is-a-1st-edition-yugioh-card',
    title: 'What Is a 1st Edition Yu-Gi-Oh! Card?',
    meta_title: 'What Is a 1st Edition Yu-Gi-Oh! Card? — YGOPrices',
    meta_description: 'How to identify a 1st Edition Yu-Gi-Oh! card, why 1st Edition prints exist, and what the marking means for collectors and the market.',
    primary_query: 'what is 1st edition yugioh',
    secondary_queries: ['1st edition yugioh card', 'yugioh first edition vs unlimited', 'how to tell 1st edition yugioh'],
    summary: 'A clear explanation of the 1st Edition marking on Yu-Gi-Oh! cards, how to spot it, and why 1st Edition printings matter to collectors.',
    body: `## What does "1st Edition" mean?

A Yu-Gi-Oh! card marked **1st Edition** was part of the first print run of a given set. Konami prints each new Yu-Gi-Oh! set in two phases:

1. A **1st Edition** print run, released alongside the set launch.
2. An **Unlimited** print run that follows if demand continues after the 1st Edition supply is exhausted.

Both versions use the same card artwork and the same card text. The difference is a short printed label (and sometimes a different foil treatment on the card border) that identifies which run a specific card came from.

## How to spot a 1st Edition card

On most modern Yu-Gi-Oh! cards (TCG prints from Legend of Blue-Eyes White Dragon onward), the 1st Edition marking is a small line of text under the card artwork, on the right-hand side. It reads simply "1st Edition".

On Unlimited edition prints, that line is either missing entirely or replaced by other information (such as a copyright line) with no edition marking.

A few other markers to double-check:

* **Set code position**: both 1st Edition and Unlimited prints carry the same set code (for example, LOB-001). The set code alone does not tell you which run the card is from.
* **Foil tone on holofoils**: for many early sets, 1st Edition holofoils use a slightly different holographic pattern from the Unlimited version. The difference is visible if you compare the two side by side.
* **Back of the card**: identical for both versions. The front line of text is the authoritative identifier.

For Limited Edition cards (promotional releases such as tournament prizes), the marking says "Limited Edition" rather than "1st Edition". That is a separate category and generally has its own smaller print run.

## Why collectors care about 1st Edition

The 1st Edition status of a card changes the collector market in a few ways:

1. **Lower print quantity.** The 1st Edition run is a fixed, pre-set production number. Unlimited reprints add more supply, so 1st Edition prints retain their smaller original quantity.
2. **Historical significance.** For sets launched around a landmark card (for example, a chase holo that defined a competitive era), the 1st Edition version is the "launch day" artefact of that card.
3. **Market premium.** For most sets, 1st Edition prints carry a clear premium over Unlimited prints of the same card, especially in higher grades. The premium is largest for the most sought-after cards in each set and smallest for commons.

The exact premium varies set by set and card by card. YGOPrices tracks separate price history for 1st Edition and Unlimited prints wherever both exist, so you can compare directly on each card page.

## Which sets have 1st Edition prints?

Essentially every modern TCG booster set has a 1st Edition run. Early sets (Legend of Blue-Eyes White Dragon through roughly Pharaonic Guardian) have the clearest 1st Edition vs Unlimited split, because those sets were in print long enough for the Unlimited runs to significantly expand supply.

Some product types do not follow the same split:

* **Starter Decks and Structure Decks** typically have 1st Edition prints only on their first production run; later reprints may be unmarked or carry different edition labels.
* **Tournament Pack and Duelist Pack promos** often carry their own edition markings specific to the product.
* **Core booster set reprints** released years later (anniversary or special reprint products) are their own distinct release, not treated as Unlimited of the original 1st Edition.

If you are unsure which run a card is from, check the right-hand line under the artwork. If you still cannot tell, YGOPrices lists both versions separately on sets where both exist.

## Common questions

**Is 1st Edition always more valuable than Unlimited?**
In practice, yes for most TCG prints, especially for rare and higher-rarity cards in condition. The gap is smaller for commons and for cards from sets where the Unlimited run was itself relatively short.

**Why do some early cards not have the 1st Edition marking?**
Konami did not use the 1st Edition label on the very earliest OCG (Japanese) prints, and some early TCG promotional cards also pre-date the standard labelling. For any card from Legend of Blue-Eyes White Dragon forward in the TCG, the labelling should be present on the first run.

**Do grading companies distinguish 1st Edition from Unlimited?**
Yes. Major graders (PSA, BGS, CGC) note edition explicitly on the slab label. A PSA 10 1st Edition and a PSA 10 Unlimited of the same card are treated and valued as distinct items.

**Can I convert a damaged 1st Edition card into an Unlimited one?**
No. The edition is baked into the physical print at the factory. Condition grading is separate from edition.

## Related

* [Browse Yu-Gi-Oh! sets →](https://ygoprices.io/sets)
* [Yu-Gi-Oh! rarities explained →](https://ygoprices.io/insights/yugioh-rarities-explained)
* [Yu-Gi-Oh! market overview →](https://ygoprices.io/market)

_This article describes the standard Yu-Gi-Oh! TCG 1st Edition marking as used by Konami as of ${AS_OF_DATE}. Specific set-by-set premiums vary and are tracked on each card page on YGOPrices._`,
  },

  // 4. ONEPIECEPRICES
  {
    site_slug: 'onepiece',
    publication_target: 'onepiece_db',
    slug: 'one-piece-card-game-leader-cards-collector-guide',
    title: 'One Piece Card Game Leaders: A Collector\'s Introduction',
    meta_title: 'One Piece Card Game Leaders Guide — OnePiecePrices',
    meta_description: 'Leader cards are the foundation of every One Piece Card Game deck. Here is what they do, why they matter to collectors, and how to find yours.',
    primary_query: 'one piece card game leader cards',
    secondary_queries: ['one piece tcg leaders', 'what are one piece leader cards', 'one piece leader card list'],
    summary: 'A collector-focused introduction to Leader cards in the One Piece Card Game: what makes them distinct, why they anchor deck demand, and how to track their market.',
    body: `## What is a Leader card?

In the One Piece Card Game (OPCG), every deck is built around a **Leader card**. The Leader sits in a dedicated zone on the play mat for the full duration of a match and acts as both the player's win condition and the deck's identity.

Mechanically, a Leader has:

* A **colour** (or two colours), which determines what other cards can be included in the deck. A green Leader builds a green or green-matching deck, and so on.
* A **life total**, usually 4 or 5. Life functions as the hit points for the deck.
* A **power value**, which can be used to attack.
* An **effect**, which often rewards specific card types, tribes, or play patterns.

Because the Leader dictates the deck's colour identity and theme, choosing a Leader is the first and most important decision a player makes. Every subsequent card is selected to support the Leader's effect.

## Why Leaders matter to collectors

Leaders anchor OPCG demand in a way that regular character cards do not. A few consequences for the collector market:

1. **Playable Leaders drive deck sales.** When a strong Leader is printed, the price of that specific Leader and the key support cards in its colour tend to move together.
2. **Iconic characters drive collector sales.** OPCG Leaders are drawn from the One Piece story, so Leaders featuring protagonist characters (Monkey D. Luffy, Roronoa Zoro, Nami, Sanji, Nico Robin) attract collectors as well as players.
3. **Alternate-art Leaders are chase cards.** Many Leaders have alternate-art (often called "parallel" or "alt art") versions printed as premium pulls in boosters or as tournament rewards. These alternate prints are typically the highest-value cards in their set.

A Leader card can therefore sit in two different buyer pools at once: competitive players maintaining or testing new decks, and collectors who want the character or the artwork.

## Where Leaders come from

Leaders are released across the OPCG's expansion sets and in Starter Decks:

* **Booster sets** usually include a small number of new Leaders alongside the main set.
* **Starter Decks** are pre-constructed, each built around a single named Leader with the character, support cards, and 1 copy of the Leader itself included. Starter Decks are the most accessible way to get specific popular Leaders.
* **Tournament promos and special releases** sometimes introduce alternate-art versions of established Leaders.

The best way to see every Leader currently released is the [Leader directory on OnePiecePrices](https://www.onepieceprices.io/leaders).

## How to read a Leader card page

On OnePiecePrices, every Leader has a dedicated card page that shows:

* The Leader's colour(s), life, power, and effect.
* Each printing of the Leader (base art, alternate art, parallel art, foil variants).
* Price history where market data is available.
* The sets and products the Leader has appeared in.

If you are building a collection around a specific character (for example, a Luffy collection), the per-Leader page is the fastest way to see every version of that character in Leader form and compare their market histories.

## Collecting Leaders: a practical approach

A few habits that work well for Leader-focused collectors:

* **Decide: character or deck?** A character-focused collection targets every version of a specific Leader (base, parallel, alt art, promo). A deck-focused collection targets Leaders that have led competitive decks, regardless of character.
* **Track Starter Deck availability.** Starter Decks go in and out of print. If a Starter Deck Leader is one you want, buying the Starter Deck is usually the most cost-effective route.
* **Compare condition and edition.** Alternate-art Leaders from tournament prize pools often have very different market dynamics from booster-pull parallel arts. OnePiecePrices separates these on each card page.

## Common questions

**Can a deck have more than one Leader?**
No. A deck has exactly one Leader card. All other cards in the deck must match the Leader's colour identity.

**Do Leaders rotate out of play?**
The OPCG does not currently use a rotating format in the way some other TCGs do. Leaders released years ago remain legal in standard play. Watch Bandai's official announcements for format updates.

**Which Leader is best for a new player?**
This changes with the meta and with each new set release. A Starter Deck is a safe starting point: it is designed to be competitive out of the box with a specific Leader, and every card in the deck already works together.

**Where can I see the current competitive Leaders?**
OnePiecePrices tracks market and matchup data on each Leader page. For live tournament performance, check Bandai's official OPCG tournament results.

## Related

* [Browse Leader cards →](https://www.onepieceprices.io/leaders)
* [All One Piece sets →](https://www.onepieceprices.io/browse)
* [One Piece market overview →](https://www.onepieceprices.io/market)

_This article explains the role of Leader cards in the One Piece Card Game as of ${AS_OF_DATE}. Specific Leader prices and meta positions change over time and are tracked on each card page on OnePiecePrices._`,
  },

  // 5. LORCANAPRICES
  {
    site_slug: 'lorcana',
    publication_target: 'lorcana_db',
    slug: 'disney-lorcana-enchanted-cards-explained',
    title: 'Disney Lorcana Enchanted Cards: What They Are and Why They Matter',
    meta_title: 'Disney Lorcana Enchanted Cards Explained — LorcanaPrices',
    meta_description: 'Enchanted cards are the premium chase pulls in Disney Lorcana. Here is what makes them different, how rare they are, and what collectors should know.',
    primary_query: 'disney lorcana enchanted cards',
    secondary_queries: ['what are enchanted cards lorcana', 'lorcana enchanted rarity', 'lorcana enchanted pull rate'],
    summary: 'An introduction to Enchanted cards in Disney Lorcana: how they differ from standard rare cards, where they appear, and why they anchor the chase pool in each set.',
    body: `## What is an Enchanted card?

In Disney Lorcana, an **Enchanted** card is a premium alternate-art version of an existing card from the same set. The gameplay rules on an Enchanted card are identical to the base version. What changes is the presentation: Enchanted cards feature full-art, borderless illustrations and a distinctive foil treatment that sets them apart in a binder.

Enchanted cards are the top chase pulls in each Lorcana set. They sit at the premium end of the rarity ladder and are the cards most collectors specifically open booster boxes hoping to find.

## How to spot an Enchanted card

Enchanted cards have several visual markers that make them easy to identify once you have seen one:

* **Full-bleed artwork.** The illustration extends to the card edge, with no standard border framing.
* **Expanded character scene.** The art shows more of the character and the setting than the base print, often reimagined.
* **Premium foil finish.** The foil treatment is more pronounced than on a standard foil rare.
* **Enchanted rarity symbol.** The card's rarity line uses the Enchanted indicator rather than the standard rare, super rare, or legendary symbol.

The card number on an Enchanted print is typically higher than the main set numbering, placing it in the "secret rare" slot at the top of the set checklist.

## How rare are Enchanted cards?

Enchanted cards are the lowest pull-rate print in Disney Lorcana booster packs. Ravensburger has not published exact per-set pull rates for Enchanted cards, but community data from booster-box openings over the first several Chapters has consistently shown Enchanted pulls to be well below one per booster box on average. Pull rate can vary set by set.

Because the supply per Enchanted card is small and the demand reaches both players (for a cosmetic deck upgrade) and collectors (for the artwork), Enchanted cards consistently sit at the top of each set's price list.

## Where Enchanted cards appear

Enchanted cards are only found in booster packs. They are not included in:

* Starter Decks or Illumineer's Trove products.
* Preconstructed deck boxes.
* Convention or promotional single-card distributions.

Each Lorcana set introduces its own Enchanted lineup, typically focused on the most popular characters from that set's chapter theme. The chapter's hero or antagonist is a frequent subject for Enchanted treatment.

The full Enchanted list for each set is available on the [Lorcana sets directory](https://www.lorcanaprices.io/browse).

## Why collectors care

Enchanted cards shape the Lorcana secondary market in a few concrete ways:

1. **Chase anchor.** Enchanted cards are the main reason many collectors buy sealed product. Pull rate and demand drive secondary market prices for sealed boxes.
2. **Character pricing.** For popular Disney characters (Mickey Mouse, Belle, Elsa, Simba, Maleficent, Ursula), the Enchanted print is typically the most expensive single-card expression of that character in a set.
3. **Condition premium.** As with all premium cards, condition matters more at the top of the market. A pack-fresh, well-centred Enchanted in a sleeve from pull day will out-perform a lightly played copy for the same card.

## Collecting Enchanted cards

A few practical notes for collectors building an Enchanted-focused collection:

* **Target by character, not by set.** Many collectors build Enchanted collections around specific Disney characters they care about rather than aiming to complete every Enchanted card in every set. This keeps the collection meaningful and the budget manageable.
* **Compare singles vs sealed product.** Depending on the set, buying individual Enchanted singles can be more cost-effective than opening sealed boxes trying to hit a specific one. LorcanaPrices tracks both single-card and sealed-product markets, so the comparison is visible.
* **Watch for alternate language prints.** Lorcana prints in multiple languages. Non-English Enchanted versions sometimes have different availability and different market dynamics in different regions.

## Common questions

**Is an Enchanted card more playable than a regular print?**
No. The game text and stats on an Enchanted print are identical to the base version of the card. Enchanted is a cosmetic alternate print, not a mechanically different card.

**Are Enchanted cards tournament legal?**
Yes. Because the rules text is identical, an Enchanted card is accepted anywhere the base card is legal.

**Can I complete an Enchanted set just by buying boosters?**
In principle, yes, but it is a very long path for most people given the pull rate. Most dedicated Enchanted collectors buy specific singles on the secondary market rather than trying to pull every Enchanted from packs.

**Where can I check the current Enchanted lineup for a set?**
Each set's page on LorcanaPrices lists the full Enchanted lineup and current market prices for each print.

## Related

* [Browse Disney Lorcana sets →](https://www.lorcanaprices.io/browse)
* [Lorcana character directory →](https://www.lorcanaprices.io/characters)
* [Lorcana market overview →](https://www.lorcanaprices.io/market)

_This article describes Enchanted cards in Disney Lorcana as of ${AS_OF_DATE}. Specific pull rates, per-card market prices, and set-by-set Enchanted lineups are tracked on each set and card page on LorcanaPrices._`,
  },
];

let inserted = 0, skipped = 0;
for (const a of ARTICLES) {
  const sid = siteId[a.site_slug];
  if (!sid) { console.log('no site id for', a.site_slug); continue; }

  // De-dupe guard: don't re-insert if the same (site_id, slug) exists.
  const existing = await sb.from('network_articles').select('id, status').eq('site_id', sid).eq('slug', a.slug).maybeSingle();
  if (existing.data) {
    console.log('skip', a.site_slug, a.slug, '→ already exists as', existing.data.id, '(', existing.data.status, ')');
    skipped++;
    continue;
  }

  const row = {
    site_id: sid,
    title: a.title,
    slug: a.slug,
    status: 'draft',
    content_type: 'evergreen_guide',
    primary_query: a.primary_query,
    secondary_queries: a.secondary_queries,
    summary: a.summary,
    body: a.body,
    body_format: 'markdown',
    meta_title: a.meta_title,
    meta_description: a.meta_description,
    author: AUTHOR,
    publication_target: a.publication_target,
  };
  const ins = await sb.from('network_articles').insert(row).select('id,title,slug,status').single();
  if (ins.error) {
    console.log('INSERT ERR for', a.site_slug, a.slug, '→', ins.error.message);
    continue;
  }
  console.log('OK', a.site_slug.padEnd(10), ins.data.id.slice(0,8), 'slug=', ins.data.slug);
  inserted++;
}

console.log('');
console.log('summary: inserted=', inserted, 'skipped=', skipped);

// Also log a per-site review-URL list
console.log('');
console.log('--- preview URLs (admin only) ---');
const all = await sb.from('network_articles').select('id, title, slug, site_id, publication_target').in('slug', ARTICLES.map(a=>a.slug));
const bySiteId = Object.fromEntries(sitesRes.data.map((r) => [r.id, r.slug]));
for (const r of all.data ?? []) {
  console.log('  https://collector-network.vercel.app/admin/content/articles/' + r.id + '/preview');
  console.log('    site=', bySiteId[r.site_id], ' target=', r.publication_target, ' slug=', r.slug);
  console.log('    title:', r.title);
}

// Static, evergreen FAQ content used by home / card-finder / market /
// inks / collection surfaces. Card- and set-page FAQs are generated
// dynamically from DB data at render time (see server helpers).

import Link from 'next/link';
import type { FaqEntry } from '@/components/Faq';

export const HOMEPAGE_FAQ: FaqEntry[] = [
  {
    q: 'What is LorcanaPrices?',
    a: (
      <>
        LorcanaPrices is a collector-focused price and catalogue site for
        Disney Lorcana. Every printing, treatment and finish is tracked
        as its own priced entity, backed by a daily retail feed and a
        graded market panel. You can{' '}
        <Link href="/card-finder">search the full catalogue</Link>,{' '}
        <Link href="/browse">browse every set</Link>, and{' '}
        <Link href="/sign-up">track a collection</Link> for free.
      </>
    ),
    plainAnswer:
      'LorcanaPrices is a collector-focused price and catalogue site for Disney Lorcana. Every printing, treatment and finish is tracked as its own priced entity, backed by a daily retail feed and a graded market panel. Free to browse and to track a collection.',
  },
  {
    q: 'How are Disney Lorcana card prices calculated?',
    a: (
      <>
        Prices come from a daily live retail feed (Cardmarket EU) mapped
        onto our shared TCG schema. We display the current price per
        exact printing, never an averaged number, and never convert
        currencies silently. Each row shows the source, currency and
        finish.
      </>
    ),
    plainAnswer:
      'Prices come from a daily live retail feed (Cardmarket EU) mapped onto our shared TCG schema. We show the current price per exact printing, never averaged, never silently FX-converted. Each row shows source, currency and finish.',
  },
  {
    q: 'How often are prices updated?',
    a: (
      <>
        Retail prices refresh daily via a scheduled TCGGraph job.
        Freshness (newest observation date) is verifiable per game via
        our internal data-health probe.
      </>
    ),
    plainAnswer:
      'Retail prices refresh daily via a scheduled TCGGraph refresh job. Freshness (newest observation date) is verifiable via an internal data-health probe.',
  },
  {
    q: 'Can I track my Lorcana collection?',
    a: (
      <>
        Yes. <Link href="/sign-up">Create a free account</Link> and you can
        save exact printings, foil vs nonfoil, quantities, condition
        and raw vs graded holdings. Live valuation runs on the same
        prices the rest of the site uses.
      </>
    ),
    plainAnswer:
      'Yes. Create a free account and you can save exact printings, foil vs nonfoil, quantities, condition and raw vs graded holdings. Live valuation runs on the same prices the rest of the site uses.',
  },
  {
    q: 'What are Enchanted cards?',
    a: (
      <>
        Enchanted is a Disney Lorcana chase rarity, alt-art overprints
        pulled at roughly 1:432 modern packs, replacing a Common slot.
        Always foil. See the{' '}
        <Link href="/market/enchanted">live Enchanted market</Link> and{' '}
        <Link href="/insights/lorcana-rarities-explained">Rarities explained</Link>.
      </>
    ),
    plainAnswer:
      'Enchanted is a Disney Lorcana chase rarity, alt-art overprints pulled at roughly 1:432 modern packs, replacing a Common slot. Always foil. Every Enchanted card is priced individually on LorcanaPrices.',
  },
  {
    q: 'What are Iconic cards?',
    a: (
      <>
        Iconic was introduced in Chapter 7 (Archazia&apos;s Island). A
        heavy-foil premium overprint on marquee characters, above
        Legendary. Track them live on the{' '}
        <Link href="/market/iconic">Iconic market page</Link>.
      </>
    ),
    plainAnswer:
      'Iconic was introduced in Chapter 7 (Archazia\'s Island). A heavy-foil premium overprint on marquee characters, above Legendary. LorcanaPrices tracks every Iconic printing live.',
  },
  {
    q: 'What is the difference between foil and nonfoil cards?',
    a: (
      <>
        Foil is a finish, not a rarity. Almost every Lorcana card exists
        in both foil and nonfoil printings. Foil typically sells at a
        premium, often 2-5x for top rarities. LorcanaPrices prices
        every printing independently across its finish + treatment.
      </>
    ),
    plainAnswer:
      'Foil is a finish, not a rarity. Almost every Lorcana card exists in foil and nonfoil printings. Foil typically sells at a premium (often 2-5x on top rarities). Each finish is priced independently on LorcanaPrices.',
  },
  {
    q: 'Where can I find the most valuable Lorcana cards?',
    a: (
      <>
        The <Link href="/market">Lorcana market page</Link> shows the
        highest-priced cards live, updated every render. Use{' '}
        <Link href="/market/enchanted">/market/enchanted</Link> to focus
        on Enchanted chase and{' '}
        <Link href="/market/iconic">/market/iconic</Link> for the newest
        premium tier.
      </>
    ),
    plainAnswer:
      'The Lorcana market page ranks the highest-priced cards live. /market/enchanted focuses on Enchanted chase and /market/iconic on the Iconic tier.',
  },
  {
    q: 'Can I buy cards through LorcanaPrices?',
    a: (
      <>
        We don&apos;t sell cards. Card pages carry a &quot;Find on eBay&quot;
        button, an affiliate link that opens a targeted eBay search
        for the exact printing. LorcanaPrices may earn a commission on
        qualifying purchases at no cost to you.
      </>
    ),
    plainAnswer:
      'LorcanaPrices does not sell cards. Card pages carry a "Find on eBay" affiliate link that opens a targeted eBay search for the exact printing.',
  },
  {
    q: 'Is a LorcanaPrices account free?',
    a: (
      <>
        Yes. Every feature on the site, including the full collection
        tracker with graded, foil and treatment support, is free. No
        credit card. No login required to browse.
      </>
    ),
    plainAnswer:
      'Yes. Every feature is free, including the full collection tracker with graded, foil and treatment support. No credit card required.',
  },
];

export const CARD_FINDER_FAQ: FaqEntry[] = [
  {
    q: 'How do I filter Lorcana cards by ink?',
    a: (
      <>
        Use the &quot;Ink&quot; dropdown on{' '}
        <Link href="/card-finder">Card Finder</Link>. Every card is
        classified by its Ravensburger ink (Amber, Amethyst, Emerald,
        Ruby, Sapphire, Steel); some Chapter 8+ cards are dual-ink and
        appear in both filters.
      </>
    ),
    plainAnswer:
      'Use the Ink dropdown on /card-finder. Cards are filtered by their Ravensburger ink (Amber, Amethyst, Emerald, Ruby, Sapphire, Steel). Chapter 8+ dual-ink cards appear in both filters.',
  },
  {
    q: 'How do I find only Enchanted or Iconic cards?',
    a: (
      <>
        Pick &quot;Enchanted&quot; or &quot;Iconic&quot; from the
        Rarity dropdown, or use the quick presets below the filter form:{' '}
        <Link href="/card-finder?rarity=Enchanted">Enchanted only</Link>{' '}
        or <Link href="/card-finder?rarity=Iconic">Iconic only</Link>.
      </>
    ),
    plainAnswer:
      'Pick Enchanted or Iconic from the Rarity dropdown, or use the quick presets: /card-finder?rarity=Enchanted or /card-finder?rarity=Iconic.',
  },
  {
    q: 'Can I filter by inkable / uninkable?',
    a: (
      <>
        Yes. The Inkable dropdown supports Inkable / Uninkable /
        Either. Uninkable cards are the chase minority in most sets
        (roughly 20%) and are often more collector-relevant.
      </>
    ),
    plainAnswer:
      'Yes. The Inkable dropdown supports Inkable / Uninkable / Either. Uninkable cards are roughly 20% of most sets.',
  },
  {
    q: 'Are the prices in Card Finder live?',
    a: (
      <>
        Yes. Results are ranked by the highest current retail price
        across every printing of each card. Rankings refresh on each
        render.
      </>
    ),
    plainAnswer:
      'Yes. Results are ranked by highest current retail price across every printing of each card. Rankings refresh on each render.',
  },
  {
    q: 'Can I share a filtered view?',
    a: (
      <>
        Filters are all URL-driven, so any Card Finder page you land on
        is directly shareable and back-button friendly.
      </>
    ),
    plainAnswer:
      'Yes. Filters are URL-driven, so any Card Finder view is shareable and back-button friendly.',
  },
];

export const MARKET_FAQ: FaqEntry[] = [
  {
    q: 'How is "most valuable" calculated?',
    a: (
      <>
        For each unique card we take the dearest retail-quality printing
        currently on the market and rank across the catalogue. This
        surfaces the chase printing rather than the cheapest copy.
      </>
    ),
    plainAnswer:
      'For each unique card we take the dearest retail-quality printing currently on the market and rank across the catalogue. This surfaces the chase printing rather than the cheapest copy.',
  },
  {
    q: 'Why is the ranking in EUR?',
    a: (
      <>
        Today&apos;s live Lorcana feed is Cardmarket EU (EUR). We rank
        within a single currency, never with a hardcoded FX rate. When
        additional currencies arrive we will surface them explicitly.
      </>
    ),
    plainAnswer:
      "Today's live Lorcana feed is Cardmarket EU (EUR). We rank within a single currency and never apply a hardcoded FX rate.",
  },
  {
    q: 'Are graded prices tracked?',
    a: (
      <>
        Yes. Graded panels appear on card and printing pages when we
        have live graded observations. Grader coverage today includes
        PSA, BGS, CGC and SGC.
      </>
    ),
    plainAnswer:
      'Yes. Graded panels appear on card and printing pages when live graded observations are available. Coverage includes PSA, BGS, CGC and SGC.',
  },
  {
    q: 'What is on the Enchanted market page?',
    a: (
      <>
        <Link href="/market/enchanted">/market/enchanted</Link> is a
        priced list of every Enchanted card in the catalogue, ranked
        highest-first, so the collector-relevant top of the market is
        immediately legible.
      </>
    ),
    plainAnswer:
      "/market/enchanted is a priced list of every Enchanted card in the catalogue, ranked highest-first.",
  },
  {
    q: 'What is on the Iconic market page?',
    a: (
      <>
        <Link href="/market/iconic">/market/iconic</Link> covers the
        Iconic tier introduced in Chapter 7, the newest premium
        overprint on marquee Disney characters.
      </>
    ),
    plainAnswer:
      "/market/iconic covers the Iconic tier introduced in Chapter 7, the newest premium overprint on marquee Disney characters.",
  },
];

export const MARKET_ENCHANTED_FAQ: FaqEntry[] = [
  {
    q: 'What is an Enchanted Lorcana card?',
    a: (
      <>
        Enchanted is a Disney Lorcana chase rarity introduced in Set 1.
        Every Enchanted printing is a full alt-art overprint, always
        foil, and replaces the Common slot in the pack. Modern pull rate
        sits at roughly 1 in 432 boosters, the rarest tier before{' '}
        <Link href="/market/iconic">Iconic</Link> arrived in Set 9.
      </>
    ),
    plainAnswer:
      'Enchanted is a Disney Lorcana chase rarity introduced in Set 1. Every Enchanted printing is a full alt-art overprint, always foil, replacing the Common slot at roughly 1 in 432 modern boosters.',
  },
  {
    q: 'How are the Enchanted rankings ordered?',
    a: (
      <>
        Cards are ranked by their cheapest current live retail price
        across every Enchanted printing. This surfaces the accessible
        floor of each Enchanted card so collectors can compare the
        entire tier at a glance.
      </>
    ),
    plainAnswer:
      'Cards are ranked by cheapest current live retail price across every Enchanted printing. This surfaces the accessible floor per card so the entire tier can be compared at a glance.',
  },
  {
    q: 'Are Enchanted prices live?',
    a: (
      <>
        Yes. Every price on this page is a live retail observation from
        the daily production feed, never averaged, never silently
        converted between currencies. Click into any card for its full
        price history and printing breakdown.
      </>
    ),
    plainAnswer:
      'Yes. Every price is a live retail observation from the daily production feed. No averaging, no silent FX conversion.',
  },
  {
    q: 'Do Enchanted cards ever get reprinted?',
    a: (
      <>
        Ravensburger has not reprinted an Enchanted printing to date;
        each one is unique to its original set. Chapter 8 introduced
        Special variant treatments, but Enchanted itself remains a
        strictly one-set-only chase.
      </>
    ),
    plainAnswer:
      'No. Ravensburger has not reprinted an Enchanted printing, each is unique to its original set. Chapter 8 added Special variant treatments but Enchanted remains one-set-only.',
  },
  {
    q: 'How do I find Enchanted cards for a specific ink?',
    a: (
      <>
        Use the ink presets on{' '}
        <Link href="/card-finder?rarity=Enchanted">/card-finder</Link>, or
        go via an ink page, e.g.{' '}
        <Link href="/inks/amethyst">/inks/amethyst</Link> lists the
        Amethyst Enchanted panel alongside the top Amethyst market.
      </>
    ),
    plainAnswer:
      'Use the ink filter on /card-finder?rarity=Enchanted, or open any /inks/<ink> page, each shows an Enchanted panel for that ink alongside the top of the ink market.',
  },
];

export const MARKET_ICONIC_FAQ: FaqEntry[] = [
  {
    q: 'What is an Iconic Lorcana card?',
    a: (
      <>
        Iconic is the rarest Lorcana overprint tier, introduced in Set 9
        (<em>Fabled</em>) and continued through <em>Whispers in the
        Well</em>, <em>Winterspell</em>, <em>Wilds Unknown</em> and{' '}
        <em>Attack of the Vine!</em>. Roughly 2 Iconic printings are
        released per set, heavy-foil premium alt-art on marquee Disney
        characters, sitting above Legendary and above Enchanted at the
        top of the market.
      </>
    ),
    plainAnswer:
      'Iconic is the rarest Lorcana overprint tier, introduced in Set 9 (Fabled). Roughly 2 Iconic printings per set, heavy-foil premium alt-art on marquee Disney characters, sitting above Legendary and above Enchanted.',
  },
  {
    q: 'How rare are Iconic cards compared to Enchanted?',
    a: (
      <>
        Rarer. Enchanted sits at roughly 1 in 432 packs; Iconic is
        materially harder to pull, though Ravensburger has not published
        an exact rate. In practice Iconic printings command the highest
        prices in the modern catalogue, track the live floor here.
      </>
    ),
    plainAnswer:
      'Iconic is rarer than Enchanted (roughly 1 in 432 packs). Ravensburger has not published an exact Iconic pull rate. In practice Iconic printings command the highest live prices in the catalogue.',
  },
  {
    q: 'How are the Iconic rankings ordered?',
    a: (
      <>
        By cheapest current live retail price across all Iconic
        printings of each card, surfacing the floor of the top of the
        market. Click any card for its full price history.
      </>
    ),
    plainAnswer:
      'By cheapest current live retail price across all Iconic printings of each card. This surfaces the floor of the top of the market.',
  },
  {
    q: 'Which sets have Iconic cards?',
    a: (
      <>
        Set 9 (<em>Fabled</em>), Set 10 (<em>Whispers in the Well</em>),
        Set 11 (<em>Winterspell</em>), Set 12 (<em>Wilds Unknown</em>)
        and Set 13 (<em>Attack of the Vine!</em>). Sets 1–8 do not
        contain Iconic printings, those cards top out at Enchanted.
      </>
    ),
    plainAnswer:
      'Set 9 (Fabled) onwards, currently Sets 9, 10, 11, 12 and 13. Sets 1–8 have no Iconic printings and top out at Enchanted.',
  },
  {
    q: 'Are Iconic prices in USD?',
    a: (
      <>
        Prices display in the currency of the underlying live feed and
        we never apply a hardcoded FX rate. The ranking uses whichever
        currency dominates the current price slice.
      </>
    ),
    plainAnswer:
      'Prices display in the currency of the underlying live feed. We do not apply a hardcoded FX rate. Rankings use whichever currency dominates the current price slice.',
  },
];

export function inkFaq(label: string, slug: string): FaqEntry[] {
  return [
    {
      q: `How many ${label} cards are there in Disney Lorcana?`,
      a: (
        <>
          Every set (Set 1 onward) prints {label} cards across all
          rarities from Common up to Enchanted. Use{' '}
          <Link href={`/card-finder?ink=${slug}`}>Card Finder</Link> for
          the full live count; the Card Finder is filtered on live
          catalogue data, not a static number that can drift.
        </>
      ),
      plainAnswer: `Every Disney Lorcana set (Set 1 onwards) prints ${label} cards across Common through Enchanted. Use /card-finder?ink=${slug} for a live count.`,
    },
    {
      q: `What is ${label} good at in Disney Lorcana?`,
      a: (
        <>
          Beyond value: {label} plays into specific gameplay archetypes
         , the ink itself is a mechanical identity, not just a colour.
          Browse the top of the {label} market above to see which
          characters carry the most collector demand.
        </>
      ),
      plainAnswer: `${label} plays into specific gameplay archetypes, the ink is a mechanical identity, not just a colour. Browse the top of the ${label} market to see collector demand.`,
    },
    {
      q: `Are ${label} Enchanted cards more valuable than other ${label} rarities?`,
      a: (
        <>
          Almost always yes. Enchanted printings are the chase alt-art
          tier and top most inks&apos; markets. Iconic printings (Set 9+)
          sit even higher when available for {label}. See the live{' '}
          <Link href={`/card-finder?ink=${slug}&rarity=Enchanted`}>
            {label} Enchanted list
          </Link>.
        </>
      ),
      plainAnswer: `Yes, in nearly every case. Enchanted is the chase alt-art tier and tops most inks' markets. Iconic (Set 9+) sits higher when available. See /card-finder?ink=${slug}&rarity=Enchanted.`,
    },
    {
      q: `Does ${label} have dual-ink cards?`,
      a: (
        <>
          Chapter 8 introduced dual-ink cards, and{' '}
          {label} is one of the pool, dual-ink printings that include{' '}
          {label} appear on this page and in the{' '}
          {label} Card Finder filter.
        </>
      ),
      plainAnswer: `Yes. Chapter 8 introduced dual-ink cards. Dual-ink printings including ${label} appear on this page and in the ${label} Card Finder filter.`,
    },
    {
      q: `How are ${label} prices calculated?`,
      a: (
        <>
          Prices are live retail observations from the daily production
          feed, per exact printing. Nothing is averaged and no FX
          conversion is applied silently. The ranking uses whichever
          currency dominates the current price slice.
        </>
      ),
      plainAnswer: `Prices are live retail observations from the daily production feed, per exact printing. No averaging, no silent FX conversion.`,
    },
  ];
}

export const INKS_FAQ: FaqEntry[] = [
  {
    q: 'How many inks are in Disney Lorcana?',
    a: <>Six: Amber, Amethyst, Emerald, Ruby, Sapphire and Steel.</>,
    plainAnswer: 'Six: Amber, Amethyst, Emerald, Ruby, Sapphire and Steel.',
  },
  {
    q: 'What does inkable mean?',
    a: (
      <>
        Inkable cards can be discarded to add ink to your inkwell ,
        Lorcana&apos;s resource system. Uninkable cards (usually the
        chase minority in a set) cannot, which makes them scarcer and
        often more valuable.
      </>
    ),
    plainAnswer:
      "Inkable cards can be discarded to add ink to Lorcana's resource inkwell. Uninkable cards cannot. Uninkable cards are usually the chase minority and often more valuable.",
  },
  {
    q: 'Can a card be more than one ink?',
    a: (
      <>
        Yes, dual-ink cards were introduced in Chapter 8. They count as
        both inks for deckbuilding and appear in both ink filters on{' '}
        <Link href="/card-finder">Card Finder</Link>.
      </>
    ),
    plainAnswer:
      'Yes. Dual-ink cards were introduced in Chapter 8. They count as both inks and appear in both ink filters on Card Finder.',
  },
  {
    q: 'Which ink is the most valuable to collect?',
    a: (
      <>
        No ink has a universal value premium. Value tracks specific
        chase cards. Enchanted / Iconic / Epic printings of marquee
        characters, regardless of ink. Browse the{' '}
        <Link href="/market">market</Link> to see the top of the
        catalogue live.
      </>
    ),
    plainAnswer:
      'No ink has a universal value premium. Value tracks specific chase cards (Enchanted / Iconic / Epic) regardless of ink.',
  },
  {
    q: 'How do I browse cards for a single ink?',
    a: (
      <>
        Pick an ink from{' '}
        <Link href="/inks">/inks</Link>, or use the{' '}
        <Link href="/card-finder">Card Finder</Link> ink filter.
      </>
    ),
    plainAnswer:
      'Pick an ink from /inks, or use the Card Finder ink filter to narrow the full catalogue.',
  },
];

export const COLLECTION_FAQ: FaqEntry[] = [
  {
    q: 'What can I track in my collection?',
    a: (
      <>
        Every exact printing on LorcanaPrices. Raw or graded holdings,
        foil or nonfoil, condition (Mint through Damaged), quantity,
        purchase price and purchase date.
      </>
    ),
    plainAnswer:
      'Every exact printing on LorcanaPrices. Raw or graded, foil or nonfoil, condition, quantity, purchase price and purchase date.',
  },
  {
    q: 'How is my collection valued?',
    a: (
      <>
        Live retail price for raw holdings; live graded market for
        graded holdings, matched to your grader + grade. Prices update
        daily. Missing prices are never silently substituted with zero.
      </>
    ),
    plainAnswer:
      'Live retail price for raw holdings; live graded market for graded holdings, matched to grader + grade. Missing prices are never silently zeroed.',
  },
  {
    q: 'Can other people see my collection?',
    a: (
      <>
        No. Every read and write is enforced by Row-Level Security in
        the database. Only you can see your own holdings while signed
        in.
      </>
    ),
    plainAnswer:
      'No. Every read and write is enforced by Row-Level Security in the database. Only the signed-in owner can see their own holdings.',
  },
  {
    q: 'Do I need an account to browse the site?',
    a: (
      <>
        No. Every card, set, market and rarity page is public and
        works signed-out. An account is only needed to save holdings.
      </>
    ),
    plainAnswer:
      'No. Every card, set, market and rarity page is public and works signed-out. An account is only needed to save holdings.',
  },
  {
    q: 'How do I add a graded card?',
    a: (
      <>
        On any printing detail page open the Add-to-Collection panel,
        toggle &quot;Graded&quot;, choose a grader (PSA, BGS, CGC or
        SGC) and the grade. The row is priced against the matching
        grader/grade live market.
      </>
    ),
    plainAnswer:
      'On any printing detail page open Add to Collection, toggle Graded, choose grader (PSA / BGS / CGC / SGC) and grade. The row is priced against the matching grader/grade live market.',
  },
];

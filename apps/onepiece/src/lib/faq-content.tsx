// Static, evergreen FAQ content used by home / card-finder / market /
// collection / colours / leaders surfaces. Card- and set-page FAQs
// are generated dynamically from DB data (see server helpers).

import Link from 'next/link';
import type { FaqEntry } from '@/components/Faq';

export const HOMEPAGE_FAQ: FaqEntry[] = [
  {
    q: 'What is OnePiecePrices?',
    a: (
      <>
        OnePiecePrices is a collector-focused price and catalogue site
        for the One Piece Card Game. Every printing, treatment and
        finish is tracked as its own priced entity, backed by a daily
        live feed. Browsing is free; a free account also lets you{' '}
        <Link href="/collection">track a collection</Link>.
      </>
    ),
    plainAnswer:
      'OnePiecePrices is a collector-focused price and catalogue site for the One Piece Card Game. Every printing, treatment and finish is tracked as its own priced entity, backed by a daily live feed. Free to browse and to track a collection.',
  },
  {
    q: 'How are One Piece card prices calculated?',
    a: (
      <>
        Prices come from a daily live retail feed (Cardmarket EU) mapped
        onto our shared TCG schema. We display the current price per
        exact printing. Never an averaged number. And never convert
        currencies silently.
      </>
    ),
    plainAnswer:
      'Prices come from a daily live retail feed (Cardmarket EU) mapped onto our shared TCG schema. We show the current price per exact printing, never averaged, never silently FX-converted.',
  },
  {
    q: 'What are Parallels, Secret Rares and Treasure Rares?',
    a: (
      <>
        Parallels are alternate-frame or holo variants of an existing
        card. Recognisable by a <code>_p1</code>, <code>_p2</code> or
        higher suffix on the collector number. Secret Rares (SEC) and
        Treasure Rares (TR) are chase overprints released above the
        base rarity ladder. Every treatment is priced individually on
        OnePiecePrices.
      </>
    ),
    plainAnswer:
      'Parallels are alternate-frame variants recognisable by a _p1 / _p2 collector-number suffix. Secret Rares (SEC) and Treasure Rares (TR) are chase overprints above the base rarity ladder. Every treatment is priced individually.',
  },
  {
    q: 'Are Alt Art and Manga Rare treatments distinguished from Parallels?',
    a: (
      <>
        Not reliably. In our production data (and in the underlying
        TCGGraph feed) <em>Alt Art</em> and <em>Manga Rare</em> do not
        have a separate treatment tag for the One Piece Card Game.
        Cards that a player might colloquially call &quot;Alt Art&quot;
        or &quot;Manga Rare&quot; collapse into the Parallel treatment
        family here. We deliberately refuse to invent Alt Art or Manga
        Rare labels from a <code>_p#</code> suffix alone.
      </>
    ),
    plainAnswer:
      'Not reliably. Alt Art and Manga Rare treatments do not have a separate ingest tag for One Piece today; they collapse into the Parallel treatment. OnePiecePrices refuses to invent those labels from a _p# suffix alone.',
  },
  {
    q: 'How often are prices updated?',
    a: (
      <>
        Retail prices refresh daily via a scheduled TCGGraph job.
        Freshness (newest observation date) is verifiable via an
        internal data-health probe.
      </>
    ),
    plainAnswer:
      'Retail prices refresh daily via a scheduled TCGGraph refresh job. Freshness is verifiable via an internal data-health probe.',
  },
  {
    q: 'Can I track my One Piece collection?',
    a: (
      <>
        Yes. <Link href="/sign-up">Create a free account</Link> and you
        can save exact printings, foil vs nonfoil, quantities,
        condition and raw vs graded holdings. Live valuation runs on
        the same prices the rest of the site uses.
      </>
    ),
    plainAnswer:
      'Yes. Create a free account and save exact printings, foil vs nonfoil, quantities, condition and raw vs graded holdings. Live valuation runs on the same prices as the rest of the site.',
  },
  {
    q: 'Are the current card images clean?',
    a: (
      <>
        No. The images we ingest today carry a baked-in SAMPLE
        watermark that the upstream feed applies. OnePiecePrices does
        not remove or crop watermarks; if a clean, licensed image
        source becomes available we will source it directly rather
        than manipulate the watermarked copies.
      </>
    ),
    plainAnswer:
      'No. Current ingested card images carry a baked-in SAMPLE watermark from the upstream feed. OnePiecePrices does not crop or remove watermarks and will source clean images licensed separately when available.',
  },
  {
    q: 'Can I buy cards through OnePiecePrices?',
    a: (
      <>
        We don&apos;t sell cards. Card pages carry a &quot;Find on
        eBay&quot; button. An affiliate link that opens a targeted
        eBay search for the exact printing. OnePiecePrices may earn a
        commission on qualifying purchases at no cost to you.
      </>
    ),
    plainAnswer:
      'OnePiecePrices does not sell cards. Card pages carry a "Find on eBay" affiliate link that opens a targeted search for the exact printing.',
  },
];

export const CARD_FINDER_FAQ: FaqEntry[] = [
  {
    q: 'What can I filter One Piece cards by?',
    a: (
      <>
        Colour, card type (Leader / Character / Event / Stage / DON!!),
        rarity, treatment, cost and power ranges. Plus the language
        axis. Filters are URL-driven so any view is shareable.
      </>
    ),
    plainAnswer:
      'Colour, card type (Leader / Character / Event / Stage / DON!!), rarity, treatment, cost and power ranges, plus language. Filters are URL-driven so any view is shareable.',
  },
  {
    q: 'How do I find only Leaders?',
    a: (
      <>
        Head to <Link href="/leaders">/leaders</Link> for the leader
        directory, or filter Card Finder by rarity <code>L</code> or
        card type <code>Leader</code>.
      </>
    ),
    plainAnswer:
      'Head to /leaders for the leader directory, or filter Card Finder by rarity L / card type Leader.',
  },
  {
    q: 'What is the difference between Parallel and Reprint?',
    a: (
      <>
        A Parallel is an alternate-frame or holo variant released in
        the same set as the base card; its collector number carries a{' '}
        <code>_p#</code> suffix. A Reprint is a subsequent print run
        of the same card, distinguished by a <code>_r#</code> suffix.
        Both are priced separately from the base printing.
      </>
    ),
    plainAnswer:
      'A Parallel is an alternate-frame variant released in the same set, carrying a _p# suffix. A Reprint is a subsequent print run, carrying a _r# suffix. Both are priced separately from the base printing.',
  },
  {
    q: 'Do you support English and Japanese printings?',
    a: (
      <>
        Today the ingest is English only. Japanese and Asian-market
        printings are on the roadmap.
      </>
    ),
    plainAnswer:
      'English printings only today. Japanese and Asian-market printings are on the roadmap.',
  },
];

export const MARKET_FAQ: FaqEntry[] = [
  {
    q: 'How is "most valuable" calculated?',
    a: (
      <>
        For each unique card we take the dearest retail-quality
        printing currently on the market and rank across the
        catalogue. This surfaces the chase printing rather than the
        cheapest copy.
      </>
    ),
    plainAnswer:
      'For each unique card we take the dearest retail-quality printing currently on the market and rank across the catalogue.',
  },
  {
    q: 'Why is the ranking in EUR?',
    a: (
      <>
        Today&apos;s live One Piece feed is Cardmarket EU (EUR). We
        rank within a single currency. Never with a hardcoded FX
        rate. When additional currencies arrive we surface them
        explicitly.
      </>
    ),
    plainAnswer:
      "Today's live One Piece feed is Cardmarket EU (EUR). We rank within a single currency and never apply a hardcoded FX rate.",
  },
  {
    q: 'What counts as a "chase" card in One Piece?',
    a: (
      <>
        Treasure Rares (TR), Secret Rares (SEC) and Special Cards (SP
        CARD) sit above the base rarity ladder and lead the modern
        market. Parallels of marquee Leaders also command premiums.
        Browse them at <Link href="/market#chase">/market#chase</Link>.
      </>
    ),
    plainAnswer:
      'Treasure Rares (TR), Secret Rares (SEC) and Special Cards (SP CARD) sit above the base rarity ladder and lead the modern market. Parallels of marquee Leaders also command premiums.',
  },
  {
    q: 'Are graded prices tracked?',
    a: (
      <>
        Yes. Graded panels appear on card and printing pages when we
        have live graded observations. Grader coverage includes PSA,
        BGS, CGC and SGC.
      </>
    ),
    plainAnswer:
      'Yes. Graded panels appear on card and printing pages when live graded observations are available. Coverage includes PSA, BGS, CGC and SGC.',
  },
];

export const COLLECTION_FAQ: FaqEntry[] = [
  {
    q: 'What can I track in my One Piece collection?',
    a: (
      <>
        Every exact printing on OnePiecePrices. Raw or graded
        holdings, foil or nonfoil, condition, quantity, purchase price
        and purchase date.
      </>
    ),
    plainAnswer:
      'Every exact printing on OnePiecePrices. Raw or graded, foil or nonfoil, condition, quantity, purchase price and purchase date.',
  },
  {
    q: 'How is my collection valued?',
    a: (
      <>
        Live retail price for raw holdings; live graded market for
        graded holdings, matched to your grader + grade. Missing
        prices are never silently zeroed.
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
    q: 'How do I add a graded slab?',
    a: (
      <>
        On any printing detail page (or via the Add-to-Collection
        picker on the logical card page), toggle &quot;Graded&quot;,
        pick a grader (PSA / BGS / CGC / SGC) and enter the grade.
      </>
    ),
    plainAnswer:
      'On any printing detail page (or via the Add-to-Collection picker on the logical card page), toggle Graded, pick a grader (PSA / BGS / CGC / SGC) and enter the grade.',
  },
];

export const COLOURS_FAQ: FaqEntry[] = [
  {
    q: 'How many colours are there in the One Piece Card Game?',
    a: <>Six primary colours: Red, Green, Blue, Purple, Black and Yellow. Dual-colour Leaders combine two of these.</>,
    plainAnswer:
      'Six primary colours: Red, Green, Blue, Purple, Black and Yellow. Dual-colour Leaders combine two of these.',
  },
  {
    q: 'What is a dual-colour Leader?',
    a: (
      <>
        A Leader whose card lists two colours (e.g. Red/Yellow). The
        Leader defines the deck&apos;s colour identity, so a
        two-colour Leader unlocks Characters and Events from either
        colour.
      </>
    ),
    plainAnswer:
      'A Leader whose card lists two colours (e.g. Red/Yellow). The Leader defines the deck colour identity so a two-colour Leader unlocks Characters and Events from either colour.',
  },
  {
    q: 'Which colour has the most value?',
    a: (
      <>
        No colour has a universal value premium. Chase treatments
        (Secret / Treasure / Special / Parallels of marquee Leaders)
        drive value regardless of colour. Browse the top of the
        market at <Link href="/market">/market</Link>.
      </>
    ),
    plainAnswer:
      'No colour has a universal value premium. Chase treatments (Secret / Treasure / Special / Parallels of marquee Leaders) drive value regardless of colour.',
  },
];

export const LEADERS_FAQ: FaqEntry[] = [
  {
    q: 'How does a Leader card work?',
    a: (
      <>
        A Leader is the anchor of a One Piece deck. It dictates the
        deck&apos;s colour identity, contributes its Power and Life,
        and often carries a passive or activated effect. Every deck
        must include exactly one Leader.
      </>
    ),
    plainAnswer:
      "A Leader anchors a One Piece deck. It dictates the deck's colour identity, contributes its Power and Life, and often carries an effect. Every deck must include exactly one Leader.",
  },
  {
    q: 'Are Leader Parallels priced separately?',
    a: (
      <>
        Yes. A Leader has a base <code>L</code> rarity printing and
        can also have Parallel treatments (<code>_p1</code>,
        {' '}<code>_p2</code>, etc.). Each Parallel is priced
        individually because collectors treat them as distinct chase
        printings.
      </>
    ),
    plainAnswer:
      'Yes. A Leader has a base L rarity and can also have Parallel treatments (_p1, _p2, etc.). Each Parallel is priced individually.',
  },
  {
    q: 'Why do some Leaders command such high prices?',
    a: (
      <>
        Marquee Leaders like Monkey.D.Luffy anchor multiple archetype
        decks and appear in Enchanted-style Parallel and Special Card
        treatments. Chase treatments plus competitive demand push
        those printings to the top of the market.
      </>
    ),
    plainAnswer:
      'Marquee Leaders anchor multiple archetype decks and appear in Parallel and Special Card treatments. Chase treatments plus competitive demand push those printings to the top of the market.',
  },
];

export function colourFaq(label: string, slug: string): FaqEntry[] {
  return [
    {
      q: `How many ${label} cards are there in the One Piece Card Game?`,
      a: (
        <>
          Every set from OP01 onwards has printed {label} cards across
          Common through Secret Rare. Use{' '}
          <Link href={`/card-finder?colour=${slug}`}>Card Finder</Link>{' '}
          for a live count.
        </>
      ),
      plainAnswer: `Every set from OP01 onwards prints ${label} cards across Common through Secret Rare. Use /card-finder?colour=${slug} for a live count.`,
    },
    {
      q: `What is ${label} good at in the One Piece Card Game?`,
      a: (
        <>
          Beyond value, {label} plays into specific gameplay
          archetypes. The colour is a mechanical identity, not just
          a palette choice. Browse the top of the {label} market
          above to see which characters carry the most collector
          demand.
        </>
      ),
      plainAnswer: `${label} plays into specific gameplay archetypes. The colour is a mechanical identity, not just a palette choice. Browse the top of the ${label} market to see collector demand.`,
    },
    {
      q: `Are ${label} Secret Rares more valuable than other ${label} rarities?`,
      a: (
        <>
          Almost always yes. Secret Rares and Treasure Rares top most
          colours&apos; markets. See the live{' '}
          <Link href={`/card-finder?colour=${slug}&rarity=SEC`}>
            {label} Secret Rare list
          </Link>.
        </>
      ),
      plainAnswer: `Yes in nearly every case. Secret Rares (SEC) and Treasure Rares (TR) top most colours' markets. See /card-finder?colour=${slug}&rarity=SEC.`,
    },
    {
      q: `Are ${label} prices in EUR?`,
      a: (
        <>
          Yes for the current Cardmarket EU feed. We do not silently
          convert currencies; the ranking uses whichever currency
          dominates the price slice.
        </>
      ),
      plainAnswer: `Yes for the current Cardmarket EU feed. We do not silently convert currencies.`,
    },
  ];
}

export function setFaq(setName: string, setCode: string): FaqEntry[] {
  return [
    {
      q: `What is in the ${setName} set?`,
      a: (
        <>
          {setName} ({setCode.toUpperCase()}) contains every card
          released in this print run. Base rarities plus any
          Parallels, Secret Rares, Treasure Rares and Special Cards
          that shipped with the set. Every treatment is priced
          individually.
        </>
      ),
      plainAnswer: `${setName} (${setCode.toUpperCase()}) contains every card released in this print run. Base rarities plus any Parallels, Secret Rares, Treasure Rares and Special Cards. Every treatment is priced individually.`,
    },
    {
      q: `Where can I buy sealed ${setName} product?`,
      a: (
        <>
          Use the &quot;Find sealed {setName} on eBay&quot; button at
          the top of this page. It runs a targeted affiliate search
          for the sealed booster box, starter deck or extra booster
          matching this set.
        </>
      ),
      plainAnswer: `Use the "Find sealed on eBay" affiliate button on the set page. It runs a targeted search for the sealed booster box, starter deck or extra booster for ${setName}.`,
    },
    {
      q: `What are the chase cards in ${setName}?`,
      a: (
        <>
          Chase cards are the highest-priced treatments in this set.
          On the set page they appear at the top of the priced grid
          (Secret Rare, Treasure Rare, Special Card and marquee
          Parallels).
        </>
      ),
      plainAnswer: `Chase cards are the highest-priced treatments in this set. Secret Rare, Treasure Rare, Special Card and marquee Parallels. They appear at the top of the priced grid.`,
    },
  ];
}

export function logicalCardFaq(
  cardName: string,
  facts: {
    treatmentCount: number;
    printingCount: number;
    colours: string[];
    rarities: string[];
  },
): FaqEntry[] {
  const treatmentPhrase =
    facts.treatmentCount === 1
      ? 'one treatment'
      : `${facts.treatmentCount} treatments`;
  const printingPhrase =
    facts.printingCount === 1
      ? 'one printing'
      : `${facts.printingCount} printings`;
  const coloursPhrase =
    facts.colours.length === 0 ? '' : facts.colours.join(' / ');
  const rarityPhrase =
    facts.rarities.length === 0 ? '' : facts.rarities.join(', ');

  return [
    {
      q: `How many printings of ${cardName} exist?`,
      a: (
        <>
          We currently track {printingPhrase} of {cardName} across{' '}
          {treatmentPhrase}. Each printing is priced individually
          because collectors treat treatments as distinct chase
          entities.
        </>
      ),
      plainAnswer: `${cardName} currently has ${printingPhrase} across ${treatmentPhrase}. Each printing is priced individually.`,
    },
    {
      q: `What colour is ${cardName}?`,
      a: coloursPhrase
        ? <>{coloursPhrase}.</>
        : <>Ingest data has no colour on this card yet.</>,
      plainAnswer: coloursPhrase
        ? `${coloursPhrase}.`
        : `Ingest data has no colour on this card yet.`,
    },
    {
      q: `What rarity is ${cardName}?`,
      a: rarityPhrase
        ? <>Across every printing of {cardName} the rarities recorded are: {rarityPhrase}.</>
        : <>Rarity data is missing for this card.</>,
      plainAnswer: rarityPhrase
        ? `Across every printing of ${cardName} the rarities recorded are: ${rarityPhrase}.`
        : `Rarity data is missing for this card.`,
    },
    {
      q: `Is ${cardName} a Manga Rare or Alt Art?`,
      a: (
        <>
          We do not label {cardName} as Manga Rare or Alt Art unless
          the ingest source tags it explicitly. In our current One
          Piece feed those treatments are not distinguishable from
          Parallels; a <code>_p1</code> or <code>_p2</code> suffix is
          shown as Parallel, never inferred as Manga or Alt Art.
        </>
      ),
      plainAnswer: `We do not label ${cardName} as Manga Rare or Alt Art unless the ingest tags it explicitly. In the current One Piece feed those treatments are not distinguishable from Parallels.`,
    },
  ];
}

/** Deterministic FAQ for an exact variant page (Level B). Every
 *  question is derived from DB facts — the card's collector number,
 *  set, treatment, headline market signal, whether graded rows exist,
 *  whether a Cardmarket / TCGPlayer product id is known. Content is
 *  stable across renders so the FAQPage JSON-LD stays canonical. */
export function variantFaq(facts: {
  cardName: string;
  collectorNumber: string;
  baseCollectorNumber: string;
  setLabel: string;
  setCode: string;
  treatmentLabel: string;
  variantIndex: number | null;
  rarityLabel: string;
  hasCardmarketQuote: boolean;
  hasTcgplayerQuote: boolean;
  cardmarketHeadline: { price: number; currency: 'EUR' | 'USD'; signal: 'avg30d' | 'priceLow' | 'trend' } | null;
  tcgplayerHeadline: { price: number; currency: 'EUR' | 'USD'; signal: 'avg30d' | 'priceLow' | 'trend' } | null;
  hasGraded: boolean;
  isParallel: boolean;
  isReprint: boolean;
  siblingCount: number;
}): FaqEntry[] {
  const {
    cardName, collectorNumber, baseCollectorNumber: base, setLabel, setCode,
    treatmentLabel, variantIndex, rarityLabel,
    hasCardmarketQuote, hasTcgplayerQuote,
    cardmarketHeadline, tcgplayerHeadline,
    hasGraded, isParallel, isReprint, siblingCount,
  } = facts;
  const signalWord = (s: 'avg30d' | 'priceLow' | 'trend'): string =>
    s === 'avg30d' ? '30-day average' : s === 'priceLow' ? 'marketplace-low listing' : 'top listing';
  const fmt = (p: number, c: 'EUR' | 'USD'): string => {
    const digits = p >= 100 ? 0 : 2;
    const n = p.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return c === 'EUR' ? `€${n}` : `$${n}`;
  };
  const entries: FaqEntry[] = [];

  // Q1 — price on both markets (always shown)
  const priceLine = (() => {
    if (cardmarketHeadline && tcgplayerHeadline) {
      return `Cardmarket ${signalWord(cardmarketHeadline.signal)} is ${fmt(cardmarketHeadline.price, 'EUR')}. TCGPlayer ${signalWord(tcgplayerHeadline.signal)} is ${fmt(tcgplayerHeadline.price, 'USD')}. We never FX-convert between them.`;
    }
    if (cardmarketHeadline) {
      return `Cardmarket ${signalWord(cardmarketHeadline.signal)} is ${fmt(cardmarketHeadline.price, 'EUR')}. TCGPlayer has no live quote for this variant right now.`;
    }
    if (tcgplayerHeadline) {
      return `TCGPlayer ${signalWord(tcgplayerHeadline.signal)} is ${fmt(tcgplayerHeadline.price, 'USD')}. Cardmarket has no live quote for this variant right now.`;
    }
    return `Neither Cardmarket nor TCGPlayer has a live quote for this exact variant right now.`;
  })();
  entries.push({
    q: `How much is ${cardName} ${collectorNumber} worth right now?`,
    a: <>{priceLine} We track each collectible variant as its own priced entity, so this figure is the {treatmentLabel.toLowerCase()} treatment of {cardName} in {setLabel} — never averaged across siblings.</>,
    plainAnswer: `${priceLine} We track each collectible variant as its own priced entity — the ${treatmentLabel.toLowerCase()} treatment of ${cardName} in ${setLabel} — never averaged across siblings.`,
  });

  // Q2 — identity ("how do I tell this variant apart")
  const identityAnswer = (() => {
    if (isParallel) {
      return `The base ${base} print sits at a different price band from this parallel${variantIndex != null ? ` (#${variantIndex})` : ''}. The parallel treatment carries a distinct Cardmarket / TCGPlayer product id, so its market listings never appear under the base collector number.`;
    }
    if (isReprint) {
      return `This is a reprint of the base ${base}. The reprint carries its own marketplace product id and its own price signal, distinct from the original print.`;
    }
    return `This is the base ${base} print of ${cardName}. Parallels and reprints of the same base carry a suffix on the collector number (e.g. ${base}_p1) and are tracked as separate priced entities on their own pages.`;
  })();
  entries.push({
    q: `How can I tell my ${cardName} is the ${collectorNumber} version and not another treatment?`,
    a: <>{identityAnswer}</>,
    plainAnswer: identityAnswer,
  });

  // Q3 — how to buy (deep-link commitment)
  const buyLine = (() => {
    const parts: string[] = [];
    if (hasCardmarketQuote) parts.push('the Cardmarket product listing (EUR)');
    if (hasTcgplayerQuote) parts.push('the TCGPlayer product listing (USD)');
    parts.push('an eBay search narrowed to this collector number');
    if (parts.length === 1) return `We link to ${parts[0]}.`;
    if (parts.length === 2) return `We link to ${parts[0]} and ${parts[1]}.`;
    return `We link to ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
  })();
  entries.push({
    q: `Where can I buy ${cardName} ${collectorNumber}?`,
    a: (
      <>
        {buyLine} Every buy link on this page is scoped to this exact
        variant, not the base card family, so the marketplace lands on
        the same listing whose price is quoted above.
      </>
    ),
    plainAnswer: `${buyLine} Every buy link on this page is scoped to this exact variant, not the base card family.`,
  });

  // Q4 — rarity/treatment context
  entries.push({
    q: `What treatment is ${cardName} ${collectorNumber}?`,
    a: (
      <>
        {treatmentLabel}
        {variantIndex != null ? ` #${variantIndex}` : ''}
        , rarity {rarityLabel}. This is what our database source records
        for the collector number. We never invent labels like Alt Art
        or Manga Rare beyond what the feed provides.
      </>
    ),
    plainAnswer: `${treatmentLabel}${variantIndex != null ? ` #${variantIndex}` : ''}, rarity ${rarityLabel}. We never invent treatment labels beyond what the ingest source records.`,
  });

  // Q5 — graded (only if data exists)
  if (hasGraded) {
    entries.push({
      q: `How much is a graded ${cardName} ${collectorNumber}?`,
      a: (
        <>
          Live PSA, BGS, CGC and SGC market prices for this exact
          variant are shown in the &ldquo;Graded card prices&rdquo;
          panel above. Rows are scoped to this collector number only;
          a slab price from another parallel of {cardName} is never
          shown under this variant.
        </>
      ),
      plainAnswer: `Live PSA, BGS, CGC and SGC market prices for ${cardName} ${collectorNumber} are shown in the Graded card prices panel above. Rows are scoped to this collector number only; slab prices from other parallels are never shown here.`,
    });
  } else {
    entries.push({
      q: `Are there graded prices for ${cardName} ${collectorNumber}?`,
      a: (
        <>
          No confidently-mapped PSA, BGS, CGC or SGC rows exist for
          this exact variant today. Rather than borrow a slab price
          from a sibling parallel, we render no graded panel until the
          feed carries data anchored to this collector number.
        </>
      ),
      plainAnswer: `No confidently-mapped PSA, BGS, CGC or SGC rows exist for ${cardName} ${collectorNumber} today. We do not borrow slab prices from sibling parallels.`,
    });
  }

  // Q6 — siblings / other versions
  if (siblingCount > 0) {
    entries.push({
      q: `Are there other versions of ${cardName} ${base}?`,
      a: (
        <>
          Yes. {cardName} {base} has {siblingCount} other collectible
          version{siblingCount === 1 ? '' : 's'} (parallels and
          reprints). Each has its own image, its own marketplace
          product id and its own price. They appear in the &ldquo;Other
          versions&rdquo; rail on this page.
        </>
      ),
      plainAnswer: `Yes. ${cardName} ${base} has ${siblingCount} other collectible version${siblingCount === 1 ? '' : 's'} (parallels and reprints). Each has its own image, marketplace product id and price.`,
    });
  }

  // Q7 — set context (evergreen closer)
  entries.push({
    q: `What set is ${cardName} ${collectorNumber} from?`,
    a: <>{setLabel} ({setCode.toUpperCase()}).</>,
    plainAnswer: `${setLabel} (${setCode.toUpperCase()}).`,
  });

  return entries;
}

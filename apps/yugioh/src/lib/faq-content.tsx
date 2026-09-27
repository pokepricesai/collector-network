// Static, evergreen FAQ content. Card/set/archetype/rarity page FAQs
// are generated deterministically from real DB data at render time
// via faq-* server helpers (see next to this file). Nothing is
// AI-generated — SEO content stays honest.

import Link from 'next/link';
import type { FaqEntry } from '../components/Faq';

export const HOMEPAGE_FAQ: FaqEntry[] = [
  {
    q: 'What is YGOPrices?',
    a: (
      <>
        YGOPrices is a collector-focused catalogue and market tracker
        for the Yu-Gi-Oh! Trading Card Game. Every printing — each
        set × rarity × edition — is tracked as its own priced entity
        backed by a daily retail feed and a graded market panel.
        Browsing is free; a free account lets you{' '}
        <Link href="/collection">track a collection</Link>,{' '}
        <Link href="/watchlist">watch printings</Link> and{' '}
        <Link href="/decks">save decks</Link>.
      </>
    ),
    plainAnswer:
      'YGOPrices is a collector-focused catalogue and market tracker for the Yu-Gi-Oh! Trading Card Game. Every set × rarity × edition printing is tracked separately, backed by a daily retail feed and a graded market panel.',
  },
  {
    q: 'How are Yu-Gi-Oh! card prices calculated?',
    a: (
      <>
        Retail prices come from a daily live feed (Cardmarket EU +
        TCGplayer). We display prices in their source currency and
        never apply a hardcoded FX conversion. Graded prices are
        tracked separately with grader, grade and attribution
        preserved.
      </>
    ),
    plainAnswer:
      'Retail prices come from a daily live feed (Cardmarket EU + TCGplayer). YGOPrices shows prices in their source currency and never applies hardcoded FX. Graded prices are tracked separately.',
  },
  {
    q: 'What is the difference between rarity and edition?',
    a: (
      <>
        <strong>Rarity</strong> is a physical print property — Common,
        Rare, Super Rare, Ultra Rare, Secret Rare, Ultimate, Ghost,
        Starlight, Quarter Century, Prismatic Secret, and product-
        specific rarities like Duel Terminal Parallel. <strong>Edition</strong>{' '}
        is the print run: <em>1st Edition</em>,{' '}
        <em>Unlimited</em>, or <em>Limited</em>. Rarity + edition +
        set + language together define a single printing, and each
        printing is priced separately.
      </>
    ),
    plainAnswer:
      'Rarity is a physical print property (Common, Rare, Super Rare, Ultra Rare, Secret Rare, etc.). Edition is the print run (1st Edition / Unlimited / Limited). Rarity + edition + set + language define a printing, and each is priced separately.',
  },
  {
    q: 'What is the Forbidden & Limited list?',
    a: (
      <>
        The <Link href="/forbidden-limited">Forbidden & Limited list</Link>{' '}
        is Konami&apos;s official ruling on which cards may be played
        in TCG-format decks and how many copies are legal. On
        YGOPrices we track the current TCG status (Forbidden, Limited
        to 1, Semi-Limited to 2, Unlimited to 3) alongside OCG counts.
        The list is snapshotted from the ingest feed — consult
        Konami&apos;s official page for tournament-critical decisions.
      </>
    ),
    plainAnswer:
      "The Forbidden & Limited list is Konami's official ruling on which cards can be played in TCG-format decks. YGOPrices tracks the current TCG status (Forbidden / Limited to 1 / Semi-Limited to 2 / Unlimited to 3) alongside OCG counts.",
  },
  {
    q: 'What can I do with a free YGOPrices account?',
    a: (
      <>
        A free account unlocks three things:{' '}
        <Link href="/collection">Collection</Link> tracking (save
        exact printings with edition, condition and purchase price),{' '}
        <Link href="/watchlist">Watchlist</Link> alerts on price
        movement, and <Link href="/decks">Deck</Link> saving with
        legality checks and public share URLs. Every read and write
        is Row-Level-Security scoped — only you see your own data.
      </>
    ),
    plainAnswer:
      'A free account unlocks Collection tracking (save exact printings with edition, condition and purchase price), Watchlist alerts on price movement, and Deck saving with legality checks and public share URLs. Row-Level Security scopes every read and write to the owner.',
  },
  {
    q: 'Can I buy Yu-Gi-Oh! cards through YGOPrices?',
    a: (
      <>
        YGOPrices doesn&apos;t sell cards. Card and printing pages
        carry a &quot;Find on eBay&quot; button — an affiliate link that
        opens a targeted eBay search for the exact printing. YGOPrices
        may earn a commission on qualifying purchases at no cost to
        you.
      </>
    ),
    plainAnswer:
      'YGOPrices does not sell cards. Card and printing pages carry a "Find on eBay" affiliate link that opens a targeted eBay search for the exact printing.',
  },
  {
    q: 'How often are prices updated?',
    a: (
      <>
        Retail prices refresh daily via a scheduled TCGGraph job.
        Graded observations arrive with each source refresh from PSA /
        BGS / CGC / SGC. Data-health probes verify freshness per game.
      </>
    ),
    plainAnswer:
      'Retail prices refresh daily via a scheduled TCGGraph job. Graded observations arrive with each source refresh from PSA / BGS / CGC / SGC.',
  },
];

export const CARD_FINDER_FAQ: FaqEntry[] = [
  {
    q: 'What can I filter Yu-Gi-Oh! cards by?',
    a: (
      <>
        Name (free-text), set, rarity, monster type, attribute, level /
        rank / link rating, ATK, DEF, archetype, Forbidden &amp; Limited
        status, and USD price range. Filters are URL-driven — copy the
        address bar to share a view.
      </>
    ),
    plainAnswer:
      'Name (free-text), set, rarity, monster type, attribute, level / rank / link rating, ATK, DEF, archetype, Forbidden & Limited status, and USD price range. Filters are URL-driven so any view is shareable.',
  },
  {
    q: 'Does Card Finder show every card by default?',
    a: (
      <>
        Yes. Opening the finder without filters lands you on the
        full catalogue. Add filters to narrow — the ranking sits on
        real live data at every step.
      </>
    ),
    plainAnswer:
      'Yes. Opening Card Finder without filters shows the full catalogue. Filters narrow the view; ranking sits on real live data.',
  },
  {
    q: 'How do I find the most valuable cards?',
    a: (
      <>
        Use{' '}
        <Link href="/card-finder?sort=price-desc">
          Card Finder sorted by price (high → low)
        </Link>{' '}
        or open the{' '}
        <Link href="/market/most-valuable">Most Valuable page</Link>{' '}
        directly for a curated ranking.
      </>
    ),
    plainAnswer:
      'Use Card Finder sorted by price (high → low), or open /market/most-valuable directly for a curated ranking.',
  },
  {
    q: 'Can I filter by archetype (Blue-Eyes, Spellcaster, etc.)?',
    a: (
      <>
        Yes. The Archetype filter reads from
        <code> gamedata.archetypes</code> — a card can belong to
        multiple archetypes and is included wherever it applies.
      </>
    ),
    plainAnswer:
      'Yes. The Archetype filter reads from gamedata.archetypes. A card can belong to multiple archetypes and is included wherever it applies.',
  },
];

export const MARKET_FAQ: FaqEntry[] = [
  {
    q: 'How is "most valuable" calculated?',
    a: (
      <>
        We rank the current live retail feed by price, filter to
        printings with a plausible headline price, and dedupe by
        logical card so a family with several priced printings shows
        once at its dearest treatment.
      </>
    ),
    plainAnswer:
      'We rank the current live retail feed by price, filter to plausible headline prices, and dedupe by logical card so each family shows once at its dearest printing.',
  },
  {
    q: 'Which currencies do you show?',
    a: (
      <>
        Prices are shown in their source currency — USD (TCGplayer) or
        EUR (Cardmarket). We never apply a hardcoded FX rate.
      </>
    ),
    plainAnswer:
      'Prices are shown in their source currency — USD (TCGplayer) or EUR (Cardmarket). No hardcoded FX conversion.',
  },
  {
    q: 'Are graded (slabbed) prices tracked?',
    a: (
      <>
        Yes. The <Link href="/market/graded">graded market</Link>{' '}
        panel shows PSA / BGS / CGC / SGC observations, attributed to
        the exact printing when the source provides it or the card
        family when it does not.
      </>
    ),
    plainAnswer:
      'Yes. /market/graded shows PSA / BGS / CGC / SGC observations, attributed to the exact printing when possible or the card family when the source is ambiguous.',
  },
  {
    q: 'Why do some cards have no price?',
    a: (
      <>
        Not every printing has active live listings. If the daily feed
        returned no price for a specific printing we leave it blank
        rather than substituting a stale number.
      </>
    ),
    plainAnswer:
      'Not every printing has active live listings. Blank means the daily feed returned no price for that printing — we never substitute stale data.',
  },
];

export const COLLECTION_FAQ: FaqEntry[] = [
  {
    q: 'What can I track in my collection?',
    a: (
      <>
        Every exact printing on YGOPrices. Raw or graded holdings,
        edition, condition (Mint through Damaged), quantity, purchase
        price and purchase date. Purchase price is stored with its
        currency, never silently FX-converted.
      </>
    ),
    plainAnswer:
      'Every exact printing on YGOPrices. Raw or graded, edition, condition, quantity, purchase price and purchase date. Purchase price is stored with its currency; no silent FX conversion.',
  },
  {
    q: 'How is my collection valued?',
    a: (
      <>
        Live retail price for raw holdings; live graded market for
        graded holdings, matched to grader and grade. Missing prices
        are never silently zeroed.
      </>
    ),
    plainAnswer:
      'Live retail price for raw holdings; live graded market for graded holdings, matched to grader and grade. Missing prices are never silently zeroed.',
  },
  {
    q: 'Can other people see my collection?',
    a: (
      <>
        No. Every read and write is enforced by Row-Level Security in
        the database. Only the signed-in owner can see or modify
        their holdings.
      </>
    ),
    plainAnswer:
      'No. Every read and write is enforced by Row-Level Security in the database. Only the signed-in owner can see or modify their holdings.',
  },
];

export const WATCHLIST_FAQ: FaqEntry[] = [
  {
    q: 'What does the watchlist track?',
    a: (
      <>
        An exact printing (set × rarity × edition × language) with its
        current live retail price and short-term movement (7 / 30 /
        90 day deltas). Adding a card doesn&apos;t buy anything — it
        surfaces price moves.
      </>
    ),
    plainAnswer:
      'An exact printing with its current live retail price and 7 / 30 / 90 day movement. It tracks price moves; nothing is purchased.',
  },
  {
    q: 'How do I add a card to my watchlist?',
    a: (
      <>
        Click the &quot;Watch&quot; button on any card or printing
        page. Signed-out visitors are prompted to sign in and are
        returned to the same page.
      </>
    ),
    plainAnswer:
      'Click the Watch button on any card or printing page. Signed-out visitors are prompted to sign in and returned to the same page.',
  },
  {
    q: 'Is my watchlist private?',
    a: <>Yes — Row-Level Security ensures only the signed-in owner sees their watches.</>,
    plainAnswer:
      'Yes. Row-Level Security ensures only the signed-in owner sees their watches.',
  },
];

export const DECKS_FAQ: FaqEntry[] = [
  {
    q: 'What format do decks target?',
    a: (
      <>
        TCG format. The legality engine reads from the live
        Forbidden &amp; Limited list; illegal cards are flagged as you
        build.
      </>
    ),
    plainAnswer:
      'TCG format. The legality engine reads from the live Forbidden & Limited list; illegal cards are flagged as you build.',
  },
  {
    q: 'Can I share a deck publicly?',
    a: (
      <>
        Yes. Toggle a deck to public in the sharing panel and it
        gets a stable <code>/deck/[slug]</code> URL. Unlisted decks
        use a token URL and are never indexed.
      </>
    ),
    plainAnswer:
      'Yes. Toggle to public in the sharing panel to get a stable /deck/[slug] URL. Unlisted decks use a token URL and are never indexed.',
  },
  {
    q: 'Does gameplay identity depend on the printing I pick?',
    a: (
      <>
        No. Deck gameplay identity is by card name (a normalised
        <code> card_key</code>). The specific printing you pick is a
        display hint for the visual — it never affects legality or
        gameplay.
      </>
    ),
    plainAnswer:
      'No. Deck gameplay identity is by card name (normalised card_key). The chosen printing is a display hint only; it never affects legality or gameplay.',
  },
];

export const ARCHETYPES_FAQ: FaqEntry[] = [
  {
    q: 'What counts as an archetype in Yu-Gi-Oh!?',
    a: (
      <>
        An archetype is a set of cards that share a name pattern —
        typically a common substring — and often support each other
        mechanically (e.g. Blue-Eyes, Sky Striker, Salamangreat). The
        list here comes from <code>gamedata.archetypes</code> on each
        card row.
      </>
    ),
    plainAnswer:
      'An archetype is a set of cards that share a name pattern (e.g. Blue-Eyes, Sky Striker, Salamangreat). YGOPrices reads archetype membership from gamedata.archetypes on each card row.',
  },
  {
    q: 'Can a card belong to more than one archetype?',
    a: (
      <>
        Yes — some cards support multiple archetypes and appear in
        each. The Card Finder&apos;s archetype filter matches whenever
        the card lists that archetype.
      </>
    ),
    plainAnswer:
      'Yes. Some cards support multiple archetypes and appear in each. Card Finder filters match whenever the card lists that archetype.',
  },
];

export const RARITIES_FAQ: FaqEntry[] = [
  {
    q: 'What rarities exist in the Yu-Gi-Oh! TCG?',
    a: (
      <>
        The base rarity ladder is Common → Rare → Super Rare → Ultra
        Rare → Secret Rare. Chase tiers include Ultimate Rare, Ghost
        Rare, Starlight Rare, Quarter Century Secret Rare and
        Prismatic Secret Rare. Product-specific rarities exist for
        Duel Terminal, Collectors, Platinum and older promo runs.
      </>
    ),
    plainAnswer:
      'Base: Common → Rare → Super Rare → Ultra Rare → Secret Rare. Chase tiers: Ultimate, Ghost, Starlight, Quarter Century Secret, Prismatic Secret. Additional product-specific rarities: Duel Terminal, Collectors, Platinum and legacy promo runs.',
  },
  {
    q: 'Are rarity names consistent across eras?',
    a: (
      <>
        No. Konami has retired, renamed and introduced rarities
        across the game&apos;s history. YGOPrices normalises to
        display-friendly names but preserves the ingest-time label
        for each printing so you can always see what was printed.
      </>
    ),
    plainAnswer:
      'No. Konami has retired, renamed and introduced rarities across the game. YGOPrices normalises to display names but preserves each printing\'s ingest-time label.',
  },
];

export const FNL_FAQ: FaqEntry[] = [
  {
    q: 'What is the Forbidden & Limited list?',
    a: (
      <>
        Konami&apos;s official ruling on which cards can appear in
        TCG-format decks and how many copies are legal. Statuses are
        Forbidden (0 copies), Limited (1), Semi-Limited (2) and
        Unlimited (3). OCG has its own list.
      </>
    ),
    plainAnswer:
      "Konami's official ruling on which cards can appear in TCG-format decks. Forbidden = 0 copies, Limited = 1, Semi-Limited = 2, Unlimited = 3. OCG has its own list.",
  },
  {
    q: 'How often does this list update?',
    a: (
      <>
        Konami updates the list on a schedule — typically ~3× per
        year plus emergency amendments. The version on YGOPrices is
        snapshotted from the ingest feed; for tournament-critical
        decisions consult Konami&apos;s official page for the current
        effective date.
      </>
    ),
    plainAnswer:
      "Konami updates the list roughly three times per year plus emergency amendments. YGOPrices snapshots from the ingest feed; for tournament-critical decisions consult Konami's official page for the current effective date.",
  },
];

export function cardFaq(name: string, facts: {
  printingCount: number;
  rarityCount: number;
  archetypes: string[];
  frameType: string | null;
  usdLow: number | null;
  usdHigh: number | null;
}): FaqEntry[] {
  const entries: FaqEntry[] = [
    {
      q: `How many printings of ${name} are there?`,
      a: (
        <>
          {facts.printingCount === 1
            ? `We currently track a single printing of ${name}.`
            : `We currently track ${facts.printingCount} printings of ${name} across ${facts.rarityCount} ${facts.rarityCount === 1 ? 'rarity' : 'rarities'}.`}{' '}
          Each printing (set × rarity × edition × language) is priced
          separately.
        </>
      ),
      plainAnswer:
        facts.printingCount === 1
          ? `We currently track a single printing of ${name}. Each printing is priced separately.`
          : `We currently track ${facts.printingCount} printings of ${name} across ${facts.rarityCount} ${facts.rarityCount === 1 ? 'rarity' : 'rarities'}. Each printing (set × rarity × edition × language) is priced separately.`,
    },
  ];
  if (facts.usdLow != null && facts.usdHigh != null) {
    const low = facts.usdLow.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const high = facts.usdHigh.toLocaleString('en-US', { maximumFractionDigits: 0 });
    entries.push({
      q: `How much is ${name} worth?`,
      a: (
        <>
          Live USD retail across every indexed printing of {name}{' '}
          currently spans ${low}
          {facts.usdHigh > facts.usdLow ? <> to ${high}</> : null}.
          Individual printing prices vary by rarity and edition.
        </>
      ),
      plainAnswer: `Live USD retail across every indexed printing of ${name} currently spans $${low}${facts.usdHigh > facts.usdLow ? ` to $${high}` : ''}. Individual printing prices vary by rarity and edition.`,
    });
  }
  if (facts.archetypes.length > 0) {
    entries.push({
      q: `What archetype is ${name} part of?`,
      a: (
        <>
          {name} lists the following archetype{facts.archetypes.length === 1 ? '' : 's'}:{' '}
          {facts.archetypes.map((a, i) => (
            <span key={a}>
              {i > 0 && ', '}
              <Link href={`/archetype/${a.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}>{a}</Link>
            </span>
          ))}.
        </>
      ),
      plainAnswer: `${name} lists the following archetype${facts.archetypes.length === 1 ? '' : 's'}: ${facts.archetypes.join(', ')}.`,
    });
  }
  entries.push({
    q: `Where can I buy ${name}?`,
    a: (
      <>
        Every printing page has a &quot;Find on eBay&quot; button that
        opens a targeted affiliate search using the exact set code,
        rarity and edition. YGOPrices does not sell cards directly.
      </>
    ),
    plainAnswer: `Every printing page has a "Find on eBay" button that opens a targeted affiliate search using the exact set code, rarity and edition. YGOPrices does not sell cards directly.`,
  });
  return entries;
}

export function setFaq(setName: string, setCode: string, facts: {
  uniqueCards: number;
  variants: number;
  rarities: number;
}): FaqEntry[] {
  return [
    {
      q: `How many cards are in the ${setName} set?`,
      a: (
        <>
          {setName} ({setCode.toUpperCase()}) contains{' '}
          {facts.uniqueCards.toLocaleString()} unique cards across{' '}
          {facts.variants.toLocaleString()} rarity variants
          {facts.rarities > 0 && ` (${facts.rarities} rarities)`}.
          Every variant is priced separately.
        </>
      ),
      plainAnswer: `${setName} (${setCode.toUpperCase()}) contains ${facts.uniqueCards.toLocaleString()} unique cards across ${facts.variants.toLocaleString()} rarity variants${facts.rarities > 0 ? ` (${facts.rarities} rarities)` : ''}. Every variant is priced separately.`,
    },
    {
      q: `Where can I buy sealed ${setName} product?`,
      a: (
        <>
          Use the &quot;Find sealed on eBay&quot; button at the top of
          this page. It runs a targeted affiliate search for sealed
          booster boxes, tins and structure decks for this set.
        </>
      ),
      plainAnswer: `Use the "Find sealed on eBay" button. It runs a targeted affiliate search for sealed booster boxes, tins and structure decks for ${setName}.`,
    },
    {
      q: `Are the prices on this set page live?`,
      a: (
        <>
          Yes. Each card tile shows the current best USD retail — or
          EUR retail as a fallback — from the daily production feed.
          Click a tile for the full print history and per-printing
          pricing.
        </>
      ),
      plainAnswer: `Yes. Each card tile shows the current best USD retail (or EUR fallback) from the daily production feed. Click a tile for full print history and per-printing pricing.`,
    },
  ];
}

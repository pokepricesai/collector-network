// Deterministic, DB-derived FAQ for a set page. Never invents facts.

import type { FaqEntry } from '@/components/Faq';
import type { TcgCard, TcgSet } from '@collector-network/database';
import type { LcSetMarket } from './set-market';

interface Args {
  set: TcgSet;
  cards: TcgCard[];
  market: LcSetMarket;
  uniqueNames: string[];
  rarityCounts: Record<string, number>;
}

function money(v: number, currency: string): string {
  const spec = ({ USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB' } as Record<string, string>)[currency] || 'en-US';
  try {
    return v.toLocaleString(spec, { style: 'currency', currency, maximumFractionDigits: 0 });
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

export function buildSetFaq({
  set, cards, market, uniqueNames, rarityCounts,
}: Args): FaqEntry[] {
  const entries: FaqEntry[] = [];
  const cardCount = cards.length;
  const uniqueCount = uniqueNames.length;
  const enchanted = rarityCounts['Enchanted'] ?? 0;
  const iconic = rarityCounts['Iconic'] ?? 0;
  const legendary = rarityCounts['Legendary'] ?? 0;
  const setCode = set.code.toUpperCase();
  const setName = set.name;

  entries.push({
    q: `How many cards are in ${setName}?`,
    a: (
      <>
        {setName} ({setCode}) has <strong>{uniqueCount.toLocaleString()}</strong> unique cards
        across <strong>{cardCount.toLocaleString()}</strong> tracked variants on
        LorcanaPrices.
      </>
    ),
    plainAnswer: `${setName} (${setCode}) has ${uniqueCount.toLocaleString()} unique cards across ${cardCount.toLocaleString()} tracked variants on LorcanaPrices.`,
  });

  if (market.pricedCount > 0) {
    entries.push({
      q: `What are the most valuable cards in ${setName}?`,
      a: (
        <>
          The current top of {setName} is priced live in the
          &quot;Most valuable&quot; panel on this page. Set-wide
          subtotal for priced printings is currently{' '}
          <strong>{money(market.subtotalUsd, market.currency)}</strong>.
        </>
      ),
      plainAnswer: `The current top of ${setName} is priced live in the "Most valuable" panel on the set page. Set-wide priced subtotal is currently ${money(market.subtotalUsd, market.currency)}.`,
    });
  }

  if (enchanted > 0) {
    entries.push({
      q: `Does ${setName} contain Enchanted cards?`,
      a: (
        <>
          Yes — <strong>{enchanted}</strong> Enchanted card
          {enchanted === 1 ? '' : 's'} in {setName}. See the full
          Enchanted market for network-wide ranking on the{' '}
          <a href="/market/enchanted">Enchanted page</a>.
        </>
      ),
      plainAnswer: `Yes. ${enchanted} Enchanted card${enchanted === 1 ? '' : 's'} in ${setName}. See the full Enchanted market for network-wide ranking.`,
    });
  } else {
    entries.push({
      q: `Does ${setName} contain Enchanted cards?`,
      a: (
        <>
          No — the current catalogue for {setName} has no Enchanted
          overprints. That&apos;s common for promo, D23 and specialty
          set families.
        </>
      ),
      plainAnswer: `No. The current catalogue for ${setName} has no Enchanted overprints, common for promo, D23 and specialty sets.`,
    });
  }

  entries.push({
    q: `Which rarities appear in ${setName}?`,
    a: (
      <>
        Rarity mix currently tracked in {setName}:{' '}
        {Object.entries(rarityCounts)
          .filter(([, n]) => n > 0)
          .map(([r, n]) => `${r} (${n})`)
          .join(', ')}.
      </>
    ),
    plainAnswer: `Rarity mix in ${setName}: ${Object.entries(rarityCounts).filter(([, n]) => n > 0).map(([r, n]) => `${r} (${n})`).join(', ')}.`,
  });

  entries.push({
    q: `Are cards from ${setName} available in foil and nonfoil?`,
    a: (
      <>
        Most cards in {setName} exist in both foil and nonfoil
        printings — with the exception of Enchanted (always foil) and
        the odd single-finish promo. LorcanaPrices prices every
        finish independently.
      </>
    ),
    plainAnswer: `Most cards in ${setName} exist in foil and nonfoil printings, with Enchanted (always foil) and some single-finish promos as exceptions. Every finish is priced independently.`,
  });

  entries.push({
    q: `Where can I buy sealed ${setName} products?`,
    a: (
      <>
        Sealed availability isn&apos;t tracked in our catalogue. Use the
        &quot;Find sealed {setName} on eBay&quot; button at the top of
        this page — it opens a live eBay search for sealed inventory.
      </>
    ),
    plainAnswer: `Sealed availability is not tracked in the catalogue. Use the "Find sealed on eBay" button at the top of the set page to open a live eBay search.`,
  });

  entries.push({
    q: `How can I browse every card from ${setName}?`,
    a: (
      <>
        Every card in {setName} is listed in the grid on this page.
        Filter by ink, rarity or finish using the client-side controls
        above the grid. Or use{' '}
        <a href="/card-finder">Card Finder</a> across the whole
        catalogue.
      </>
    ),
    plainAnswer: `Every card in ${setName} is listed on the set page grid. Filter by ink, rarity or finish. Or use Card Finder across the whole catalogue.`,
  });

  return entries;
}

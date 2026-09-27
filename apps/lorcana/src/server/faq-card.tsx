// Deterministic, DB-derived FAQ generator for card pages.
// Answers are computed from the card bundle only — never runtime AI.
// Every claim is checkable against the passed-in card data.

import type { FaqEntry } from '@/components/Faq';
import type { LcCardView, LcPrintingView } from './read';
import { LC_INK_LABEL } from '@/lib/lorcana/ink';

interface Args {
  name: string;
  cards: LcCardView[];        // one row per set/rarity variant of the card
  flatPrintings: Array<{ cardView: LcCardView; printingView: LcPrintingView }>;
  hero: LcCardView;
  cheapestPrice: { amount: number; currency: string } | null;
  dearestPrice: { amount: number; currency: string } | null;
}

function money(v: { amount: number; currency: string }): string {
  const spec = ({ USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB' } as Record<string, string>)[v.currency] || 'en-US';
  try {
    return v.amount.toLocaleString(spec, { style: 'currency', currency: v.currency, maximumFractionDigits: 2 });
  } catch {
    return `${v.currency} ${v.amount.toFixed(2)}`;
  }
}

function uniqTreatments(printings: Args['flatPrintings']): string[] {
  const s = new Set<string>();
  for (const p of printings) s.add(p.printingView.treatment.label);
  return [...s];
}

function hasAnyFinish(printings: Args['flatPrintings'], finish: string): boolean {
  return printings.some((p) => (p.printingView.printing.finish ?? '').toLowerCase() === finish.toLowerCase());
}

export function buildCardFaq({
  name, cards, flatPrintings, hero, cheapestPrice, dearestPrice,
}: Args): FaqEntry[] {
  const entries: FaqEntry[] = [];
  const treatments = uniqTreatments(flatPrintings);
  const setName = hero.set?.name ?? null;
  const setCode = hero.set?.code ?? null;
  const rarityLabel = hero.rarity.label;
  const inks = hero.gamedata.inks.map((c) => LC_INK_LABEL[c]).join(', ');

  if (cheapestPrice) {
    const priceStr = money(cheapestPrice);
    const bandStr = dearestPrice && dearestPrice.amount > cheapestPrice.amount
      ? ` The dearest printing currently trades around ${money(dearestPrice)}.`
      : '';
    entries.push({
      q: `How much is ${name} worth?`,
      a: (
        <>
          The cheapest priced printing of {name} is currently{' '}
          <strong>{priceStr}</strong> on the LorcanaPrices live retail
          feed (Cardmarket EU).{bandStr} Every printing is priced
          individually — see the treatment panels on this page for the
          full spread.
        </>
      ),
      plainAnswer: `The cheapest priced printing of ${name} is currently ${priceStr} on the LorcanaPrices live retail feed (Cardmarket EU).${bandStr} Every printing is priced individually.`,
    });
  } else {
    entries.push({
      q: `How much is ${name} worth?`,
      a: (
        <>
          No live retail row for {name} is available on the current
          Cardmarket feed. Check back after the next daily refresh, or
          use the &quot;Find on eBay&quot; button on this page for the
          secondary marketplace.
        </>
      ),
      plainAnswer: `No live retail row for ${name} is available on the current Cardmarket feed. Check back after the next daily refresh, or use the eBay affiliate link on the card page.`,
    });
  }

  if (setName) {
    entries.push({
      q: `What set is ${name} from?`,
      a: (
        <>
          {name} appears in <strong>{setName}</strong>
          {setCode ? ` (${setCode.toUpperCase()})` : ''}. Browse the
          full set on the{' '}
          <a href={`/set/${(setCode ?? '').toLowerCase()}`}>set page</a>.
        </>
      ),
      plainAnswer: `${name} appears in ${setName}${setCode ? ` (${setCode.toUpperCase()})` : ''}. Browse the full set on the LorcanaPrices set page.`,
    });
  }

  entries.push({
    q: `What rarity is ${name}?`,
    a: (
      <>
        The base rarity of {name} is <strong>{rarityLabel}</strong>.
        {cards.length > 1 && ' Multiple set-level variants exist across the catalogue.'}
      </>
    ),
    plainAnswer: `The base rarity of ${name} is ${rarityLabel}.${cards.length > 1 ? ' Multiple set-level variants exist.' : ''}`,
  });

  const hasFoil = hasAnyFinish(flatPrintings, 'foil');
  const hasNonfoil = hasAnyFinish(flatPrintings, 'nonfoil');
  if (hasFoil || hasNonfoil) {
    let finishText: string;
    if (hasFoil && hasNonfoil) finishText = `Both foil and nonfoil printings of ${name} exist on LorcanaPrices.`;
    else if (hasFoil) finishText = `Only foil printings of ${name} are tracked on LorcanaPrices in the current data.`;
    else finishText = `Only nonfoil printings of ${name} are tracked on LorcanaPrices in the current data.`;
    entries.push({
      q: `Is ${name} available in foil?`,
      a: <>{finishText}</>,
      plainAnswer: finishText,
    });
  }

  if (treatments.length > 0) {
    entries.push({
      q: `What printings of ${name} exist?`,
      a: (
        <>
          LorcanaPrices tracks {treatments.length} treatment{treatments.length === 1 ? '' : 's'} of {name} across the catalogue:{' '}
          <strong>{treatments.join(', ')}</strong>. Each is priced
          separately in the treatment panels on this page.
        </>
      ),
      plainAnswer: `LorcanaPrices tracks ${treatments.length} treatment${treatments.length === 1 ? '' : 's'} of ${name}: ${treatments.join(', ')}. Each is priced separately.`,
    });
  }

  if (inks) {
    entries.push({
      q: `What ink is ${name}?`,
      a: <>{name} belongs to the <strong>{inks}</strong> ink{hero.gamedata.inks.length > 1 ? 's' : ''}.</>,
      plainAnswer: `${name} belongs to the ${inks} ink${hero.gamedata.inks.length > 1 ? 's' : ''}.`,
    });
  }

  entries.push({
    q: `Where can I buy ${name}?`,
    a: (
      <>
        Use the &quot;Find {name} on eBay&quot; button at the top of the
        page — it opens a live eBay search targeted to the exact card,
        set and collector number. LorcanaPrices doesn&apos;t sell cards
        directly.
      </>
    ),
    plainAnswer: `Use the "Find on eBay" button at the top of the page — it opens a live eBay search for the exact card, set and collector number. LorcanaPrices does not sell cards directly.`,
  });

  entries.push({
    q: `Can I add ${name} to my collection?`,
    a: (
      <>
        Yes. Pick a treatment below (Common, Foil, Enchanted, …) and
        press Add to collection. You can save quantity, condition,
        raw vs graded and grader/grade for each holding.
      </>
    ),
    plainAnswer: `Yes. Pick a treatment (Common, Foil, Enchanted, ...) and press Add to collection. You can save quantity, condition, raw vs graded and grader/grade for each holding.`,
  });

  return entries;
}

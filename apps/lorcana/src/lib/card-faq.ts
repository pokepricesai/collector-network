// Deterministic, data-derived FAQ generator for Lorcana card pages.
//
// Two builders are exported:
//   * buildExactCollectibleFaq  — used on /set/[slug]/card/[cardSlug]
//   * buildLogicalCardFaq       — used on /card/[slug]
//
// Both consume already-loaded bundle data; no DB queries happen here.
// Answers are plain strings; internal links use sentinel markers of the
// form `[[/some/path|visible label]]` which the renderer linkifies.
// This keeps the FAQPage JSON-LD trivially derivable from the same
// entries array (strip sentinels for the acceptedAnswer.text).
//
// Every claim is checkable against the input bundle. We skip a question
// entirely rather than fabricate when the underlying data is missing.

import { formatPrice, CURRENCY_SOURCE_NAME, type LorcanaCurrency } from './currency';
import { LC_INK_LABEL } from './lorcana/ink';
import { slugifyCardName, buildPrintingSlug } from './lorcana/slug';
import type { LcCardView, LcPrintingView } from '@/server/read';
import type { PrintingPricing, RetailQuote } from '@collector-network/market-data';

export interface CardFaqEntry {
  q: string;
  a: string;
}

// ── Sentinel helpers ─────────────────────────────────────────────
// `[[/path|label]]` turns into <a href="/path">label</a> in the
// renderer. We also strip to plain text for the JSON-LD payload.

function link(href: string, label: string): string {
  return `[[${href}|${label}]]`;
}

/** Strip sentinel link markers to plain text. */
export function faqAnswerToPlainText(a: string): string {
  return a.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
}

// ── Shared bits ──────────────────────────────────────────────────

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / 86_400_000);
}

function freshnessLabel(iso: string | null | undefined): string {
  const d = daysAgo(iso);
  if (d == null) return '';
  if (d <= 0) return 'updated today';
  if (d === 1) return 'updated 1 day ago';
  if (d <= 30) return `updated ${d} days ago`;
  return `updated ${Math.round(d / 7)} weeks ago`;
}

/** Pick the preferred retail quote for the given currency (native source only). */
function pickNativeRetail(
  pricing: PrintingPricing | undefined | null,
  currency: LorcanaCurrency,
): RetailQuote | null {
  if (!pricing) return null;
  // USD → TCGPlayer; EUR → Cardmarket. Never falls back to the other.
  const sourceKey = currency === 'USD' ? 'tcggraph.tcgplayer' : 'tcggraph.cardmarket';
  const scoped = pricing.market.filter(
    (q) => q.currency === currency && q.source === sourceKey && q.price != null,
  );
  if (scoped.length === 0) return null;
  // Prefer the cheapest meaningful quote so the headline matches the
  // treatment panel preference.
  return scoped.reduce<RetailQuote | null>((best, cur) => {
    if (!best) return cur;
    if ((cur.price ?? Infinity) < (best.price ?? Infinity)) return cur;
    return best;
  }, null);
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function joinList(xs: readonly string[]): string {
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0]!;
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function setLinkLabel(cv: LcCardView): string {
  const code = (cv.set?.code ?? '').toUpperCase();
  const name = cv.set?.name ?? code;
  return name ? name : code;
}

function characterBaseName(cardName: string): string {
  const idx = cardName.indexOf(' - ');
  return idx > 0 ? cardName.slice(0, idx).trim() : cardName.trim();
}

// ── Exact collectible page ───────────────────────────────────────

export interface ExactFaqInput {
  cardName: string;
  anchorCard: LcCardView;
  anchorPrinting: LcPrintingView | null;
  // Any other collectible with the same base name (card_id != anchor).
  // Keep the server page's existing split: same-set and other-set.
  siblingSameSet: LcCardView[];
  siblingOtherSets: LcCardView[];
  // Graded rows attributable to this card family (card-scoped are OK;
  // we always label them as card-attributed in the answer).
  gradedRowCount: number;
  // Full card bundle — used only for the siblings question's sibling
  // count. No extra DB.
  currency: LorcanaCurrency;
}

export function buildExactCollectibleFaq(input: ExactFaqInput): CardFaqEntry[] {
  const {
    cardName,
    anchorCard,
    anchorPrinting,
    siblingSameSet,
    siblingOtherSets,
    gradedRowCount,
    currency,
  } = input;
  const entries: CardFaqEntry[] = [];
  const cn = anchorCard.card.collector_number ?? null;
  const setName = anchorCard.set?.name ?? null;
  const setCode = anchorCard.set?.code ?? null;
  const sourceName = CURRENCY_SOURCE_NAME[currency];

  // 1. Price question.
  const retail = pickNativeRetail(anchorPrinting?.pricing, currency);
  const titleTail = cn ? ` #${cn}` : '';
  if (retail && retail.price != null) {
    const priceStr = formatPrice(retail.price, currency);
    const freshness = freshnessLabel(retail.updatedAt);
    const freshnessPart = freshness ? ` (${freshness})` : '';
    const finishStr = retail.finish ? ` ${retail.finish}` : '';
    entries.push({
      q: `How much is ${cardName}${titleTail} worth?`,
      a: `${cardName}${titleTail} is currently listed at ${priceStr} on ${sourceName}${finishStr}${freshnessPart}. This is the live retail quote for the exact collectible on this page, in your selected currency (${currency}).`,
    });
  } else {
    entries.push({
      q: `How much is ${cardName}${titleTail} worth?`,
      a: `No live ${sourceName} (${currency}) retail quote is tracked for this exact ${cardName}${titleTail} printing yet. Check the eBay link below for an active-listing cross-check, or come back after the next daily refresh.`,
    });
  }

  // 2. Set question.
  if (setName && setCode) {
    const released = anchorCard.set?.released_at;
    const releasedPart = released ? `, released ${released.slice(0, 10)}` : '';
    entries.push({
      q: `What set is ${cardName} from?`,
      a: `${cardName} is from ${setName}${releasedPart}. Browse the full set on the ${link(`/set/${setCode.toLowerCase()}`, `${setName} set page`)}.`,
    });
  }

  // 3. Rarity.
  if (anchorCard.rarity.code !== 'UNKNOWN') {
    entries.push({
      q: `What rarity is ${cardName}?`,
      a: `${cardName}${titleTail} is a ${anchorCard.rarity.label} rarity card.`,
    });
  }

  // 4. Ink.
  if (anchorCard.gamedata.inks.length > 0) {
    const inkLabels = anchorCard.gamedata.inks.map((i) => LC_INK_LABEL[i]);
    const isDual = inkLabels.length > 1;
    entries.push({
      q: `What ink is ${cardName}?`,
      a: isDual
        ? `${cardName} is a dual-ink card: ${joinList(inkLabels)}.`
        : `${cardName} is an ${inkLabels[0]} card.`,
    });
  }

  // 5. Foil vs nonfoil — only when the anchor printing has a meaningful finish.
  const finish = (anchorPrinting?.printing.finish ?? '').toLowerCase();
  if (finish === 'foil') {
    entries.push({
      q: `Is this ${cardName} foil or nonfoil?`,
      a: `This exact ${cardName}${titleTail} printing is foil. Lorcana's cold-foil treatment on the full card face.`,
    });
  }

  // 6. Version / treatment question — only when the chase rarity makes it meaningful.
  const chaseLabels: Record<string, string> = {
    EN: 'Enchanted',
    IC: 'Iconic',
    EP: 'Epic',
    L: 'Legendary',
    P: 'Promo',
  };
  const chaseLabel = chaseLabels[anchorCard.rarity.code];
  if (chaseLabel) {
    const subtitle = anchorCard.gamedata.version ? ` (${anchorCard.gamedata.version})` : '';
    entries.push({
      q: `What version of ${cardName} is this?`,
      a: `This is the ${chaseLabel} version of ${cardName}${subtitle}, a collector-chase overprint distinct from the base-rarity printing.`,
    });
  }

  // 7. Graded prices.
  if (gradedRowCount > 0) {
    entries.push({
      q: `Are there graded prices for ${cardName}?`,
      a: `Yes. LorcanaPrices tracks ${gradedRowCount} graded observation${gradedRowCount === 1 ? '' : 's'} attributed to ${cardName} (card-level attribution, not pinned to this exact printing). See the graded panel above for grader, grade and current prices.`,
    });
  }

  // 8. Other versions / siblings.
  const siblingCount = siblingSameSet.length + siblingOtherSets.length;
  if (siblingCount > 0) {
    const nameSlug = slugifyCardName(cardName);
    const bits: string[] = [];
    if (siblingSameSet.length > 0 && setCode) {
      bits.push(
        `${siblingSameSet.length} other collectible${siblingSameSet.length === 1 ? '' : 's'} in ${setCode.toUpperCase()}`,
      );
    }
    if (siblingOtherSets.length > 0) {
      bits.push(
        `${siblingOtherSets.length} version${siblingOtherSets.length === 1 ? '' : 's'} in other sets`,
      );
    }
    entries.push({
      q: `What other versions of ${cardName} exist?`,
      a: `There ${siblingCount === 1 ? 'is' : 'are'} ${joinList(bits)}. See every treatment, finish and rarity on the ${link(`/card/${nameSlug}`, `${cardName} card page`)}.`,
    });
  }

  // 9. Where to buy.
  entries.push({
    q: `Where can I buy ${cardName}?`,
    a: `${cardName} is sold on TCGPlayer (USD), Cardmarket (EUR) and eBay. The "Find on eBay" button on this page opens a targeted search for this exact collectible. TCGPlayer, Cardmarket and eBay links on LorcanaPrices are affiliate links, we may earn a commission at no cost to you.`,
  });

  // 10. Character identity (characters only).
  const isCharacter = anchorCard.gamedata.cardType === 'character';
  if (isCharacter) {
    const base = characterBaseName(cardName);
    const charSlug = slugifyCardName(base);
    if (charSlug) {
      entries.push({
        q: `Which Disney character does this card feature?`,
        a: `This card features ${base}. See every ${base} card in Lorcana on the ${link(`/character/${charSlug}`, `${base} character page`)}.`,
      });
    }
  }

  // 11. Other cards featuring this character.
  if (isCharacter) {
    const base = characterBaseName(cardName);
    const charSlug = slugifyCardName(base);
    if (charSlug) {
      entries.push({
        q: `What other Lorcana cards feature ${characterBaseName(cardName)}?`,
        a: `Every Lorcana card featuring ${base} is listed on the ${link(`/character/${charSlug}`, `${base} character page`)}, grouped by card version with live prices for each.`,
      });
    }
  }

  // 12. Cards in the same set.
  if (setCode) {
    entries.push({
      q: `What cards are in the same set?`,
      a: `Browse every card in ${setName ?? setCode.toUpperCase()} on the ${link(`/set/${setCode.toLowerCase()}`, 'set page')}, or filter the catalogue by set on the ${link(`/card-finder?setCode=${setCode.toUpperCase()}`, 'Card Finder')}.`,
    });
  }

  return entries;
}

// ── Logical card page ────────────────────────────────────────────

export interface LogicalFaqInput {
  cardName: string;
  cards: LcCardView[];
  flatPrintings: Array<{ cardView: LcCardView; printingView: LcPrintingView }>;
  hero: LcCardView;
  gradedRowCount: number;
  currency: LorcanaCurrency;
}

interface PricedVersion {
  cardView: LcCardView;
  printingView: LcPrintingView;
  price: number;
}

export function buildLogicalCardFaq(input: LogicalFaqInput): CardFaqEntry[] {
  const { cardName, cards, flatPrintings, hero, gradedRowCount, currency } = input;
  const entries: CardFaqEntry[] = [];
  const sourceName = CURRENCY_SOURCE_NAME[currency];

  // 1. How many versions exist (count of distinct tcg_cards rows).
  const versionCount = cards.length;
  entries.push({
    q: `How many versions of ${cardName} exist in Lorcana?`,
    a: versionCount === 1
      ? `${cardName} has 1 version tracked in Lorcana so far.`
      : `${cardName} has ${versionCount} distinct versions tracked across the Lorcana catalogue, different sets, rarities or treatments, each priced individually.`,
  });

  // 2. Which sets contain this card.
  const setMap = new Map<string, { code: string; name: string }>();
  for (const c of cards) {
    const code = c.set?.code;
    if (!code) continue;
    if (!setMap.has(code)) {
      setMap.set(code, { code, name: c.set?.name ?? code.toUpperCase() });
    }
  }
  const setList = Array.from(setMap.values());
  if (setList.length > 0) {
    const linkStrs = setList.map((s) => link(`/set/${s.code.toLowerCase()}`, s.name));
    entries.push({
      q: `Which sets contain ${cardName}?`,
      a: `${cardName} is printed in ${joinList(linkStrs)}.`,
    });
  }

  // 3. Inks.
  const inkSet = new Set<string>();
  for (const c of cards) for (const i of c.gamedata.inks) inkSet.add(LC_INK_LABEL[i]);
  if (inkSet.size > 0) {
    const inkList = Array.from(inkSet);
    entries.push({
      q: `What inks does ${cardName} have?`,
      a: inkList.length === 1
        ? `Every tracked version of ${cardName} is ${inkList[0]} ink.`
        : `${cardName} appears across ${joinList(inkList)} ink${inkList.length === 1 ? '' : 's'}.`,
    });
  }

  // 4. Rarities / treatments across versions.
  const rarityLabels = dedupe(
    cards
      .map((c) => c.rarity.label)
      .filter((l) => l && l !== 'Unknown'),
  );
  const treatmentLabels = dedupe(
    flatPrintings.map(({ printingView }) => printingView.treatment.label),
  );
  if (rarityLabels.length > 0 || treatmentLabels.length > 0) {
    const parts: string[] = [];
    if (rarityLabels.length > 0) {
      parts.push(`rarit${rarityLabels.length === 1 ? 'y' : 'ies'} ${joinList(rarityLabels)}`);
    }
    if (treatmentLabels.length > 0) {
      parts.push(`treatment${treatmentLabels.length === 1 ? '' : 's'} ${joinList(treatmentLabels)}`);
    }
    entries.push({
      q: `What rarities and treatments does ${cardName} have?`,
      a: `${cardName} spans ${joinList(parts)}. Every combination is priced on its own row on this page.`,
    });
  }

  // 5. Most valuable version (max retail across the bundle, in current currency).
  const priced: PricedVersion[] = [];
  for (const entry of flatPrintings) {
    const retail = pickNativeRetail(entry.printingView.pricing, currency);
    if (retail && retail.price != null) {
      priced.push({ cardView: entry.cardView, printingView: entry.printingView, price: retail.price });
    }
  }
  if (priced.length > 0) {
    priced.sort((a, b) => b.price - a.price);
    const top = priced[0]!;
    const nextTop = priced[1];
    const clearWinner = !nextTop || top.price > nextTop.price * 1.05;
    if (clearWinner) {
      const topCn = top.cardView.card.collector_number;
      const topSet = top.cardView.set?.code?.toUpperCase() ?? '';
      const treatmentLabel = top.printingView.treatment.label;
      const priceStr = formatPrice(top.price, currency);
      const setCodeLower = (top.cardView.set?.code ?? '').toLowerCase();
      const printSlug = buildPrintingSlug(top.cardView.card.collector_number, cardName);
      const linkStr = setCodeLower
        ? ` ${link(`/set/${setCodeLower}/card/${printSlug}`, 'View this version')}.`
        : '';
      entries.push({
        q: `Which ${cardName} version is currently most valuable?`,
        a: `The ${treatmentLabel} version from ${topSet}${topCn ? ` (#${topCn})` : ''} currently leads the ${cardName} market at ${priceStr} on ${sourceName}.${linkStr}`,
      });
    }
  }

  // 6. Graded prices (card-attributed).
  if (gradedRowCount > 0) {
    entries.push({
      q: `Are there graded ${cardName} prices?`,
      a: `Yes. LorcanaPrices tracks ${gradedRowCount} card-family graded observation${gradedRowCount === 1 ? '' : 's'} for ${cardName}. These are card-attributed quotes, a graded ${cardName} without pinning to a specific exact printing. Open an exact version below to see printing-specific graded panels where available.`,
    });
  }

  // 7. Exact-version direct links (cap at 6).
  const uniqueByCardId = Array.from(
    new Map(cards.map((c) => [c.card.id, c])).values(),
  );
  const versionLinks: string[] = [];
  for (const c of uniqueByCardId) {
    const setCode = c.set?.code;
    if (!setCode) continue;
    const printSlug = buildPrintingSlug(c.card.collector_number, cardName);
    const label = `${setCode.toUpperCase()}${c.card.collector_number ? ` #${c.card.collector_number}` : ''} · ${c.rarity.label}`;
    versionLinks.push(link(`/set/${setCode.toLowerCase()}/card/${printSlug}`, label));
    if (versionLinks.length >= 6) break;
  }
  if (versionLinks.length > 0) {
    entries.push({
      q: `Where can I view exact versions of ${cardName}?`,
      a: `${joinList(versionLinks)}.`,
    });
  }

  // 8. Character identity.
  const isCharacter = hero.gamedata.cardType === 'character';
  if (isCharacter) {
    const base = characterBaseName(cardName);
    const charSlug = slugifyCardName(base);
    if (charSlug) {
      entries.push({
        q: `Which Disney character is ${cardName}?`,
        a: `${cardName} features the Disney character ${base}. See every ${base} card on the ${link(`/character/${charSlug}`, `${base} character page`)}.`,
      });
    }
  }

  // 9. Where to buy.
  entries.push({
    q: `Where can I buy ${cardName}?`,
    a: `${cardName} is sold on TCGPlayer (USD), Cardmarket (EUR) and eBay. Each exact version below carries a "Find on eBay" link that opens a targeted search for that specific printing. TCGPlayer, Cardmarket and eBay links on LorcanaPrices are affiliate links, we may earn a commission at no cost to you.`,
  });

  return entries;
}

// ── JSON-LD + renderer bridge ────────────────────────────────────

/** Build the FAQPage JSON-LD payload from a card-faq entries array. */
export function buildCardFaqJsonLd(entries: readonly CardFaqEntry[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faqAnswerToPlainText(e.a),
      },
    })),
  };
}

// Deterministic smart-query parser for the Card Finder.
//
// Takes a raw user query like "LIGHT Dragon Level 4 1800+" and
// translates it into structured filter parameters. Pure function,
// zero side effects, unit-tested. Never invents card data — if a
// token isn't recognised, it becomes part of the name/text query.
//
// Deliberately conservative: parses common Yu-Gi-Oh vocabulary
// (attributes, frame types, monster types, level/rank/link,
// ATK ranges, F&L status, price bands) and leaves everything else
// as a free-text name search. No LLM in this layer.

import type { FinderFilters } from './finder-filters';
import { EMPTY_FILTERS } from './finder-filters';

// Canonical Yu-Gi-Oh vocabulary. Kept here (not shared with the
// design tokens file) because these represent the DB values as they
// appear in production JSONB, not display labels.
const ATTRIBUTES = ['LIGHT', 'DARK', 'FIRE', 'WATER', 'WIND', 'EARTH', 'DIVINE'] as const;

const FRAME_TYPES: Record<string, string> = {
  normal: 'normal',
  effect: 'effect',
  fusion: 'fusion',
  synchro: 'synchro',
  xyz: 'xyz',
  pendulum: 'pendulum',
  link: 'link',
  ritual: 'ritual',
  spell: 'spell',
  trap: 'trap',
};

// Non-exhaustive but covers most common terms collectors type.
// Race/type values in the DB use "Title Case" strings — Dragon,
// Warrior, Spellcaster, etc. We match lowercased.
const MONSTER_TYPES = [
  'dragon',
  'spellcaster',
  'warrior',
  'beast',
  'beast-warrior',
  'winged beast',
  'zombie',
  'fiend',
  'fairy',
  'machine',
  'aqua',
  'pyro',
  'thunder',
  'rock',
  'plant',
  'insect',
  'fish',
  'sea serpent',
  'reptile',
  'psychic',
  'dinosaur',
  'wyrm',
  'cyberse',
  'divine-beast',
] as const;

const BANLIST_ALIASES: Record<string, FinderFilters['banlistTcg']> = {
  forbidden: 'forbidden',
  banned: 'forbidden',
  limited: 'limited',
  'semi-limited': 'semi_limited',
  'semi limited': 'semi_limited',
  'semi_limited': 'semi_limited',
  unlimited: 'unlimited',
};

// Regex helpers.
const RE_ATK_MIN = /(?:atk\s*[>=]{1,2}\s*|atk\s+at\s+least\s+|atk\s+over\s+)(\d+)/i;
const RE_ATK_MAX = /atk\s*<=?\s*(\d+)/i;
const RE_ATK_PLAIN_MIN = /(\d{3,5})\s*\+\s*atk/i;
const RE_LEVEL = /(?:level|lv\.?)\s*(\d+)/i;
const RE_RANK = /rank\s*(\d+)/i;
const RE_LINK = /link[- ]?(\d+)|link\s+rating\s*(\d+)/i;
const RE_PRICE_UNDER = /(?:under|below|less than|<)\s*\$?(\d+(?:\.\d+)?)/i;
const RE_PRICE_OVER = /(?:over|above|more than|>)\s*\$?(\d+(?:\.\d+)?)/i;

export function parseFinderQuery(raw: string): FinderFilters {
  const filters: FinderFilters = { ...EMPTY_FILTERS };
  let remaining = ` ${raw.trim()} `;

  // Cheap: chip out numeric range hints first so they don't get
  // confused with archetype fragments.
  const atkMin = remaining.match(RE_ATK_MIN)?.[1] ?? remaining.match(RE_ATK_PLAIN_MIN)?.[1];
  if (atkMin) {
    filters.atkMin = Number(atkMin);
    remaining = remaining.replace(RE_ATK_MIN, ' ').replace(RE_ATK_PLAIN_MIN, ' ');
  }
  const atkMax = remaining.match(RE_ATK_MAX)?.[1];
  if (atkMax) {
    filters.atkMax = Number(atkMax);
    remaining = remaining.replace(RE_ATK_MAX, ' ');
  }
  const levelMatch = remaining.match(RE_LEVEL);
  if (levelMatch?.[1]) {
    filters.level = Number(levelMatch[1]);
    remaining = remaining.replace(RE_LEVEL, ' ');
  }
  const rankMatch = remaining.match(RE_RANK);
  if (rankMatch?.[1]) {
    filters.rank = Number(rankMatch[1]);
    remaining = remaining.replace(RE_RANK, ' ');
  }
  const linkMatch = remaining.match(RE_LINK);
  if (linkMatch) {
    filters.linkRating = Number(linkMatch[1] ?? linkMatch[2]);
    // A "Link-N" or "link rating N" phrasing implies the card is a
    // Link monster; set the frame type so the finder can push both
    // filters to the DB even though the word "link" got consumed.
    filters.frameType = 'link';
    remaining = remaining.replace(RE_LINK, ' ');
  }
  const priceUnder = remaining.match(RE_PRICE_UNDER)?.[1];
  if (priceUnder) {
    filters.priceMax = Number(priceUnder);
    remaining = remaining.replace(RE_PRICE_UNDER, ' ');
  }
  const priceOver = remaining.match(RE_PRICE_OVER)?.[1];
  if (priceOver) {
    filters.priceMin = Number(priceOver);
    remaining = remaining.replace(RE_PRICE_OVER, ' ');
  }

  // Attribute (LIGHT / DARK / FIRE / WATER / WIND / EARTH / DIVINE).
  // Case-insensitive whole-word match.
  for (const attr of ATTRIBUTES) {
    const re = new RegExp(`\\b${attr}\\b`, 'i');
    if (re.test(remaining)) {
      filters.attribute = attr;
      remaining = remaining.replace(re, ' ');
      break;
    }
  }

  // F&L keywords first — they trump generic "limited edition" etc.
  const lowerRemain = remaining.toLowerCase();
  for (const [alias, canonical] of Object.entries(BANLIST_ALIASES)) {
    const re = new RegExp(`\\b${alias.replace(/[-\s_]/g, '[-\\s_]')}\\b`, 'i');
    if (re.test(lowerRemain)) {
      if (canonical !== 'unlimited') filters.banlistTcg = canonical;
      remaining = remaining.replace(re, ' ');
      break;
    }
  }

  // Frame type — check most specific first (fusion beats effect for
  // "fusion monster").
  const frameOrder = [
    'ritual',
    'fusion',
    'synchro',
    'xyz',
    'pendulum',
    'link',
    'normal',
    'effect',
    'trap',
    'spell',
  ];
  for (const key of frameOrder) {
    if (!FRAME_TYPES[key]) continue;
    const re = new RegExp(`\\b${key}\\b`, 'i');
    if (re.test(remaining)) {
      filters.frameType = FRAME_TYPES[key];
      remaining = remaining.replace(re, ' ');
      // Consume the trailing "monster/monsters/card/cards" noise so
      // it doesn't become part of the name query.
      remaining = remaining.replace(/\b(monsters?|cards?)\b/gi, ' ');
      break;
    }
  }

  // Monster type — try multi-word matches before single-word to
  // catch "beast-warrior" / "sea serpent" / etc. Optional trailing
  // 's' accepts the common plural form ("Dragons", "Spellcasters").
  const typesByLen = [...MONSTER_TYPES].sort((a, b) => b.length - a.length);
  for (const t of typesByLen) {
    const re = new RegExp(`\\b${t.replace(/[-\s]/g, '[-\\s]')}s?\\b`, 'i');
    if (re.test(remaining)) {
      filters.race = toTitleCase(t);
      remaining = remaining.replace(re, ' ');
      break;
    }
  }

  // Whatever remains is treated as a free-text name/effect search.
  // Discard stopwords + collapse whitespace so "cards from" style
  // padding doesn't leak into the SQL ILIKE pattern.
  const cleaned = remaining
    .toLowerCase()
    .replace(/\bcards?\b/g, ' ')
    .replace(/\bmonsters?\b/g, ' ')
    .replace(/\bsupport\b/g, ' ')
    .replace(/\bcheap\b/g, ' ')
    .replace(/\bexpensive\b/g, ' ')
    .replace(/\bfrom\b/g, ' ')
    .replace(/\bwith\b/g, ' ')
    .replace(/\bover\b/g, ' ')
    .replace(/\bunder\b/g, ' ')
    .replace(/\brare\b/g, ' ')
    .replace(/\brares?\b/g, ' ')
    .replace(/[+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned) filters.q = cleaned;

  // "cheap" hint alone means bias sort to price ascending when no
  // explicit sort was provided. Caller applies it via defaultSort().
  if (/\bcheap\b/i.test(raw)) filters.priceBiasCheap = true;
  if (/\bexpensive\b/i.test(raw)) filters.priceBiasExpensive = true;

  return filters;
}

function toTitleCase(s: string): string {
  return s
    .split(/([-\s])/g)
    .map((tok) =>
      /^[-\s]+$/.test(tok) ? tok : tok.charAt(0).toUpperCase() + tok.slice(1),
    )
    .join('');
}

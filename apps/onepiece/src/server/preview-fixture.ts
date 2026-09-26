import 'server-only';

// Preview fixture — a tiny, curated snapshot of the shared tcg_* schema
// scoped to One Piece. Only ever served by the stub Supabase client
// when SUPABASE_URL is absent (local dev + first-look Vercel previews).
// Production has real env vars, so the stub — and this fixture — never
// run there.
//
// Shape rules — verified against production 2026-09-26 in
// docs/onepiece/data-audit.md:
//   * game_id is the literal string "onepiece"
//   * tcg_cards.id shape: `onepiece:card:op_{set}_{cn}[_pN|_rN]`
//   * tcg_printings.id shape: `onepiece:print:op_{set}_{cn}:{key}:{lang}`
//   * tcg_printings.edition is always null
//   * tcg_printings.finish is 'nonfoil' or 'foil'
//   * language is 'en'
//   * Treatments live in collector_number suffixes (`_p1`/`_p2`/`_p3`,
//     `_r1`) — not in edition or finish.
//
// The fixture keeps 5 sets, ~10 cards, ~20 printings so the site's every
// section has something to render.

const OP_GAME_ID = 'onepiece';

const SETS = [
  {
    id: 'onepiece:set:op01',
    game_id: OP_GAME_ID,
    code: 'op01',
    name: 'Romance Dawn',
    released_at: '2024-07-25',
    tcggraph_meta: null,
    created_at: '2024-06-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'onepiece:set:op02',
    game_id: OP_GAME_ID,
    code: 'op02',
    name: 'Paramount War',
    released_at: '2024-11-08',
    tcggraph_meta: null,
    created_at: '2024-09-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'onepiece:set:op03',
    game_id: OP_GAME_ID,
    code: 'op03',
    name: 'Pillars of Strength',
    released_at: '2025-02-26',
    tcggraph_meta: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'onepiece:set:eb02',
    game_id: OP_GAME_ID,
    code: 'eb02',
    name: 'Anime 25th Collection',
    released_at: '2025-06-20',
    tcggraph_meta: null,
    created_at: '2025-05-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'onepiece:set:op05',
    game_id: OP_GAME_ID,
    code: 'op05',
    name: 'Awakening of the New Era',
    released_at: '2025-08-22',
    tcggraph_meta: null,
    created_at: '2025-07-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
];

// One card row per (set × collector_number × rarity). Treatment variants
// use the `_p#` / `_r#` suffix on collector_number — matches production
// shape exactly.
const CARDS = [
  // Monkey D. Luffy — Leader with three parallels
  {
    id: 'onepiece:card:op_eb02_010',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Monkey.D.Luffy',
    english_id: 'EB02-010',
    language: 'en',
    rarity: 'L',
    artist: 'Eiichiro Oda',
    rules_text:
      "[Activate: Main] [Once Per Turn] Give up to 1 of your Characters +1000 power during this turn.",
    images: null,
    gamedata: {
      cardType: 'LEADER',
      colors: ['Red'],
      life: 5,
      power: 5000,
      attribute: 'Strike',
      types: ['Straw Hat Crew', 'Supernovas'],
      counter: null,
      trigger: null,
      cost: null,
    },
    set_id: 'onepiece:set:eb02',
    collector_number: 'EB02-010',
    created_at: '2025-05-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  },
  {
    id: 'onepiece:card:op_eb02_010_p1',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Monkey.D.Luffy',
    english_id: 'EB02-010_p1',
    language: 'en',
    rarity: 'L',
    artist: 'Studio Straw Hat',
    rules_text:
      "[Activate: Main] [Once Per Turn] Give up to 1 of your Characters +1000 power during this turn.",
    images: null,
    gamedata: {
      cardType: 'LEADER', colors: ['Red'], life: 5, power: 5000,
      attribute: 'Strike', types: ['Straw Hat Crew', 'Supernovas'],
      counter: null, trigger: null, cost: null,
    },
    set_id: 'onepiece:set:eb02',
    collector_number: 'EB02-010_p1',
    created_at: '2025-05-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  },
  {
    id: 'onepiece:card:op_eb02_010_p2',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Monkey.D.Luffy',
    english_id: 'EB02-010_p2',
    language: 'en',
    rarity: 'L',
    artist: 'Studio Straw Hat',
    rules_text:
      "[Activate: Main] [Once Per Turn] Give up to 1 of your Characters +1000 power during this turn.",
    images: null,
    gamedata: {
      cardType: 'LEADER', colors: ['Red'], life: 5, power: 5000,
      attribute: 'Strike', types: ['Straw Hat Crew', 'Supernovas'],
      counter: null, trigger: null, cost: null,
    },
    set_id: 'onepiece:set:eb02',
    collector_number: 'EB02-010_p2',
    created_at: '2025-05-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  },
  {
    id: 'onepiece:card:op_eb02_010_p3',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Monkey.D.Luffy',
    english_id: 'EB02-010_p3',
    language: 'en',
    rarity: 'L',
    artist: 'Studio Straw Hat',
    rules_text:
      "[Activate: Main] [Once Per Turn] Give up to 1 of your Characters +1000 power during this turn.",
    images: null,
    gamedata: {
      cardType: 'LEADER', colors: ['Red'], life: 5, power: 5000,
      attribute: 'Strike', types: ['Straw Hat Crew', 'Supernovas'],
      counter: null, trigger: null, cost: null,
    },
    set_id: 'onepiece:set:eb02',
    collector_number: 'EB02-010_p3',
    created_at: '2025-05-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  },

  // Edward Weevil — Character SP CARD + Rare
  {
    id: 'onepiece:card:op_eb01_023_p1',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Edward Weevil',
    english_id: 'EB01-023_p1',
    language: 'en',
    rarity: 'SP CARD',
    artist: 'Studio Warlords',
    rules_text: '[On Play] Draw 1 card.',
    images: null,
    gamedata: {
      cardType: 'CHARACTER', colors: ['Blue'], cost: 4, power: 8000,
      counter: 1000, attribute: 'Slash',
      types: ['The Seven Warlords of the Sea'],
      trigger: null, life: null,
    },
    set_id: 'onepiece:set:op02',
    collector_number: 'EB01-023_p1',
    created_at: '2024-09-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'onepiece:card:op_eb01_023_p2',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Edward Weevil',
    english_id: 'EB01-023_p2',
    language: 'en',
    rarity: 'R',
    artist: 'Studio Warlords',
    rules_text: '[On Play] Draw 1 card.',
    images: null,
    gamedata: {
      cardType: 'CHARACTER', colors: ['Blue'], cost: 4, power: 6000,
      counter: null, attribute: 'Slash',
      types: ['The Seven Warlords of the Sea'],
      trigger: null, life: null,
    },
    set_id: 'onepiece:set:op02',
    collector_number: 'EB01-023_p2',
    created_at: '2024-09-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },

  // Warlord chase — SEC base + reprint + parallels
  {
    id: 'onepiece:card:op_eb02_061',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Boa Hancock',
    english_id: 'EB02-061',
    language: 'en',
    rarity: 'SEC',
    artist: 'Eiichiro Oda',
    rules_text:
      '[Trigger] Look at 5 cards from the top of your deck; reveal up to 1 Character card of your colour and add it to your hand.',
    images: null,
    gamedata: {
      cardType: 'CHARACTER', colors: ['Purple'], cost: 8, power: 9000,
      counter: null, attribute: 'Wisdom',
      types: ['The Seven Warlords of the Sea', 'Kuja Pirates'],
      trigger: 'Yes', life: null,
    },
    set_id: 'onepiece:set:eb02',
    collector_number: 'EB02-061',
    created_at: '2025-05-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  },
  {
    id: 'onepiece:card:op_eb02_061_r1',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Boa Hancock',
    english_id: 'EB02-061_r1',
    language: 'en',
    rarity: 'SEC',
    artist: 'Eiichiro Oda',
    rules_text:
      '[Trigger] Look at 5 cards from the top of your deck; reveal up to 1 Character card of your colour and add it to your hand.',
    images: null,
    gamedata: {
      cardType: 'CHARACTER', colors: ['Purple'], cost: 8, power: 9000,
      counter: null, attribute: 'Wisdom',
      types: ['The Seven Warlords of the Sea', 'Kuja Pirates'],
      trigger: 'Yes', life: null,
    },
    set_id: 'onepiece:set:eb02',
    collector_number: 'EB02-061_r1',
    created_at: '2025-05-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  },
  {
    id: 'onepiece:card:op_eb02_061_p3',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Boa Hancock',
    english_id: 'EB02-061_p3',
    language: 'en',
    rarity: 'SP CARD',
    artist: 'Studio Kuja',
    rules_text:
      '[Trigger] Look at 5 cards from the top of your deck; reveal up to 1 Character card of your colour and add it to your hand.',
    images: null,
    gamedata: {
      cardType: 'CHARACTER', colors: ['Purple'], cost: 8, power: 9000,
      counter: null, attribute: 'Wisdom',
      types: ['The Seven Warlords of the Sea', 'Kuja Pirates'],
      trigger: 'Yes', life: null,
    },
    set_id: 'onepiece:set:eb02',
    collector_number: 'EB02-061_p3',
    created_at: '2025-05-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  },

  // Treasure Rare — very limited chase
  {
    id: 'onepiece:card:op_op05_119',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Charlotte Katakuri',
    english_id: 'OP05-119',
    language: 'en',
    rarity: 'TR',
    artist: 'Eiichiro Oda',
    rules_text:
      '[Activate: Main] [Once Per Turn] K.O. up to 1 of your opponent’s Characters with a power of 4000 or less.',
    images: null,
    gamedata: {
      cardType: 'CHARACTER', colors: ['Purple'], cost: 8, power: 10000,
      counter: 1000, attribute: 'Special',
      types: ['Big Mom Pirates', 'Charlotte Family'],
      trigger: null, life: null,
    },
    set_id: 'onepiece:set:op05',
    collector_number: 'OP05-119',
    created_at: '2025-07-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  },

  // Promo
  {
    id: 'onepiece:card:op_p_001',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Roronoa Zoro',
    english_id: 'P-001',
    language: 'en',
    rarity: 'P',
    artist: 'Eiichiro Oda',
    rules_text: '[When Attacking] Give up to 1 of your Characters +1000 power during this turn.',
    images: null,
    gamedata: {
      cardType: 'CHARACTER', colors: ['Green'], cost: 4, power: 5000,
      counter: 1000, attribute: 'Slash',
      types: ['Straw Hat Crew'],
      trigger: null, life: null,
    },
    set_id: 'onepiece:set:op03',
    collector_number: 'P-001',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },

  // Standard character
  {
    id: 'onepiece:card:op_op02_042',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Nami',
    english_id: 'OP02-042',
    language: 'en',
    rarity: 'R',
    artist: 'Eiichiro Oda',
    rules_text: '[On Play] Look at 5 cards from the top of your deck and rearrange them in any order.',
    images: null,
    gamedata: {
      cardType: 'CHARACTER', colors: ['Blue'], cost: 3, power: 4000,
      counter: 1000, attribute: 'Special',
      types: ['Straw Hat Crew'],
      trigger: null, life: null,
    },
    set_id: 'onepiece:set:op02',
    collector_number: 'OP02-042',
    created_at: '2024-09-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },

  // Standard leader — Zoro
  {
    id: 'onepiece:card:op_op01_002',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Roronoa Zoro',
    english_id: 'OP01-002',
    language: 'en',
    rarity: 'L',
    artist: 'Eiichiro Oda',
    rules_text: '[Activate: Main] [Once Per Turn] Give up to 1 of your Characters +1000 power during this turn.',
    images: null,
    gamedata: {
      cardType: 'LEADER', colors: ['Green'], life: 5, power: 5000,
      attribute: 'Slash', types: ['Straw Hat Crew'],
      counter: null, trigger: null, cost: null,
    },
    set_id: 'onepiece:set:op01',
    collector_number: 'OP01-002',
    created_at: '2024-06-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
];

// Printings — each card exists as nonfoil (key='normal') and, for chase
// treatments, foil (key='foil') too. Matches production reality.
interface FixturePrinting {
  id: string;
  game_id: string;
  tcg_card_id: string;
  set_id: string;
  tcggraph_card_id: null;
  tcggraph_printing_key: string;
  finish: string;
  edition: null;
  language: string;
  collector_number: string | null;
  mtg_printings_id: null;
  cardmarket_id: null;
  tcgplayer_id: null;
  mapping_confidence: null;
  created_at: string;
  updated_at: string;
}

function printingsFor(card: (typeof CARDS)[number], keys: Array<'normal' | 'foil'>): FixturePrinting[] {
  return keys.map((key) => ({
    id: `onepiece:print:${card.id.replace('onepiece:card:', '')}:${key}:en`,
    game_id: OP_GAME_ID,
    tcg_card_id: card.id,
    set_id: card.set_id,
    tcggraph_card_id: null,
    tcggraph_printing_key: key,
    finish: key === 'foil' ? 'foil' : 'nonfoil',
    edition: null,
    language: 'en',
    collector_number: card.collector_number,
    mtg_printings_id: null,
    cardmarket_id: null,
    tcgplayer_id: null,
    mapping_confidence: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  }));
}

// Prices (illustrative — approximate real market for the given treatment).
// Prices assigned per (card_id, finish).
const PRICE_TABLE: Record<string, { usd: number; eur: number }> = {
  // Base Luffy Leader — cheap
  'onepiece:card:op_eb02_010|nonfoil':    { usd: 0.47, eur: 0.14 },
  'onepiece:card:op_eb02_010|foil':       { usd: 0.85, eur: 0.32 },
  // Luffy _p1 — mid parallel
  'onepiece:card:op_eb02_010_p1|nonfoil': { usd: 950,  eur: 977 },
  'onepiece:card:op_eb02_010_p1|foil':    { usd: 1006, eur: 1050 },
  // Luffy _p2 — chase parallel
  'onepiece:card:op_eb02_010_p2|nonfoil': { usd: 380,  eur: 398 },
  'onepiece:card:op_eb02_010_p2|foil':    { usd: 1427, eur: 1550 },
  // Luffy _p3 — highest parallel
  'onepiece:card:op_eb02_010_p3|foil':    { usd: 710,  eur: 760 },
  // Weevil SP CARD
  'onepiece:card:op_eb01_023_p1|nonfoil': { usd: 42,   eur: 39 },
  'onepiece:card:op_eb01_023_p1|foil':    { usd: 78,   eur: 74 },
  // Weevil Rare parallel
  'onepiece:card:op_eb01_023_p2|nonfoil': { usd: 0.35, eur: 0.28 },
  // Boa SEC base
  'onepiece:card:op_eb02_061|nonfoil':    { usd: 6.20, eur: 5.93 },
  'onepiece:card:op_eb02_061|foil':       { usd: 13.05, eur: 11.90 },
  // Boa SEC reprint — same tier as base
  'onepiece:card:op_eb02_061_r1|nonfoil': { usd: 6.80, eur: 7.47 },
  'onepiece:card:op_eb02_061_r1|foil':    { usd: 13.21, eur: 12.50 },
  // Boa SP CARD
  'onepiece:card:op_eb02_061_p3|nonfoil': { usd: 380,  eur: 394 },
  'onepiece:card:op_eb02_061_p3|foil':    { usd: 478,  eur: 460 },
  // Katakuri TR
  'onepiece:card:op_op05_119|nonfoil':    { usd: 1150, eur: 1080 },
  'onepiece:card:op_op05_119|foil':       { usd: 1450, eur: 1360 },
  // Zoro promo
  'onepiece:card:op_p_001|nonfoil':       { usd: 6.90, eur: 5.80 },
  // Nami standard
  'onepiece:card:op_op02_042|nonfoil':    { usd: 0.28, eur: 0.22 },
  'onepiece:card:op_op02_042|foil':       { usd: 0.85, eur: 0.72 },
  // Zoro Leader
  'onepiece:card:op_op01_002|nonfoil':    { usd: 1.20, eur: 0.95 },
  'onepiece:card:op_op01_002|foil':       { usd: 2.10, eur: 1.85 },
};

// Choose finishes per card. Base Luffy Leader p3 only has foil in prod.
const CARD_FINISHES: Record<string, Array<'normal' | 'foil'>> = {
  'onepiece:card:op_eb02_010':    ['normal', 'foil'],
  'onepiece:card:op_eb02_010_p1': ['normal', 'foil'],
  'onepiece:card:op_eb02_010_p2': ['normal', 'foil'],
  'onepiece:card:op_eb02_010_p3': ['foil'],
  'onepiece:card:op_eb01_023_p1': ['normal', 'foil'],
  'onepiece:card:op_eb01_023_p2': ['normal'],
  'onepiece:card:op_eb02_061':    ['normal', 'foil'],
  'onepiece:card:op_eb02_061_r1': ['normal', 'foil'],
  'onepiece:card:op_eb02_061_p3': ['normal', 'foil'],
  'onepiece:card:op_op05_119':    ['normal', 'foil'],
  'onepiece:card:op_p_001':       ['normal'],
  'onepiece:card:op_op02_042':    ['normal', 'foil'],
  'onepiece:card:op_op01_002':    ['normal', 'foil'],
};

const PRINTING_ROWS: FixturePrinting[] = [];
for (const card of CARDS) {
  const keys = CARD_FINISHES[card.id] ?? ['normal'];
  PRINTING_ROWS.push(...printingsFor(card, keys));
}

const RETAIL_ROWS: any[] = [];
for (const p of PRINTING_ROWS) {
  const priceKey = `${p.tcg_card_id}|${p.finish}`;
  const prices = PRICE_TABLE[priceKey];
  if (!prices) continue;
  // TCGplayer USD
  RETAIL_ROWS.push({
    tcg_printing_id: p.id,
    game_id: OP_GAME_ID,
    source: 'tcggraph.tcgplayer',
    list_type: 'retail',
    region: 'NA',
    currency: 'USD',
    finish: p.finish,
    price: prices.usd,
    price_low: prices.usd * 0.85,
    price_trend: prices.usd * 1.02,
    avg_1d: prices.usd,
    avg_7d: prices.usd * 0.98,
    avg_30d: prices.usd * 0.94,
    updated_at: '2026-09-22T00:00:00Z',
    ingested_at: '2026-09-22T00:00:00Z',
    source_run_id: null,
  });
  // Cardmarket EUR
  RETAIL_ROWS.push({
    tcg_printing_id: p.id,
    game_id: OP_GAME_ID,
    source: 'tcggraph.cardmarket',
    list_type: 'retail',
    region: 'EU',
    currency: 'EUR',
    finish: p.finish,
    price: prices.eur,
    price_low: prices.eur * 0.75,
    price_trend: prices.eur,
    avg_1d: prices.eur,
    avg_7d: prices.eur * 0.97,
    avg_30d: prices.eur * 0.9,
    updated_at: '2026-09-22T00:00:00Z',
    ingested_at: '2026-09-22T00:00:00Z',
    source_run_id: null,
  });
}

// Daily rows — three days per (printing × source × currency) so the
// spark shows a small trend and the movers board has enough observations.
const now = Date.now();
const day = 1000 * 60 * 60 * 24;
const DAILY_ROWS: Array<{
  tcg_printing_id: string;
  game_id: string;
  source: string;
  currency: string;
  finish: string | null;
  price: number;
  observed_on: string;
}> = [];

for (let i = 0; i < PRINTING_ROWS.length; i++) {
  const row = PRINTING_ROWS[i]!;
  const priceKey = `${row.tcg_card_id}|${row.finish}`;
  const prices = PRICE_TABLE[priceKey];
  if (!prices) continue;
  // Half rise, half fall so the movers board has both columns populated.
  const direction = i % 2 === 0 ? 1 : -1;
  const finalUsd = prices.usd;
  const finalEur = prices.eur;
  const startUsd = Math.max(1, finalUsd * (direction > 0 ? 0.7 : 1.4));
  const startEur = Math.max(1, finalEur * (direction > 0 ? 0.7 : 1.4));
  for (let d = 30; d >= 0; d--) {
    const t = (30 - d) / 30;
    const usd = startUsd + (finalUsd - startUsd) * t;
    const eur = startEur + (finalEur - startEur) * t;
    const observed = new Date(now - d * day).toISOString().slice(0, 10);
    DAILY_ROWS.push({
      tcg_printing_id: row.id,
      game_id: OP_GAME_ID,
      source: 'tcggraph.tcgplayer',
      currency: 'USD',
      finish: row.finish,
      price: Number(usd.toFixed(2)),
      observed_on: observed,
    });
    DAILY_ROWS.push({
      tcg_printing_id: row.id,
      game_id: OP_GAME_ID,
      source: 'tcggraph.cardmarket',
      currency: 'EUR',
      finish: row.finish,
      price: Number(eur.toFixed(2)),
      observed_on: observed,
    });
  }
}

/** Public accessor used by the stub Supabase client. */
export function getFixtureRows(
  table: string,
  filters: Record<string, unknown>,
): unknown[] {
  const gameId = String(filters['game_id'] ?? '');
  if (gameId && gameId !== OP_GAME_ID) return [];
  switch (table) {
    case 'tcg_games':
      return [{
        id: OP_GAME_ID,
        slug: 'one-piece',
        name: 'One Piece Card Game',
        active: true,
        created_at: '2026-09-21T15:48:10.749388+00:00',
      }];
    case 'tcg_sets':
      return applyIdFilters(SETS, filters);
    case 'tcg_cards':
      return applyIdFilters(applySetFilter(CARDS, filters), filters);
    case 'tcg_printings':
      return applyIdFilters(applyCardFilter(PRINTING_ROWS, filters), filters);
    case 'tcg_market_prices_current':
      return applyIdFilters(RETAIL_ROWS, filters);
    case 'tcg_graded_prices_current':
      return [];
    case 'tcg_market_price_daily':
      return applyIdFilters(DAILY_ROWS, filters);
    default:
      return [];
  }
}

function applySetFilter(rows: typeof CARDS, filters: Record<string, unknown>): typeof CARDS {
  const setId = filters['set_id'];
  if (typeof setId === 'string') return rows.filter((r) => r.set_id === setId);
  const setIds = filters['set_id_in'] as string[] | undefined;
  if (Array.isArray(setIds)) return rows.filter((r) => setIds.includes(r.set_id));
  return rows;
}

function applyCardFilter<T extends { tcg_card_id?: string }>(
  rows: T[],
  filters: Record<string, unknown>,
): T[] {
  const cardId = filters['tcg_card_id'];
  if (typeof cardId === 'string') return rows.filter((r) => r.tcg_card_id === cardId);
  const cardIds = filters['tcg_card_id_in'] as string[] | undefined;
  if (Array.isArray(cardIds)) return rows.filter((r) => cardIds.includes(r.tcg_card_id ?? ''));
  return rows;
}

function applyIdFilters<T extends { id?: string; tcg_printing_id?: string }>(
  rows: T[],
  filters: Record<string, unknown>,
): T[] {
  const id = filters['id'];
  if (typeof id === 'string') return rows.filter((r) => r.id === id);
  const ids = filters['id_in'] as string[] | undefined;
  if (Array.isArray(ids)) return rows.filter((r) => ids.includes(r.id ?? ''));
  const printingIds = filters['tcg_printing_id_in'] as string[] | undefined;
  if (Array.isArray(printingIds)) {
    return rows.filter((r) => printingIds.includes(r.tcg_printing_id ?? ''));
  }
  const slug = filters['slug'];
  if (typeof slug === 'string') {
    return rows.filter((r) => (r as unknown as { slug?: string }).slug === slug);
  }
  const code = filters['code'];
  if (typeof code === 'string') {
    return rows.filter((r) => (r as unknown as { code?: string }).code === code);
  }
  const name = filters['name'];
  if (typeof name === 'string') {
    return rows.filter((r) => (r as unknown as { name?: string }).name === name);
  }
  const nameLike = filters['name_like'];
  if (typeof nameLike === 'string') {
    const parts = nameLike
      .toLowerCase()
      .split('%')
      .map((s) => s.trim())
      .filter(Boolean);
    return rows.filter((r) => {
      const name = ((r as unknown as { name?: string }).name ?? '').toLowerCase();
      let cursor = 0;
      for (const part of parts) {
        const idx = name.indexOf(part, cursor);
        if (idx === -1) return false;
        cursor = idx + part.length;
      }
      return true;
    });
  }
  return rows;
}

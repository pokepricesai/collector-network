import 'server-only';

// Preview fixture — a tiny, curated snapshot of the shared tcg_* schema
// scoped to Disney Lorcana. Only ever served by the stub Supabase
// client when SUPABASE_URL is absent (local dev + first-look Vercel
// previews). Production has real env vars, so the stub — and this
// fixture — never run there.
//
// Shape rules — verified against production 2026-09-26 in
// docs/lorcana/data-audit.md:
//   * game_id is the literal string 'lorcana'
//   * tcg_cards.id shape: `lorcana:card:lor_{set}_{cn}`
//   * tcg_printings.id shape: `lorcana:print:lor_{set}_{cn}:{key}:en`
//   * tcg_printings.edition is always null
//   * tcg_printings.finish is 'nonfoil' or 'foil'
//   * language is 'en'
//   * gamedata carries {ink, inkCost, inkable, lore, strength,
//     willpower, moveCost, cardType, version, classifications}
//
// Kept lean — five sets, ten cards, ~20 printings — enough to render
// each surface without duplicating production.

const LC_GAME_ID = 'lorcana';

const SETS = [
  {
    id: 'lorcana:set:1',
    game_id: LC_GAME_ID,
    code: '1',
    name: 'The First Chapter',
    released_at: '2023-08-18',
    tcggraph_meta: null,
    created_at: '2023-08-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'lorcana:set:6',
    game_id: LC_GAME_ID,
    code: '6',
    name: 'Azurite Sea',
    released_at: '2024-11-15',
    tcggraph_meta: null,
    created_at: '2024-10-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'lorcana:set:9',
    game_id: LC_GAME_ID,
    code: '9',
    name: 'Fabled',
    released_at: '2025-08-29',
    tcggraph_meta: null,
    created_at: '2025-08-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'lorcana:set:12',
    game_id: LC_GAME_ID,
    code: '12',
    name: 'Wilds Unknown',
    released_at: '2026-05-08',
    tcggraph_meta: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'lorcana:set:d23',
    game_id: LC_GAME_ID,
    code: 'd23',
    name: 'D23 Collection',
    released_at: '2024-08-09',
    tcggraph_meta: null,
    created_at: '2024-07-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
];

const CARDS = [
  // Mickey Mouse — Brave Little Tailor — Legendary
  {
    id: 'lorcana:card:lor_1_115',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: 'Mickey Mouse - Brave Little Tailor',
    english_id: '115/204',
    language: 'en',
    rarity: 'Legendary',
    artist: 'Kenneth Anderson',
    rules_text: 'Support (Whenever this character quests, you may add their Strength to another chosen character\'s Strength this turn.)',
    images: null,
    gamedata: {
      ink: 'Steel', inkCost: 8, inkable: true, lore: 3,
      strength: 5, willpower: 5, moveCost: null,
      cardType: 'CHARACTER', version: 'Brave Little Tailor',
      classifications: ['Storyborn', 'Hero'],
    },
    set_id: 'lorcana:set:1',
    collector_number: '115',
    created_at: '2023-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
  // Mickey Mouse — D23 promo
  {
    id: 'lorcana:card:lor_d23_1',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: 'Mickey Mouse - Brave Little Tailor',
    english_id: 'd23-01',
    language: 'en',
    rarity: 'Promo',
    artist: 'Kenneth Anderson',
    rules_text: 'Support. Full-art D23 exclusive.',
    images: null,
    gamedata: {
      ink: 'Steel', inkCost: 8, inkable: true, lore: 3,
      strength: 5, willpower: 5, moveCost: null,
      cardType: 'CHARACTER', version: 'Brave Little Tailor',
      classifications: ['Storyborn', 'Hero'],
    },
    set_id: 'lorcana:set:d23',
    collector_number: '1',
    created_at: '2024-07-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
  // Elsa — Snow Queen — Super rare
  {
    id: 'lorcana:card:lor_1_042',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: 'Elsa - Snow Queen',
    english_id: '42/204',
    language: 'en',
    rarity: 'Super rare',
    artist: 'Nicholas Kole',
    rules_text: 'FREEZE — Exert chosen opposing character.',
    images: null,
    gamedata: {
      ink: 'Amethyst', inkCost: 4, inkable: true, lore: 2,
      strength: 2, willpower: 4, moveCost: null,
      cardType: 'CHARACTER', version: 'Snow Queen',
      classifications: ['Storyborn', 'Queen', 'Sorcerer'],
    },
    set_id: 'lorcana:set:1',
    collector_number: '42',
    created_at: '2023-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
  // Elsa Enchanted — the chase axis
  {
    id: 'lorcana:card:lor_1_228',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: 'Elsa - Spirit of Winter',
    english_id: '228/204',
    language: 'en',
    rarity: 'Enchanted',
    artist: 'Nicholas Kole',
    rules_text: 'Enchanted alt-art. Bordered illustration.',
    images: null,
    gamedata: {
      ink: 'Amethyst', inkCost: 8, inkable: false, lore: 3,
      strength: 4, willpower: 6, moveCost: null,
      cardType: 'CHARACTER', version: 'Spirit of Winter',
      classifications: ['Storyborn', 'Queen', 'Sorcerer'],
    },
    set_id: 'lorcana:set:1',
    collector_number: '228',
    created_at: '2023-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
  // Beast — Wounded — Common (baseline)
  {
    id: 'lorcana:card:lor_1_072',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: 'Beast - Wounded',
    english_id: '72/204',
    language: 'en',
    rarity: 'Common',
    artist: 'John Loren',
    rules_text: null,
    images: null,
    gamedata: {
      ink: 'Emerald', inkCost: 2, inkable: true, lore: 1,
      strength: 1, willpower: 4, moveCost: null,
      cardType: 'CHARACTER', version: 'Wounded',
      classifications: ['Storyborn', 'Prince'],
    },
    set_id: 'lorcana:set:1',
    collector_number: '72',
    created_at: '2023-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
  // Genie — On The Job — Rare — Amber
  {
    id: 'lorcana:card:lor_6_010',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: 'Genie - On The Job',
    english_id: '10/204',
    language: 'en',
    rarity: 'Rare',
    artist: 'Isabella Ceravolo',
    rules_text: 'GET TO WORK — When you play this character you may draw a card.',
    images: null,
    gamedata: {
      ink: 'Amber', inkCost: 5, inkable: true, lore: 2,
      strength: 3, willpower: 4, moveCost: null,
      cardType: 'CHARACTER', version: 'On The Job',
      classifications: ['Storyborn', 'Ally'],
    },
    set_id: 'lorcana:set:6',
    collector_number: '10',
    created_at: '2024-10-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
  // Maleficent — Sorceress — Rare — Ruby
  {
    id: 'lorcana:card:lor_1_113',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: 'Maleficent - Monstrous Dragon',
    english_id: '113/204',
    language: 'en',
    rarity: 'Legendary',
    artist: 'Nicholas Kole',
    rules_text: 'Reckless — This character can\'t quest and must challenge if able.',
    images: null,
    gamedata: {
      ink: 'Ruby', inkCost: 9, inkable: true, lore: 2,
      strength: 7, willpower: 5, moveCost: null,
      cardType: 'CHARACTER', version: 'Monstrous Dragon',
      classifications: ['Storyborn', 'Villain', 'Dragon'],
    },
    set_id: 'lorcana:set:1',
    collector_number: '113',
    created_at: '2023-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
  // Ariel's Grotto — Location — Sapphire
  {
    id: 'lorcana:card:lor_9_202',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: "Ariel's Grotto",
    english_id: '202/204',
    language: 'en',
    rarity: 'Rare',
    artist: 'Alex Accorsi',
    rules_text: 'A hidden sanctuary of curiosities.',
    images: null,
    gamedata: {
      ink: 'Sapphire', inkCost: 3, inkable: true, lore: 1,
      strength: null, willpower: 6, moveCost: 2,
      cardType: 'LOCATION', version: null,
      classifications: ['Location'],
    },
    set_id: 'lorcana:set:9',
    collector_number: '202',
    created_at: '2025-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
  // A Whole New World — Song — Amber
  {
    id: 'lorcana:card:lor_12_138',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: 'A Whole New World',
    english_id: '138/204',
    language: 'en',
    rarity: 'Rare',
    artist: 'Gabriela Silveira',
    rules_text: 'Each player may discard their hand and draw 7 cards.',
    images: null,
    gamedata: {
      ink: 'Sapphire', inkCost: 5, inkable: true, lore: null,
      strength: null, willpower: null, moveCost: null,
      cardType: 'ACTION - SONG', version: null,
      classifications: ['Action', 'Song'],
    },
    set_id: 'lorcana:set:12',
    collector_number: '138',
    created_at: '2026-04-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
  // Simba's Locket — Item — Emerald
  {
    id: 'lorcana:card:lor_9_066',
    game_id: LC_GAME_ID,
    tcggraph_card_id: null,
    name: "Simba's Locket",
    english_id: '66/204',
    language: 'en',
    rarity: 'Uncommon',
    artist: 'Wietse Treurniet',
    rules_text: null,
    images: null,
    gamedata: {
      ink: 'Emerald', inkCost: 1, inkable: true, lore: null,
      strength: null, willpower: null, moveCost: null,
      cardType: 'ITEM', version: null,
      classifications: ['Item'],
    },
    set_id: 'lorcana:set:9',
    collector_number: '66',
    created_at: '2025-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  },
];

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
    id: `lorcana:print:${card.id.replace('lorcana:card:', '')}:${key}:en`,
    game_id: LC_GAME_ID,
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
    created_at: '2023-08-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  }));
}

const PRICE_TABLE: Record<string, { usd: number; eur: number }> = {
  'lorcana:card:lor_1_115|nonfoil':  { usd: 15.4, eur: 12.8 },
  'lorcana:card:lor_1_115|foil':     { usd: 84.5, eur: 78.0 },
  'lorcana:card:lor_d23_1|foil':     { usd: 209, eur: 282 },
  'lorcana:card:lor_1_042|nonfoil':  { usd: 3.2, eur: 2.7 },
  'lorcana:card:lor_1_042|foil':     { usd: 22, eur: 19 },
  'lorcana:card:lor_1_228|foil':     { usd: 480, eur: 425 },
  'lorcana:card:lor_1_072|nonfoil':  { usd: 0.15, eur: 0.09 },
  'lorcana:card:lor_1_072|foil':     { usd: 0.85, eur: 0.65 },
  'lorcana:card:lor_6_010|nonfoil':  { usd: 1.2, eur: 0.95 },
  'lorcana:card:lor_6_010|foil':     { usd: 4.5, eur: 3.8 },
  'lorcana:card:lor_1_113|nonfoil':  { usd: 5.6, eur: 4.9 },
  'lorcana:card:lor_1_113|foil':     { usd: 28, eur: 25 },
  'lorcana:card:lor_9_202|nonfoil':  { usd: 2.1, eur: 1.7 },
  'lorcana:card:lor_9_202|foil':     { usd: 6.7, eur: 5.9 },
  'lorcana:card:lor_12_138|nonfoil': { usd: 3.8, eur: 3.1 },
  'lorcana:card:lor_12_138|foil':    { usd: 12.5, eur: 10.9 },
  'lorcana:card:lor_9_066|nonfoil':  { usd: 0.35, eur: 0.28 },
  'lorcana:card:lor_9_066|foil':     { usd: 1.4, eur: 1.15 },
};

const CARD_FINISHES: Record<string, Array<'normal' | 'foil'>> = {
  'lorcana:card:lor_1_115':  ['normal', 'foil'],
  'lorcana:card:lor_d23_1':  ['foil'],
  'lorcana:card:lor_1_042':  ['normal', 'foil'],
  'lorcana:card:lor_1_228':  ['foil'],
  'lorcana:card:lor_1_072':  ['normal', 'foil'],
  'lorcana:card:lor_6_010':  ['normal', 'foil'],
  'lorcana:card:lor_1_113':  ['normal', 'foil'],
  'lorcana:card:lor_9_202':  ['normal', 'foil'],
  'lorcana:card:lor_12_138': ['normal', 'foil'],
  'lorcana:card:lor_9_066':  ['normal', 'foil'],
};

const PRINTING_ROWS: FixturePrinting[] = [];
for (const card of CARDS) {
  const keys = CARD_FINISHES[card.id] ?? ['normal'];
  PRINTING_ROWS.push(...printingsFor(card, keys));
}

const RETAIL_ROWS: Array<Record<string, unknown> & { id?: string; tcg_printing_id?: string }> = [];
for (const p of PRINTING_ROWS) {
  const priceKey = `${p.tcg_card_id}|${p.finish}`;
  const prices = PRICE_TABLE[priceKey];
  if (!prices) continue;
  RETAIL_ROWS.push({
    tcg_printing_id: p.id,
    game_id: LC_GAME_ID,
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
    updated_at: '2026-09-25T00:00:00Z',
    ingested_at: '2026-09-25T00:00:00Z',
    source_run_id: null,
  });
  RETAIL_ROWS.push({
    tcg_printing_id: p.id,
    game_id: LC_GAME_ID,
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
    updated_at: '2026-09-26T00:00:00Z',
    ingested_at: '2026-09-26T00:00:00Z',
    source_run_id: null,
  });
}

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
  const direction = i % 2 === 0 ? 1 : -1;
  const finalUsd = prices.usd;
  const finalEur = prices.eur;
  const startUsd = Math.max(0.5, finalUsd * (direction > 0 ? 0.7 : 1.4));
  const startEur = Math.max(0.5, finalEur * (direction > 0 ? 0.7 : 1.4));
  for (let d = 30; d >= 0; d--) {
    const t = (30 - d) / 30;
    const usd = startUsd + (finalUsd - startUsd) * t;
    const eur = startEur + (finalEur - startEur) * t;
    const observed = new Date(now - d * day).toISOString().slice(0, 10);
    DAILY_ROWS.push({
      tcg_printing_id: row.id,
      game_id: LC_GAME_ID,
      source: 'tcggraph.tcgplayer',
      currency: 'USD',
      finish: row.finish,
      price: Number(usd.toFixed(2)),
      observed_on: observed,
    });
    DAILY_ROWS.push({
      tcg_printing_id: row.id,
      game_id: LC_GAME_ID,
      source: 'tcggraph.cardmarket',
      currency: 'EUR',
      finish: row.finish,
      price: Number(eur.toFixed(2)),
      observed_on: observed,
    });
  }
}

export function getFixtureRows(
  table: string,
  filters: Record<string, unknown>,
): unknown[] {
  const gameId = String(filters['game_id'] ?? '');
  if (gameId && gameId !== LC_GAME_ID) return [];
  switch (table) {
    case 'tcg_games':
      return [{
        id: LC_GAME_ID,
        slug: 'disney-lorcana',
        name: 'Disney Lorcana',
        active: true,
        created_at: '2026-09-22T08:47:30.149876+00:00',
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
      const rowName = ((r as unknown as { name?: string }).name ?? '').toLowerCase();
      let cursor = 0;
      for (const part of parts) {
        const idx = rowName.indexOf(part, cursor);
        if (idx === -1) return false;
        cursor = idx + part.length;
      }
      return true;
    });
  }
  return rows;
}

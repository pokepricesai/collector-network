import 'server-only';

// Preview fixture — a tiny, curated snapshot of the shared tcg_* schema
// scoped to One Piece. Only ever served by the stub Supabase client
// when SUPABASE_URL is absent (local dev + first-look Vercel previews).
// Production has real env vars, so the stub — and this fixture — never
// run there.
//
// The fixture exists purely so QA against the intended designed states
// isn't blocked on data. Numbers, prices and treatments are illustrative.

const OP_GAME_ID = 'op';

const SETS = [
  {
    id: 'set-op01',
    game_id: OP_GAME_ID,
    code: 'op01',
    name: 'Romance Dawn',
    released_at: '2024-07-25',
    tcggraph_meta: null,
    created_at: '2024-06-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'set-op02',
    game_id: OP_GAME_ID,
    code: 'op02',
    name: 'Paramount War',
    released_at: '2024-11-08',
    tcggraph_meta: null,
    created_at: '2024-09-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'set-op03',
    game_id: OP_GAME_ID,
    code: 'op03',
    name: 'Pillars of Strength',
    released_at: '2025-02-26',
    tcggraph_meta: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'set-op04',
    game_id: OP_GAME_ID,
    code: 'op04',
    name: 'Kingdoms of Intrigue',
    released_at: '2025-05-30',
    tcggraph_meta: null,
    created_at: '2025-04-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'set-op05',
    game_id: OP_GAME_ID,
    code: 'op05',
    name: 'Awakening of the New Era',
    released_at: '2025-08-22',
    tcggraph_meta: null,
    created_at: '2025-07-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
];

// Card rows. Same logical card can appear multiple times (per-rarity),
// mirroring how the real schema stores treatments as distinct rows.
// The `gamedata` shape matches src/lib/onepiece/gamedata.ts.
const CARDS = [
  // — Monkey D. Luffy family (OP01) — five treatments
  {
    id: 'card-luffy-op01-l',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Monkey D. Luffy',
    english_id: 'OP01-001',
    language: 'en',
    rarity: 'L',
    artist: 'Eiichiro Oda',
    rules_text: null,
    images: null,
    gamedata: {
      type: 'Leader',
      colours: ['red'],
      life: 5,
      power: 5000,
      attribute: 'Strike',
      types: ['Straw Hat Crew', 'Supernovas'],
      language: 'en',
      effect_text:
        "Activate: Main [Once Per Turn] Give up to 1 of your Characters +1000 power during this turn.",
    },
    set_id: 'set-op01',
    collector_number: 'OP01-001',
    created_at: '2024-06-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'card-luffy-op01-sr',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Monkey D. Luffy',
    english_id: 'OP01-025',
    language: 'en',
    rarity: 'SR',
    artist: 'Eiichiro Oda',
    rules_text: null,
    images: null,
    gamedata: {
      type: 'Character',
      colours: ['red'],
      cost: 5,
      power: 6000,
      counter: 1000,
      attribute: 'Strike',
      types: ['Straw Hat Crew', 'Supernovas'],
      language: 'en',
      effect_text:
        "When Attacking: You may rest 1 of your Characters. If you do, this Character gains +2000 power during this turn.",
      trigger: 'Yes',
      trigger_text: 'Play up to 1 Character card with a cost of 4 or less from your hand.',
    },
    set_id: 'set-op01',
    collector_number: 'OP01-025',
    created_at: '2024-06-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'card-luffy-op01-sec',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Monkey D. Luffy',
    english_id: 'OP01-121',
    language: 'en',
    rarity: 'SEC',
    artist: 'Studio Colorido',
    rules_text: null,
    images: null,
    gamedata: {
      type: 'Character',
      colours: ['red'],
      cost: 5,
      power: 6000,
      counter: 1000,
      attribute: 'Strike',
      types: ['Straw Hat Crew', 'Supernovas'],
      language: 'en',
    },
    set_id: 'set-op01',
    collector_number: 'OP01-121',
    created_at: '2024-06-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },

  // Roronoa Zoro — Leader
  {
    id: 'card-zoro-op01-l',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Roronoa Zoro',
    english_id: 'OP01-002',
    language: 'en',
    rarity: 'L',
    artist: 'Eiichiro Oda',
    rules_text: null,
    images: null,
    gamedata: {
      type: 'Leader',
      colours: ['green'],
      life: 5,
      power: 5000,
      attribute: 'Slash',
      types: ['Straw Hat Crew'],
      language: 'en',
      effect_text:
        'Activate: Main [Once Per Turn] Give up to 1 of your Characters +1000 power during this turn.',
    },
    set_id: 'set-op01',
    collector_number: 'OP01-002',
    created_at: '2024-06-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
  {
    id: 'card-zoro-op01-sr',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Roronoa Zoro',
    english_id: 'OP01-025z',
    language: 'en',
    rarity: 'SR',
    artist: 'Eiichiro Oda',
    rules_text: null,
    images: null,
    gamedata: {
      type: 'Character',
      colours: ['green'],
      cost: 4,
      power: 5000,
      counter: 1000,
      attribute: 'Slash',
      types: ['Straw Hat Crew'],
      language: 'en',
    },
    set_id: 'set-op01',
    collector_number: 'OP01-025z',
    created_at: '2024-06-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },

  // Yamato — Blue
  {
    id: 'card-yamato-op02-sr',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Yamato',
    english_id: 'OP02-018',
    language: 'en',
    rarity: 'SR',
    artist: 'Eiichiro Oda',
    rules_text: null,
    images: null,
    gamedata: {
      type: 'Character',
      colours: ['blue'],
      cost: 4,
      power: 5000,
      counter: 1000,
      attribute: 'Special',
      types: ['Land of Wano', 'Kozuki Clan'],
      language: 'en',
    },
    set_id: 'set-op02',
    collector_number: 'OP02-018',
    created_at: '2024-09-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },

  // Kaido — Purple leader
  {
    id: 'card-kaido-op03-l',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Kaido',
    english_id: 'OP03-001',
    language: 'en',
    rarity: 'L',
    artist: 'Eiichiro Oda',
    rules_text: null,
    images: null,
    gamedata: {
      type: 'Leader',
      colours: ['purple', 'yellow'],
      life: 4,
      power: 5000,
      attribute: 'Strike',
      types: ['Four Emperors', 'Animal Kingdom Pirates'],
      language: 'en',
    },
    set_id: 'set-op03',
    collector_number: 'OP03-001',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },

  // Nami — support event
  {
    id: 'card-nami-op02-r',
    game_id: OP_GAME_ID,
    tcggraph_card_id: null,
    name: 'Nami',
    english_id: 'OP02-042',
    language: 'en',
    rarity: 'R',
    artist: 'Eiichiro Oda',
    rules_text: null,
    images: null,
    gamedata: {
      type: 'Character',
      colours: ['blue'],
      cost: 3,
      power: 4000,
      counter: 1000,
      attribute: 'Special',
      types: ['Straw Hat Crew'],
      language: 'en',
    },
    set_id: 'set-op02',
    collector_number: 'OP02-042',
    created_at: '2024-09-01T00:00:00Z',
    updated_at: '2025-08-01T00:00:00Z',
  },
];

// Printings — the priced physical layer. Each card row usually has one
// or two printing rows (base + parallel + alt-art).
const PRINTINGS = [
  { card: 'card-luffy-op01-l', treatment: 'standard' },
  { card: 'card-luffy-op01-l', treatment: 'parallel' },
  { card: 'card-luffy-op01-l', treatment: 'alt-art' },
  { card: 'card-luffy-op01-sr', treatment: 'standard' },
  { card: 'card-luffy-op01-sr', treatment: 'manga-rare' },
  { card: 'card-luffy-op01-sec', treatment: 'sec' },
  { card: 'card-zoro-op01-l', treatment: 'standard' },
  { card: 'card-zoro-op01-l', treatment: 'alt-art' },
  { card: 'card-zoro-op01-sr', treatment: 'standard' },
  { card: 'card-yamato-op02-sr', treatment: 'standard' },
  { card: 'card-yamato-op02-sr', treatment: 'parallel' },
  { card: 'card-kaido-op03-l', treatment: 'standard' },
  { card: 'card-kaido-op03-l', treatment: 'special-rare' },
  { card: 'card-nami-op02-r', treatment: 'standard' },
];

interface FixturePrinting {
  id: string;
  game_id: string;
  tcg_card_id: string;
  set_id: string;
  tcggraph_card_id: null;
  tcggraph_printing_key: null;
  finish: string | null;
  edition: string | null;
  language: string;
  collector_number: string | null;
  mtg_printings_id: null;
  cardmarket_id: null;
  tcgplayer_id: null;
  mapping_confidence: null;
  created_at: string;
  updated_at: string;
}

// Expand into full printing rows.
const PRINTING_ROWS: FixturePrinting[] = PRINTINGS.map((p, idx) => {
  const card = CARDS.find((c) => c.id === p.card)!;
  const editionByTreatment: Record<string, string | null> = {
    standard: null,
    parallel: 'parallel',
    'alt-art': 'alternate art',
    'manga-rare': 'manga',
    'special-rare': 'special',
    promo: 'promo',
    sec: 'sec',
  };
  return {
    id: `printing-${idx + 1}`,
    game_id: OP_GAME_ID,
    tcg_card_id: card.id,
    set_id: card.set_id,
    tcggraph_card_id: null,
    tcggraph_printing_key: null,
    finish: 'holo',
    edition: editionByTreatment[p.treatment] ?? null,
    language: 'en',
    collector_number: card.collector_number,
    mtg_printings_id: null,
    cardmarket_id: null,
    tcgplayer_id: null,
    mapping_confidence: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-09-01T00:00:00Z',
  };
});

// Retail-price rows. Prices roughly reflect treatment premium: sec /
// alt-art dominate the standard printing.
const PRICE_BY_TREATMENT: Record<string, number> = {
  standard: 3,
  parallel: 18,
  'alt-art': 220,
  'manga-rare': 340,
  'special-rare': 95,
  promo: 12,
  sec: 480,
};

const RETAIL_ROWS = PRINTING_ROWS.map((row, idx) => {
  const seed = PRINTINGS[idx]!;
  const price = PRICE_BY_TREATMENT[seed.treatment] ?? 5;
  return {
    tcg_printing_id: row.id,
    game_id: OP_GAME_ID,
    source: 'tcgplayer',
    list_type: 'market',
    region: 'us',
    currency: 'USD',
    finish: 'holo',
    price,
    price_low: Math.max(0.5, price * 0.7),
    price_trend: price * 1.02,
    avg_1d: price,
    avg_7d: price * 0.98,
    avg_30d: price * 0.9,
    updated_at: '2025-09-15T00:00:00Z',
    ingested_at: '2025-09-15T00:00:00Z',
    source_run_id: null,
  };
});

// Daily rows spanning the last 40 days so 30d movers pop up.
const now = Date.now();
const day = 1000 * 60 * 60 * 24;
const DAILY_ROWS: Array<{
  tcg_printing_id: string;
  game_id: string;
  currency: string;
  price: number;
  observed_on: string;
}> = [];

for (let i = 0; i < PRINTING_ROWS.length; i++) {
  const row = PRINTING_ROWS[i]!;
  const treatment = PRINTINGS[i]!.treatment;
  const finalPrice = PRICE_BY_TREATMENT[treatment] ?? 5;
  // Half rise, half fall so both columns fill.
  const direction = i % 2 === 0 ? 1 : -1;
  const startPrice =
    direction > 0
      ? Math.max(1, finalPrice * 0.65)
      : Math.max(1, finalPrice * 1.35);
  for (let d = 40; d >= 0; d--) {
    const t = (40 - d) / 40;
    const p = startPrice + (finalPrice - startPrice) * t;
    DAILY_ROWS.push({
      tcg_printing_id: row.id,
      game_id: OP_GAME_ID,
      currency: 'USD',
      price: Number(p.toFixed(2)),
      observed_on: new Date(now - d * day).toISOString().slice(0, 10),
    });
  }
}

/**
 * Public accessor used by the stub Supabase client. Returns the fixture
 * rows for a given table + game_id combination.
 */
export function getFixtureRows(
  table: string,
  filters: Record<string, unknown>,
): unknown[] {
  const gameId = String(filters['game_id'] ?? '');
  if (gameId && gameId !== OP_GAME_ID) return [];
  switch (table) {
    case 'tcg_games':
      return [{ id: OP_GAME_ID, slug: 'onepiece', name: 'One Piece Card Game', active: true, created_at: '2024-01-01T00:00:00Z' }];
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
    // Postgres ILIKE `%foo%bar%` → treat each `%`-separated segment as
    // a substring that must appear in order. Matches the shape of the
    // `searchCardsByName` helper.
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

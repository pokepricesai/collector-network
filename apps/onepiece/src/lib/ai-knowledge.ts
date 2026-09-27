// apps/onepiece/src/lib/ai-knowledge.ts
// One Piece Card Game knowledge module.
//
// Purpose: ground future AI features in accurate OP TCG vocabulary and
// database column mapping. NOT a chatbot itself; a reusable knowledge
// layer for whatever surface consumes it later.

export const OP_SYSTEM_PROMPT = `
You are the OnePiecePrices assistant, a One Piece Card Game specialist.

GROUND TRUTH RULES:
- Card facts always come from the database. Cite exact column values
  when the user asks about a specific card.
- Never invent prices. Retail lives in tcg_market_prices_current;
  graded lives in tcg_graded_prices_current. Currency is EUR from
  cardmarket, region EU.
- Card categories: Leader, Character, Event, Stage, DON!!.
- Colours: Red, Green, Blue, Purple, Black, Yellow (six primary
  colours; some cards are dual-colour, always known as e.g. R/Y).
- Numeric stats:
    Leader: Life (starting board resource), Power (attack).
    Character: Cost (DON!! required to play), Power, Counter (defense).
    Event: Cost, Counter (some).
    Stage: Cost.
- Attribute types: Slash, Strike, Ranged, Special, Wisdom.
- Effect / Trigger keywords: Blocker, Rush, Double Attack, On Play,
  When Attacking, Counter, Trigger (activated when revealed via life
  loss).
- Types: multi-word crew or organisation tags on Character/Leader
  cards, e.g. "Straw Hat Crew", "Navy", "Whitebeard Pirates".
- Set families: Booster Pack (OPxx), Starter Deck (STxx),
  Extra Booster (EBxx), Pre-Release (PRB01, etc), Promo, Manga Rare.
- Set/collector number: the set code plus "-" plus number, e.g.
  "OP01-001". Parallels of the same card use an alt printing key,
  never a distinct collector number.
- Treatments: Manga Art, Alternate Art (AA), Parallel, Special (SP),
  Secret Rare (SR), Full Art (FA), Character Rare, Treasure Rare (TR),
  Promo. Alternate Art and Manga Rare cannot always be distinguished
  from Parallel in the current ingest; treat them as related when
  data is ambiguous.
- Rarity terms: Common (C), Uncommon (UC), Rare (R), Super Rare (SR),
  Secret Rare (SEC), Leader Rare (L).

RESPONSE STYLE:
- Concise. Numeric answer first, then a short prose explanation.
- Link to canonical pages: /card/[slug], /set/[slug]/card/[cardSlug],
  /set/[slug], /colours/[colour], /leaders.
- If asked "will this card go up?" refuse to speculate; point at the
  price-history chart on the card page.
`.trim();

export const OP_SCHEMA_HINTS = {
  cards: {
    table: 'tcg_cards',
    game_id: 'onepiece',
    columns: {
      id:              'uuid PK',
      game_id:         "text = 'onepiece'",
      name:            'text',
      slug:            'text',
      set_id:          'text FK',
      rarity:          'text (Common/Uncommon/Rare/Super Rare/Secret Rare/Leader)',
      card_type:       'text (Leader/Character/Event/Stage/DON!!)',
      colour:          'text (comma-separated for dual-colour)',
      cost:            'int nullable (Character/Event/Stage)',
      power:           'int nullable (Leader/Character)',
      counter:         'int nullable (Character/Event)',
      life:            'int nullable (Leader only)',
      attribute:       'text (Slash/Strike/Ranged/Special/Wisdom) nullable',
      types:           'text[] (crew tags)',
      trigger_text:    'text nullable',
      effect_text:     'text nullable',
      language:        "text = 'en'",
    },
  },
  printings: {
    table: 'tcg_printings',
    columns: {
      id:               'uuid PK',
      tcg_card_id:      'uuid FK',
      set_id:           'text',
      collector_number: 'text - e.g. OP01-001',
      treatment:        'text nullable',
      finish:           'text nullable (foil / nonfoil / etc.)',
      language:         "text = 'en'",
      created_at:       'timestamptz',
    },
  },
  prices: {
    current: 'tcg_market_prices_current',
    daily:   'tcg_market_price_daily',
    graded_current: 'tcg_graded_prices_current',
    graded_daily:   'tcg_graded_price_daily',
  },
} as const;

export const OP_INTENTS = [
  'card_lookup',
  'price_lookup',
  'leader_summary',
  'colour_summary',
  'set_summary',
  'crew_summary',
  'treatment_disambiguation',
  'graded_lookup',
] as const;
export type OpIntent = (typeof OP_INTENTS)[number];

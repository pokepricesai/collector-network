// apps/yugioh/src/lib/ai-knowledge.ts
// Yu-Gi-Oh! game-knowledge module.
//
// Purpose: give any future AI feature accurate game vocabulary,
// column mapping and question-classification hints without hallucinating
// rules, prices or legality. Consumers of this module (chat, ask-ai,
// deck-copilot, semantic search) should compose their system prompt
// from these fragments rather than re-inventing the vocabulary.

export const YGO_SYSTEM_PROMPT = `
You are the YGOPrices assistant, a Yu-Gi-Oh! Trading Card Game specialist.

GROUND TRUTH RULES:
- Always defer to database-provided card facts. If the user asks about
  a specific card, cite the exact column values (rarity, set_id,
  collector_number, edition, treatment, etc.) rather than restating
  general knowledge.
- Never invent prices. Prices come from tcg_market_prices_current
  (retail) or tcg_graded_prices_current (graded). Currency is EUR
  today, source cardmarket, region EU.
- Never invent card legality unless the current banned/forbidden list
  is provided in context. Forbidden and Limited status is tracked at
  /forbidden-limited and lives on the card row.
- Yu-Gi-Oh! frames: monster (Normal, Effect, Ritual, Fusion, Synchro,
  Xyz, Pendulum, Link), spell (Normal, Continuous, Quick-Play,
  Equip, Field, Ritual), trap (Normal, Continuous, Counter).
- Levels apply to non-Xyz/non-Link monsters; Ranks apply to Xyz;
  Link Rating and Link Arrows apply to Link monsters; Pendulum Scale
  lives on the left/right of Pendulum monsters.
- Attribute: DARK, LIGHT, WATER, FIRE, EARTH, WIND, DIVINE.
- Type: Dragon, Warrior, Spellcaster, Fiend, Beast, etc.
- Rarity family: Common → Rare → Super Rare → Ultra Rare → Secret
  Rare → Ultimate → Ghost → Starlight → Quarter Century → Prismatic
  Secret. Region-specific rarities exist (Duel Terminal Parallel,
  Collectors, Platinum, etc). Do not conflate rarity with edition.
- Edition: 1st Edition vs Unlimited vs Limited Edition vs Duel
  Terminal. Rarity + edition combine to make a printing.
- Sets: booster (BLAR), structure deck (SDCB), tin (MP*), promotional
  (LDS*, LC*), tournament pack, duel terminal, etc.

RESPONSE STYLE:
- Concise. One or two paragraphs. Numeric answers first, prose second.
- Never invent citation URLs. Link only to pages the user is already on
  or to canonical /card/[slug] / /set/[slug] / /card/[slug]/printing/…
- If asked "should I buy X" or "will X go up", refuse to speculate and
  point them at the price-history chart on the card page.
`.trim();

// Column and table hints for future SQL-generation / semantic-search
// features. Everything here comes from packages/database's shared
// tcg_* schema; kept in the app so the AI system knows YGO-specific
// filtering intent (rarity family, forbidden/limited, etc).

export const YGO_SCHEMA_HINTS = {
  cards: {
    table: 'tcg_cards',
    game_id: 'ygo',
    columns: {
      id:                  'uuid, PK',
      game_id:             "text = 'ygo'",
      name:                'text',
      slug:                'text (lower-cased, hyphenated)',
      set_id:              'text FK -> tcg_sets.code',
      rarity:              'text (Common/Rare/…)',
      attribute:           'text (DARK/LIGHT/…) - monsters only',
      type:                'text (Dragon/Warrior/…) - monsters only',
      level:               'int - non-Xyz/non-Link monsters',
      rank:                'int - Xyz monsters only',
      link_rating:         'int - Link monsters only',
      atk:                 'int',
      def:                 'int',
      pendulum_scale_l:    'int',
      pendulum_scale_r:    'int',
      rules_text:          'text',
      frame:               'text (monster/spell/trap + subtype)',
      archetype:           'text nullable',
      forbidden_limited:   'text nullable (forbidden/limited/semi-limited)',
    },
  },
  printings: {
    table: 'tcg_printings',
    game_id: 'ygo',
    columns: {
      id:                'uuid PK',
      tcg_card_id:       'uuid FK',
      set_id:            'text',
      collector_number:  'text - the "PSV-EN038"-style code',
      edition:           "text ('1st_edition' | 'limited' | 'unlimited')",
      rarity:            'text - the printing rarity (can differ from card row)',
      treatment:         'text nullable',
      language:          "text = 'en'",
      created_at:        'timestamptz',
    },
  },
  prices: {
    current: {
      table: 'tcg_market_prices_current',
      note: 'One row per (printing, source, list_type, region, currency, finish).',
    },
    daily: {
      table: 'tcg_market_price_daily',
      note: 'Daily rollup used by the market/movers charts.',
    },
    graded_current: {
      table: 'tcg_graded_prices_current',
      note: 'One row per (printing OR card, grader, grade, currency).',
    },
    graded_daily: {
      table: 'tcg_graded_price_daily',
    },
  },
} as const;

// User-intent classifier hints for future intent-router. Not used yet.
export const YGO_INTENTS = [
  'card_lookup',                // "What is X?"
  'price_lookup',               // "How much is X?"
  'printing_lookup',            // "Which printing of X is this?"
  'set_summary',                // "What's in set Y?"
  'rarity_lookup',              // "What's Ghost Rare?"
  'archetype_lookup',           // "What archetype does X belong to?"
  'edition_disambiguation',     // "1st Ed vs Unlimited?"
  'movers',                     // "What went up this week?"
  'legality',                   // "Is X banned?"
  'graded_lookup',              // "PSA 10 X?"
  'collector_terminology',      // "What does Duel Terminal mean?"
] as const;
export type YgoIntent = (typeof YGO_INTENTS)[number];

// Refusal boilerplate for the assistant when asked things it must not
// answer with certainty.
export const YGO_REFUSALS = {
  price_prediction:
    "I don't predict future prices. Try the price-history chart on the card page for context.",
  legality_without_context:
    "The current forbidden/limited list changes; I check it live at /forbidden-limited.",
  medical_or_legal:
    "That's outside what I can help with — try a general search.",
};

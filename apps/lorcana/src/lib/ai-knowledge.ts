// apps/lorcana/src/lib/ai-knowledge.ts
// Disney Lorcana knowledge module.
//
// Purpose: ground future AI features in accurate Lorcana vocabulary
// and database column mapping. Reusable knowledge layer only.

export const LORCANA_SYSTEM_PROMPT = `
You are the LorcanaPrices assistant, a Disney Lorcana specialist.

GROUND TRUTH RULES:
- Card facts always come from the database. Cite exact column values.
- Never invent prices. Retail in tcg_market_prices_current, graded in
  tcg_graded_prices_current. Currency EUR from cardmarket, region EU.
- Six inks: Amber, Amethyst, Emerald, Ruby, Sapphire, Steel. Every
  card belongs to at least one ink; dual-ink cards exist in Chapter 8+.
- Card types: Character, Action, Item, Location, Song (a subtype of
  Action).
- Numeric stats:
    Character: Ink Cost, Strength, Willpower, Lore.
    Item: Ink Cost.
    Location: Ink Cost, Willpower, Move Cost, Lore.
    Action: Ink Cost.
- Inkable: bottom-of-frame indicator. Cards can be Inkable
  (contribute to inkwell) or Uninkable. Roughly ~80% of a set is
  inkable; the uninkable minority is often more chase-worthy.
- Classifications: multi-word tags on Character cards, e.g. "Hero",
  "Villain", "Prince", "Ally", "Sorcerer", "Titan".
- Card treatments (chase axis):
    Enchanted — 1:~432 replaced-common-slot, unique alt art.
    Iconic — Chapter 7+ ultra-rare with heavy overprint decor.
    Epic — Chapter 8+ variant tier.
    Legendary — pack-exclusive rarity above Rare/Super Rare.
    Promo — event / league / preview print, non-set-legal often.
- Finish axis: Foil or Nonfoil. Cold-foil is the default premium
  finish. Enchanted cards are always foil.
- Set families: numbered chapters (1..N) plus supplementary sets:
  "The First Chapter" (TFC / set 1), "Rise of the Floodborn" (ROF /
  set 2), "Into the Inklands" (ITI / set 3), "Ursula's Return" (URS
  / set 4), "Shimmering Skies" (SSK / set 5), "Azurite Sea" (AZS /
  set 6), "Archazia's Island" (ARC / set 7), "Fabled" (FAB / set 8),
  Illumineer's Trove and D23 promos exist as PD/D23 codes.
- Set/collector-number format is a plain digit e.g. "142" not a
  prefixed code. Version/subtitle disambiguates same-name characters
  (e.g. "Mickey Mouse - Brave Little Tailor" vs "Mickey Mouse -
  Detective").

RESPONSE STYLE:
- Concise. Numeric answer first, prose second.
- Link to canonical pages: /card/[slug], /set/[slug]/card/[cardSlug],
  /set/[slug], /inks/[ink], /market/enchanted, /market/iconic.
- Never speculate on price movement — point at the price-history
  chart on the card page.
- Note that Lorcana is a Disney × Ravensburger product; we are not
  affiliated with either.
`.trim();

export const LORCANA_SCHEMA_HINTS = {
  cards: {
    table: 'tcg_cards',
    game_id: 'lorcana',
    columns: {
      id:                'uuid PK',
      game_id:           "text = 'lorcana'",
      name:              'text (character name)',
      version:           'text nullable (subtitle - "Brave Little Tailor")',
      slug:              'text',
      set_id:            'text FK',
      rarity:            'text (Common / Uncommon / Rare / Super Rare / Legendary / Enchanted / Iconic / Epic / Promo)',
      card_type:         'text (Character / Action / Item / Location / Song)',
      ink:               'text[] (Amber / Amethyst / Emerald / Ruby / Sapphire / Steel)',
      ink_cost:          'int',
      strength:          'int nullable (Character)',
      willpower:         'int nullable (Character / Location)',
      lore:              'int nullable (Character / Location)',
      move_cost:         'int nullable (Location)',
      inkable:           'bool',
      classifications:   'text[] (Hero, Villain, Prince, Ally, …)',
      body_text:         'text nullable',
      flavor_text:       'text nullable',
      language:          "text = 'en'",
    },
  },
  printings: {
    table: 'tcg_printings',
    columns: {
      id:               'uuid PK',
      tcg_card_id:      'uuid FK',
      set_id:           'text',
      collector_number: 'text - just a digit e.g. "142"',
      treatment:        'text nullable (enchanted / iconic / epic / promo / null)',
      finish:           'text (foil / nonfoil)',
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

export const LORCANA_INTENTS = [
  'card_lookup',
  'price_lookup',
  'ink_summary',
  'set_summary',
  'treatment_lookup',      // "What's Enchanted?"
  'inkable_disambiguation',
  'classification_lookup',
  'graded_lookup',
] as const;
export type LorcanaIntent = (typeof LORCANA_INTENTS)[number];

#!/usr/bin/env node
// Finder-correctness audit. Answers:
//   1. Which stable identity key exists on YGO tcg_cards
//      (english_id vs tcggraph_card_id vs neither)?
//   2. How many DISTINCT identities exist versus tcg_cards rows?
//   3. What are the identity counts for the reported failure cases
//      (Blue-Eyes text search, archetype=Blue-Eyes, LIGHT+Dragon,
//      forbidden)?
//   4. Does the smart-query "LIGHT Dragon Level 4 1800+" genuinely
//      have zero matches at the DB level?
//   5. Sanity-check: does the current /card-finder implementation
//      truly show all identities in the base catalogue when the user
//      pages far enough?

process.env['BYPASS_YGO_CACHE'] = '1';

const { getYugiohClient } = await import('../src/server/read.ts');

const supabase = getYugiohClient();

// ── 1. Identity field coverage ────────────────────────────────────
async function coverage(field: string, description: string) {
  const total = await supabase
    .from('tcg_cards')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', 'ygo');
  const nonNull = await supabase
    .from('tcg_cards')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', 'ygo')
    .not(field, 'is', null);
  console.log(
    `  ${field.padEnd(20)}${(nonNull.count ?? 0).toString().padStart(6)} / ${(total.count ?? 0).toString().padStart(6)}  ${description}`,
  );
}

console.log('=== 1. Identity field coverage (nonNull / total ygo rows) ===');
await coverage('english_id', 'Konami passcode-ish key');
await coverage('tcggraph_card_id', 'TCGGraph cross-set identity');
await coverage('name', 'name (always present)');

// Distinct counts. Do this by scanning name/english_id/tcggraph_card_id
// via PostgREST — we cannot GROUP BY through PostgREST, so we page.
async function distinctCount(field: 'name' | 'english_id' | 'tcggraph_card_id') {
  const distinct = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const { data, error } = await supabase
      .from('tcg_cards')
      .select(field)
      .eq('game_id', 'ygo')
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data as Record<string, string | null>[] | null) ?? [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const v = r[field];
      if (v != null) distinct.add(v);
    }
    if (rows.length < PAGE) break;
  }
  return distinct.size;
}

console.log('\n=== 2. Distinct-value counts ===');
console.log(`  distinct(name)              = ${await distinctCount('name')}`);
console.log(`  distinct(english_id)        = ${await distinctCount('english_id')}`);
console.log(`  distinct(tcggraph_card_id)  = ${await distinctCount('tcggraph_card_id')}`);

// ── 3. Filter-specific identity counts ───────────────────────────
// For each of the reported failure cases, count both raw rows AND
// distinct identities. This exposes exactly how much of the 38,435
// number was misleading.
async function identityFor(
  label: string,
  build: (q: any) => any,
) {
  const CAP = 5000;
  const base = supabase
    .from('tcg_cards')
    .select('id, name, english_id, tcggraph_card_id', { count: 'exact' })
    .eq('game_id', 'ygo');
  const query = build(base).range(0, CAP - 1);
  const { data, error, count } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  const rows =
    (data as {
      id: string;
      name: string;
      english_id: string | null;
      tcggraph_card_id: string | null;
    }[] | null) ?? [];
  const names = new Set<string>();
  const englishIds = new Set<string>();
  const tcggraphIds = new Set<string>();
  for (const r of rows) {
    names.add(r.name);
    if (r.english_id) englishIds.add(r.english_id);
    if (r.tcggraph_card_id) tcggraphIds.add(r.tcggraph_card_id);
  }
  console.log(
    `  ${label.padEnd(38)} rawRows=${(count ?? 0).toString().padStart(6)}  distinctName=${names.size.toString().padStart(5)}  distinctEnglishId=${englishIds.size.toString().padStart(5)}  distinctTcggraphId=${tcggraphIds.size.toString().padStart(5)}`,
  );
}

console.log('\n=== 3. Filter cases: raw rows vs distinct identities ===');
await identityFor('base (all ygo)', (q: any) => q);
await identityFor('q=Blue-Eyes (name ILIKE %blue-eyes%)', (q: any) =>
  q.eq('game_id', 'ygo').ilike('name', '%Blue-Eyes%'),
);
await identityFor('archetype=Blue-Eyes', (q: any) =>
  q
    .filter('gamedata->archetypes', 'cs', JSON.stringify(['Blue-Eyes'])),
);
await identityFor('rarity=Starlight Rare', (q: any) =>
  q.eq('game_id', 'ygo').eq('rarity', 'Starlight Rare'),
);
await identityFor('attribute=LIGHT + race=Dragon', (q: any) =>
  q
    .filter('gamedata->>attribute', 'eq', 'LIGHT')
    .filter('gamedata->>race', 'eq', 'Dragon'),
);
await identityFor('fnl=forbidden', (q: any) =>
  q.eq('game_id', 'ygo').filter('gamedata->banlist->>tcg', 'eq', 'forbidden'),
);
await identityFor(
  'LIGHT + Dragon + level=4 + atk>=1800',
  (q: any) =>
    q
      .filter('gamedata->>attribute', 'eq', 'LIGHT')
      .filter('gamedata->>race', 'eq', 'Dragon')
      .filter('gamedata->>level', 'eq', '4')
      .filter('gamedata->atk', 'gte', '1800'),
);
await identityFor('LIGHT + Dragon + level=4', (q: any) =>
  q
    .filter('gamedata->>attribute', 'eq', 'LIGHT')
    .filter('gamedata->>race', 'eq', 'Dragon')
    .filter('gamedata->>level', 'eq', '4'),
);
await identityFor('LIGHT + Dragon + atk>=1800', (q: any) =>
  q
    .filter('gamedata->>attribute', 'eq', 'LIGHT')
    .filter('gamedata->>race', 'eq', 'Dragon')
    .filter('gamedata->atk', 'gte', '1800'),
);
await identityFor('Dragon + level=4', (q: any) =>
  q
    .filter('gamedata->>race', 'eq', 'Dragon')
    .filter('gamedata->>level', 'eq', '4'),
);

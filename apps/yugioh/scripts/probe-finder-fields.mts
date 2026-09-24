#!/usr/bin/env node
// Slice B probe: enumerate the JSONB paths inside tcg_cards.gamedata
// so the Card Finder only builds filters we know exist and only
// exposes filter values that actually appear in production.

process.env['BYPASS_YGO_CACHE'] = '1';

const { getYugiohClient } = await import('../src/server/read.ts');

const supabase = getYugiohClient();

// Small sample — we only need shape confirmation.
const { data: sample, error } = await supabase
  .from('tcg_cards')
  .select('id,name,rarity,collector_number,set_id,gamedata')
  .eq('game_id', 'ygo')
  .not('gamedata', 'is', null)
  .limit(5);
if (error) throw new Error(error.message);
console.log('=== SAMPLE gamedata rows ===');
for (const c of sample ?? []) {
  console.log(`\n${c.name} — rarity=${c.rarity ?? '—'}  #${c.collector_number ?? '—'}`);
  console.log(JSON.stringify(c.gamedata, null, 2));
}

// Distinct values that matter for filter dropdowns.
async function distinctJsonScalar(path: string, label: string) {
  // PostgREST doesn't do distinct nicely; hammer a modest sample.
  const { data, error } = await supabase
    .from('tcg_cards')
    .select(`gamedata`)
    .eq('game_id', 'ygo')
    .not('gamedata', 'is', null)
    .limit(3000);
  if (error) throw new Error(error.message);
  const values = new Map<string, number>();
  for (const row of data ?? []) {
    const gd = (row as any).gamedata;
    if (!gd) continue;
    const value = path.split('.').reduce((acc: any, key) => acc?.[key], gd);
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        const k = String(v);
        values.set(k, (values.get(k) ?? 0) + 1);
      }
    } else {
      const k = String(value);
      values.set(k, (values.get(k) ?? 0) + 1);
    }
  }
  const sorted = [...values.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n[distinct ${label}] top 20 (of ${values.size}):`);
  for (const [k, c] of sorted.slice(0, 20))
    console.log(`  ${String(c).padStart(4)}× ${k}`);
}

console.log('\n=== distinct scalar values across a 3000-row sample ===');
await distinctJsonScalar('frameType', 'frameType');
await distinctJsonScalar('attribute', 'attribute');
await distinctJsonScalar('race', 'race (monster type)');
await distinctJsonScalar('level', 'level');
await distinctJsonScalar('rank', 'rank');
await distinctJsonScalar('linkRating', 'linkRating');
await distinctJsonScalar('banlist.tcg', 'banlist.tcg');
await distinctJsonScalar('banlist.ocg', 'banlist.ocg');

// Attack/defence — just confirm presence + describe range.
const { data: statsRows, error: statsError } = await supabase
  .from('tcg_cards')
  .select('gamedata')
  .eq('game_id', 'ygo')
  .not('gamedata', 'is', null)
  .limit(3000);
if (!statsError && statsRows) {
  const atk: number[] = [];
  const def: number[] = [];
  for (const r of statsRows) {
    const gd = (r as any).gamedata ?? {};
    if (typeof gd.atk === 'number') atk.push(gd.atk);
    if (typeof gd.def === 'number') def.push(gd.def);
  }
  atk.sort((a, b) => a - b);
  def.sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p)];
  if (atk.length) {
    console.log(
      `\n[ATK] n=${atk.length}  min=${atk[0]} p25=${pct(atk, 0.25)} median=${pct(atk, 0.5)} p75=${pct(atk, 0.75)} max=${atk.at(-1)}`,
    );
  }
  if (def.length) {
    console.log(
      `[DEF] n=${def.length}  min=${def[0]} p25=${pct(def, 0.25)} median=${pct(def, 0.5)} p75=${pct(def, 0.75)} max=${def.at(-1)}`,
    );
  }
}

// Archetypes — commonly used JSONB array. Confirm count + top archetypes.
console.log('\n[archetypes] top 20 arrays across the sample:');
const { data: aRows, error: aErr } = await supabase
  .from('tcg_cards')
  .select('gamedata')
  .eq('game_id', 'ygo')
  .not('gamedata', 'is', null)
  .limit(5000);
if (!aErr) {
  const counts = new Map<string, number>();
  for (const r of aRows ?? []) {
    const gd = (r as any).gamedata ?? {};
    const arcs = Array.isArray(gd.archetypes) ? gd.archetypes : [];
    for (const a of arcs) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [k, c] of top) console.log(`  ${String(c).padStart(4)}× ${k}`);
  console.log(`  … total distinct archetypes in sample: ${counts.size}`);
}

// Total ygo card count for context.
const { count } = await supabase
  .from('tcg_cards')
  .select('id', { count: 'exact', head: true })
  .eq('game_id', 'ygo');
console.log(`\nTotal ygo tcg_cards rows in production: ${count}`);

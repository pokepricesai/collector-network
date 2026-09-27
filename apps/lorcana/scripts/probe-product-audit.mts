#!/usr/bin/env node
// Product-audit probe for the design/QA pass. Answers the questions we
// need before making product decisions:
//   * image host + null-image rate
//   * printings-per-card histogram
//   * chase rarity distribution per set
//   * history window per set (how many days of daily retail rows)
//   * graded distribution and freshness
//   * classification frequency (for filter facets)
//   * cardType distribution
//   * price range per set
//
// Read-only. Anon SELECT.

const { createTcgClient } = await import(
  '../../../packages/database/src/client.ts'
);

const GAME_ID = 'lorcana';

interface Row { [k: string]: unknown }

function hr(t: string) { console.log(`\n${'═'.repeat(72)}\n${t}\n${'═'.repeat(72)}`); }
function sub(t: string) { console.log(`\n─── ${t} ───`); }
function fmt(n: number): string { return new Intl.NumberFormat('en-US').format(n); }

async function fetchAll(supabase: ReturnType<typeof createTcgClient>, table: string, select: string, gameFilter = true, pageSize = 1000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 500_000; from += pageSize) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (gameFilter) q = q.eq('game_id', GAME_ID);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data as Row[] | null) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

async function main() {
  if (!process.env['SUPABASE_URL']) { console.error('missing env'); process.exit(1); }
  const supabase = createTcgClient();

  hr('A · Card image coverage');
  const cards = await fetchAll(supabase, 'tcg_cards', 'id, name, rarity, set_id, collector_number, images, gamedata');
  const hasImg = cards.filter((c) => c['images'] != null).length;
  const nullImg = cards.length - hasImg;
  console.log(`  total cards:        ${fmt(cards.length)}`);
  console.log(`  with images:        ${fmt(hasImg)} (${((hasImg/cards.length)*100).toFixed(1)}%)`);
  console.log(`  null images:        ${fmt(nullImg)}`);

  const hosts = new Map<string, number>();
  let sampledUrls = 0;
  for (const c of cards) {
    const img = c['images'] as Record<string, unknown> | null;
    if (!img) continue;
    for (const v of Object.values(img)) {
      if (typeof v !== 'string') continue;
      try {
        const url = new URL(v);
        hosts.set(url.hostname, (hosts.get(url.hostname) ?? 0) + 1);
        sampledUrls++;
      } catch { /* ignore */ }
    }
  }
  sub('image hostnames');
  for (const [h, n] of [...hosts.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${h.padEnd(40)} ${fmt(n).padStart(6)}`);
  console.log(`  total urls sampled: ${fmt(sampledUrls)}`);

  sub('sample of 5 images');
  for (const c of cards.slice(0, 5)) {
    console.log(`  ${c['name']}  →  ${JSON.stringify(c['images']).slice(0, 200)}`);
  }

  hr('B · Printings per card');
  const printings = await fetchAll(supabase, 'tcg_printings', 'id, tcg_card_id, finish, edition, tcggraph_printing_key');
  const printingsByCard = new Map<string, number>();
  for (const p of printings) {
    const k = String(p['tcg_card_id']);
    printingsByCard.set(k, (printingsByCard.get(k) ?? 0) + 1);
  }
  const printCountBuckets = new Map<number, number>();
  for (const n of printingsByCard.values()) printCountBuckets.set(n, (printCountBuckets.get(n) ?? 0) + 1);
  for (const [n, count] of [...printCountBuckets.entries()].sort((a,b)=>a[0]-b[0])) {
    console.log(`  ${n} printing(s)  →  ${fmt(count)} cards`);
  }
  // Cards with only ONE finish (foil OR nonfoil, not both) — these need
  // handled gracefully in printing panels.
  const onePrintCards = [...printingsByCard.entries()].filter(([,n]) => n === 1);
  console.log(`  cards with single printing: ${fmt(onePrintCards.length)} (${((onePrintCards.length/cards.length)*100).toFixed(1)}%)`);

  hr('C · Rarity distribution overall + top-set chase counts');
  const rarityCount = new Map<string, number>();
  for (const c of cards) rarityCount.set(String(c['rarity']), (rarityCount.get(String(c['rarity'])) ?? 0) + 1);
  for (const [r, n] of [...rarityCount.entries()].sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${r.padEnd(14)}  ${fmt(n).padStart(6)}`);
  }

  // Chase per set
  sub('chase counts per set (Enchanted / Iconic / Epic / Legendary / Promo)');
  const sets = await fetchAll(supabase, 'tcg_sets', 'id, code, name, released_at');
  const setsById = new Map(sets.map(s => [String(s['id']), s]));
  const bySet = new Map<string, Row[]>();
  for (const c of cards) {
    const k = String(c['set_id']);
    if (!bySet.has(k)) bySet.set(k, []);
    bySet.get(k)!.push(c);
  }
  const sortedSets = [...bySet.entries()].sort((a,b) => {
    const ra = setsById.get(a[0])?.['released_at'] as string | undefined;
    const rb = setsById.get(b[0])?.['released_at'] as string | undefined;
    return (rb ?? '').localeCompare(ra ?? '');
  });
  console.log(`  ${'code'.padEnd(9)} ${'name'.padEnd(38)} ${'total'.padStart(6)} ${'EN'.padStart(4)} ${'IC'.padStart(4)} ${'EP'.padStart(4)} ${'LEG'.padStart(4)} ${'PR'.padStart(4)}`);
  for (const [sid, list] of sortedSets) {
    const s = setsById.get(sid);
    const counts: Record<string, number> = {};
    for (const c of list) counts[String(c['rarity'])] = (counts[String(c['rarity'])] ?? 0) + 1;
    console.log(`  ${String(s?.['code'] ?? '?').padEnd(9)} ${String(s?.['name'] ?? '?').slice(0,38).padEnd(38)} ${fmt(list.length).padStart(6)} ${fmt(counts['Enchanted'] ?? 0).padStart(4)} ${fmt(counts['Iconic'] ?? 0).padStart(4)} ${fmt(counts['Epic'] ?? 0).padStart(4)} ${fmt(counts['Legendary'] ?? 0).padStart(4)} ${fmt(counts['Promo'] ?? 0).padStart(4)}`);
  }

  hr('D · Daily retail history window per game_id');
  const { data: dailySample, error: dailyErr } = await supabase
    .from('tcg_market_price_daily')
    .select('observed_on')
    .eq('game_id', GAME_ID)
    .order('observed_on', { ascending: true })
    .limit(1);
  if (dailyErr) console.log('  err', dailyErr.message);
  const { data: dailyLatest } = await supabase
    .from('tcg_market_price_daily')
    .select('observed_on')
    .eq('game_id', GAME_ID)
    .order('observed_on', { ascending: false })
    .limit(1);
  console.log(`  earliest observed_on: ${dailySample?.[0]?.['observed_on']}`);
  console.log(`  latest observed_on:   ${dailyLatest?.[0]?.['observed_on']}`);

  // Days of coverage
  const first = dailySample?.[0]?.['observed_on'] as string | undefined;
  const last = dailyLatest?.[0]?.['observed_on'] as string | undefined;
  if (first && last) {
    const days = Math.round((Date.parse(last) - Date.parse(first)) / (1000*60*60*24)) + 1;
    console.log(`  window: ${days} days`);
  }

  hr('E · Ink distribution + inkable/uninkable + cardType');
  const inkCount = new Map<string, number>();
  const typeCount = new Map<string, number>();
  let inkableYes = 0, inkableNo = 0, inkableNull = 0;
  for (const c of cards) {
    const gd = c['gamedata'] as Record<string, unknown> | null;
    if (!gd) continue;
    const ink = String(gd['ink'] ?? '');
    inkCount.set(ink, (inkCount.get(ink) ?? 0) + 1);
    const type = String(gd['cardType'] ?? '');
    typeCount.set(type, (typeCount.get(type) ?? 0) + 1);
    if (gd['inkable'] === true) inkableYes++;
    else if (gd['inkable'] === false) inkableNo++;
    else inkableNull++;
  }
  sub('ink');
  for (const [k, n] of [...inkCount.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(14)} ${fmt(n).padStart(6)}`);
  sub('cardType');
  for (const [k, n] of [...typeCount.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(20)} ${fmt(n).padStart(6)}`);
  sub('inkable');
  console.log(`  true:  ${fmt(inkableYes)}`);
  console.log(`  false: ${fmt(inkableNo)}`);
  console.log(`  null:  ${fmt(inkableNull)}`);

  hr('F · Classifications frequency (top 40)');
  const classCount = new Map<string, number>();
  for (const c of cards) {
    const gd = c['gamedata'] as Record<string, unknown> | null;
    if (!gd) continue;
    const arr = gd['classifications'];
    if (!Array.isArray(arr)) continue;
    for (const c2 of arr) classCount.set(String(c2), (classCount.get(String(c2)) ?? 0) + 1);
  }
  const top40 = [...classCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 40);
  for (const [k, n] of top40) console.log(`  ${k.padEnd(24)} ${fmt(n).padStart(6)}`);
  console.log(`  total distinct classifications: ${classCount.size}`);

  hr('G · Retail freshness');
  const { data: retailSample } = await supabase
    .from('tcg_market_prices_current')
    .select('updated_at')
    .eq('game_id', GAME_ID)
    .order('updated_at', { ascending: false })
    .limit(1);
  console.log(`  newest retail updated_at: ${retailSample?.[0]?.['updated_at']}`);
  const { data: retailOldest } = await supabase
    .from('tcg_market_prices_current')
    .select('updated_at')
    .eq('game_id', GAME_ID)
    .order('updated_at', { ascending: true })
    .limit(1);
  console.log(`  oldest retail updated_at: ${retailOldest?.[0]?.['updated_at']}`);

  hr('H · Graded distribution');
  const graded = await fetchAll(supabase, 'tcg_graded_prices_current', 'tcg_card_id, tcg_printing_id, grader, grade, attribution, price, updated_at, currency');
  console.log(`  total graded rows: ${fmt(graded.length)}`);
  const cardIdsWithGraded = new Set(graded.map(g => String(g['tcg_card_id'])));
  console.log(`  distinct cards with graded row: ${fmt(cardIdsWithGraded.size)} (${((cardIdsWithGraded.size/cards.length)*100).toFixed(1)}% of cards)`);
  const graderDist = new Map<string, number>();
  for (const g of graded) graderDist.set(String(g['grader']), (graderDist.get(String(g['grader'])) ?? 0) + 1);
  for (const [k, n] of [...graderDist.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(10)} ${fmt(n).padStart(6)}`);

  hr('DONE');
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });

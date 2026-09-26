// Product-parity audit probe (v2, real schema).
//
// Answers:
//   1) tcg_cards.images shape for OP — is a preview/sample URL being
//      served where a clean production URL should be?
//   2) tcg_sets metadata coverage — logos, release dates, TCGGraph meta.
//   3) tcg_graded_price_current coverage — counts per grader, sample rows.

import { createClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL'];
const anon = process.env['SUPABASE_ANON_KEY'];
if (!url || !anon) throw new Error('missing supabase env');
const supabase = createClient(url, anon);
const banner = (s: string) => console.log('\n=== ' + s + ' ===');

async function main() {
  banner('0. Resolve OP game_id');
  const games = await supabase.from('tcg_games').select('id, slug, name');
  if (games.error) throw games.error;
  const op = games.data?.find((g) => g.slug === 'one-piece' || g.id === 'onepiece');
  console.log('games:', games.data);
  if (!op) throw new Error('no one-piece game');
  const opId = op.id;
  console.log('OP game_id =', opId);

  banner('1. OP card sample across sets — full images JSON');
  const sampleSets = ['op01', 'op11', 'eb01', 'st01', 'oppr'];
  const opSets = await supabase
    .from('tcg_sets')
    .select('id, code, name')
    .eq('game_id', opId)
    .in('code', sampleSets);
  for (const s of opSets.data ?? []) {
    const cards = await supabase
      .from('tcg_cards')
      .select('name, collector_number, images')
      .eq('game_id', opId)
      .eq('set_id', s.id)
      .order('collector_number', { ascending: true })
      .limit(2);
    console.log(`--- ${s.code} (${s.name}) ---`);
    for (const c of cards.data ?? []) {
      console.log(`  ${c.collector_number} ${c.name}`);
      console.log('    images =', JSON.stringify(c.images));
    }
  }

  banner('2. images JSON keys — frequency across OP');
  const opRows = await supabase
    .from('tcg_cards')
    .select('images')
    .eq('game_id', opId)
    .limit(5000);
  const keyCount = new Map<string, number>();
  let hasSample = 0;
  const flagged: Array<{ url: string; key: string }> = [];
  for (const row of opRows.data ?? []) {
    const img = row.images as Record<string, unknown> | null;
    if (img && typeof img === 'object') {
      for (const [k, v] of Object.entries(img)) {
        keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
        if (typeof v === 'string' && /sample|preview|watermark|_sample|-sample/i.test(v)) {
          hasSample++;
          if (flagged.length < 8) flagged.push({ url: v, key: k });
        }
      }
    }
  }
  console.log(`sampled ${opRows.data?.length ?? 0} OP rows`);
  console.log('keys:', [...keyCount.entries()].sort((a, b) => b[1] - a[1]));
  console.log(`URLs matching sample/preview/watermark: ${hasSample}`);
  for (const f of flagged) console.log('   ', f.key, '=>', f.url);

  banner('3. Cross-game images shape');
  for (const slug of ['yugioh', 'mtg', 'lorcana', 'pokemon']) {
    const g = games.data?.find((x) => x.slug === slug);
    if (!g) continue;
    const r = await supabase
      .from('tcg_cards')
      .select('name, images')
      .eq('game_id', g.id)
      .limit(1);
    console.log(`--- ${slug} ---`);
    for (const row of r.data ?? []) {
      console.log('  ', row.name, '=>', JSON.stringify(row.images));
    }
  }

  banner('4. All OP sets — release_date + tcggraph_meta keys + card_count');
  const allSets = await supabase
    .from('tcg_sets')
    .select('id, code, name, released_at, tcggraph_meta, updated_at')
    .eq('game_id', opId)
    .order('released_at', { ascending: false, nullsFirst: false });
  for (const s of allSets.data ?? []) {
    const cardCount = await supabase
      .from('tcg_cards')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', opId)
      .eq('set_id', s.id);
    const metaKeys = s.tcggraph_meta ? Object.keys(s.tcggraph_meta) : [];
    console.log(
      `${s.code}\t${s.name}\treleased=${s.released_at}\tcards=${cardCount.count}\tmeta_keys=${metaKeys.join(',')}`,
    );
  }

  banner('5. tcggraph_meta — full shape for op01, op11, eb01');
  for (const code of ['op01', 'op11', 'eb01']) {
    const r = await supabase
      .from('tcg_sets')
      .select('code, tcggraph_meta')
      .eq('game_id', opId)
      .eq('code', code)
      .maybeSingle();
    console.log(`--- ${code} ---`);
    console.log(JSON.stringify(r.data?.tcggraph_meta, null, 2));
  }

  banner('6. Graded coverage — counts per grader (OP)');
  for (const g of ['PSA', 'BGS', 'CGC', 'SGC']) {
    const r = await supabase
      .from('tcg_graded_price_current')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', opId)
      .eq('grader', g);
    console.log(`  ${g}: ${r.count}`);
  }
  const totalGraded = await supabase
    .from('tcg_graded_price_current')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', opId);
  console.log('  TOTAL:', totalGraded.count);

  banner('7. Distinct printings with ≥3 graded rows — sample 25');
  const gradedRows = await supabase
    .from('tcg_graded_price_current')
    .select('tcg_printing_id, tcg_card_id, grader, grade, price, updated_at, attribution')
    .eq('game_id', opId)
    .not('price', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(400);
  const byPrinting = new Map<string, number>();
  for (const g of gradedRows.data ?? []) {
    const k = g.tcg_printing_id ?? g.tcg_card_id ?? '';
    byPrinting.set(k, (byPrinting.get(k) ?? 0) + 1);
  }
  const printingsWith3 = [...byPrinting.entries()]
    .filter(([, c]) => c >= 3)
    .slice(0, 25);
  console.log(`  distinct anchors with >=3 grades in latest 400: ${printingsWith3.length}`);
  for (const [pid, c] of printingsWith3) {
    // Resolve printing → card → set / name
    const printing = await supabase
      .from('tcg_printings')
      .select('id, tcg_card_id, set_id, finish, edition')
      .eq('id', pid)
      .maybeSingle();
    if (printing.data) {
      const card = await supabase
        .from('tcg_cards')
        .select('name, collector_number, rarity, set_id')
        .eq('id', printing.data.tcg_card_id)
        .maybeSingle();
      const setRow = await supabase
        .from('tcg_sets')
        .select('code')
        .eq('id', printing.data.set_id)
        .maybeSingle();
      console.log(
        `    ${setRow.data?.code} ${card.data?.collector_number} ${card.data?.name} (${card.data?.rarity}) ${printing.data.finish ?? ''} ${printing.data.edition ?? ''} — ${c} grades`,
      );
    } else {
      // Anchor is a card_id (attribution='card')
      const card = await supabase
        .from('tcg_cards')
        .select('name, collector_number, rarity, set_id')
        .eq('id', pid)
        .maybeSingle();
      if (card.data) {
        const setRow = await supabase
          .from('tcg_sets')
          .select('code')
          .eq('id', card.data.set_id)
          .maybeSingle();
        console.log(
          `    [card-attr] ${setRow.data?.code} ${card.data.collector_number} ${card.data.name} (${card.data.rarity}) — ${c} grades`,
        );
      }
    }
  }

  banner('8. Retail freshness — latest updated_at per source');
  const retail = await supabase
    .from('tcg_market_price_current')
    .select('source, updated_at')
    .eq('game_id', opId)
    .order('updated_at', { ascending: false })
    .limit(6);
  for (const r of retail.data ?? []) console.log(`  ${r.source}\t${r.updated_at}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

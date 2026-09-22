#!/usr/bin/env node
// Slice 3 acceptance proof: Blue-Eyes White Dragon travels end-to-end
// Supabase → @collector-network/database → @collector-network/market-data
// → apps/yugioh server layer.
//
// Run: pnpm --filter @collector-network/yugioh audit:blue-eyes
// Requires apps/yugioh/.env.local with SUPABASE_URL + SUPABASE_ANON_KEY.

import {
  getYugiohCardBundleByName,
  getYugiohClient,
  getYugiohGame,
} from '../src/server/read.ts';

async function main() {
  const supabase = getYugiohClient();

  const game = await getYugiohGame(supabase);
  if (!game) {
    console.error('FAIL: could not resolve YGO game row via slug=yugioh');
    process.exit(1);
  }
  console.log(`game: ${game.name} (id=${game.id}, slug=${game.slug})`);

  const bundle = await getYugiohCardBundleByName('Blue-Eyes White Dragon', supabase);
  if (!bundle) {
    console.error('FAIL: no Blue-Eyes White Dragon found');
    process.exit(1);
  }

  console.log(`\nname: ${bundle.name}`);
  console.log(`tcg_cards rows: ${bundle.cards.length}`);

  // Show a representative slice — LOB-001 (vintage) if it exists, plus BLMM
  // (modern chase), plus the first 3 by set for orientation.
  const highlights = new Set<string>();
  const lob = bundle.cards.find((c) => c.card.collector_number === 'LOB-001');
  const blmm = bundle.cards.find((c) => c.card.collector_number === 'BLMM-EN001');
  if (lob) highlights.add(lob.card.id);
  if (blmm) highlights.add(blmm.card.id);
  for (const c of bundle.cards.slice(0, 3)) highlights.add(c.card.id);

  const shown = bundle.cards.filter((c) => highlights.has(c.card.id));
  for (const view of shown) {
    console.log(`\n--- ${view.card.collector_number} · ${view.card.rarity ?? '(no rarity)'} ---`);
    console.log(
      `  card_id=${view.card.id} set=${view.set?.code ?? view.card.set_id} released=${view.set?.released_at ?? '?'}`,
    );
    const gd = view.gamedata;
    console.log(
      `  gamedata: ATK ${gd.atk}/DEF ${gd.def}, ${gd.attribute}, ${gd.race}, Level ${gd.level}, archetypes=${gd.archetypes.join(',')}, banlist tcg=${gd.banlist?.tcg ?? '?'}`,
    );
    console.log(`  printings: ${view.printings.length}`);
    for (const p of view.printings) {
      const marketLine = p.pricing.market
        .map(
          (m) =>
            `${m.source} ${m.currency} ${m.price ?? '-'} (low ${m.priceLow ?? '-'}) @ ${m.updatedAt.slice(0, 10)}`,
        )
        .join(' | ');
      const rawLine = p.pricing.raw
        .map((r) => `raw ${r.grade} ${r.currency} ${r.price ?? '-'} vol=${r.cardSalesVolume ?? '-'}`)
        .join(' | ');
      const gradedLine = p.pricing.graded
        .map((g) => `${g.grader} ${g.grade} ${g.currency} ${g.price ?? '-'}`)
        .join(' | ');
      console.log(
        `    · ${p.editionLabel} lang=${p.printing.language} finish=${p.printing.finish ?? '(null)'} → ${p.printing.id}`,
      );
      if (marketLine) console.log(`         market: ${marketLine}`);
      if (rawLine) console.log(`         raw:    ${rawLine}`);
      if (gradedLine) console.log(`         graded: ${gradedLine}`);
      if (!marketLine && !rawLine && !gradedLine) {
        console.log(`         (no pricing data)`);
      }
    }
  }

  const totalPrintings = bundle.cards.reduce((n, c) => n + c.printings.length, 0);
  const totalMarketQuotes = bundle.cards.reduce(
    (n, c) => n + c.printings.reduce((m, p) => m + p.pricing.market.length, 0),
    0,
  );
  const totalRawObs = bundle.cards.reduce(
    (n, c) => n + c.printings.reduce((m, p) => m + p.pricing.raw.length, 0),
    0,
  );
  const totalGraded = bundle.cards.reduce(
    (n, c) => n + c.printings.reduce((m, p) => m + p.pricing.graded.length, 0),
    0,
  );

  console.log(
    `\nOK: bundle for '${bundle.name}': ${bundle.cards.length} card rows, ${totalPrintings} printings, ${totalMarketQuotes} retail quotes, ${totalRawObs} raw obs, ${totalGraded} graded quotes.`,
  );
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

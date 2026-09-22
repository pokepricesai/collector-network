#!/usr/bin/env node
// Slice 5 audit: fetches the same live payload the homepage renders,
// prints safe counts/examples. No credentials in output. No giant
// JSON dumps.
//
// Run: pnpm --filter @collector-network/yugioh audit:homepage

import { getYugiohHomepageData } from '../src/server/homepage.ts';
import { search } from '../src/server/search.ts';

async function main() {
  console.log('=== Homepage payload ===');
  const payload = await getYugiohHomepageData();
  console.log(`fetched at: ${payload.fetchedAt}`);
  console.log(`errors: ${payload.errors.length}`);
  for (const e of payload.errors) console.log(`  ! ${e}`);

  console.log(`\niconic families: ${payload.iconicCards.length}`);
  for (const f of payload.iconicCards) {
    const priceRange =
      f.usdPriceLow != null && f.usdPriceHigh != null
        ? `$${Math.round(f.usdPriceLow)}-$${Math.round(f.usdPriceHigh)} USD`
        : '(no USD)';
    console.log(
      `  · ${f.name} — ${f.totalPrintings} printings, ${f.rarityRange.length} rarities, ${priceRange}`,
    );
  }

  console.log(`\nlatest sets: ${payload.latestSets.length}`);
  for (const s of payload.latestSets) {
    console.log(
      `  · ${s.set.code.toUpperCase()} — ${s.set.name} — released ${s.set.released_at ?? '?'} — ${s.cardCount ?? '?'} cards`,
    );
  }

  console.log(`\nmost valuable (retail USD): ${payload.mostValuable.length}`);
  for (const m of payload.mostValuable) {
    console.log(
      `  · ${m.card?.name ?? '(unknown)'} — ${m.card?.collector_number ?? '?'} — $${m.quote.price?.toLocaleString('en-US')} ${m.quote.currency}`,
    );
  }

  console.log(`\ngraded highlights (post-2018, grade 10 only): ${payload.gradedHighlights.length}`);
  for (const g of payload.gradedHighlights) {
    console.log(
      `  · ${g.card.name} — ${g.printing.collector_number} ${g.card.rarity ?? ''} — ${g.quote.grader.toUpperCase()} ${g.quote.grade} — $${g.quote.price?.toLocaleString('en-US')} ${g.quote.currency}`,
    );
  }

  console.log(`\nrarity discovery: ${payload.rarityDiscovery.length}`);
  for (const r of payload.rarityDiscovery) {
    console.log(
      `  · ${r.rarity} — ${r.totalCards.toLocaleString('en-US')} cards — e.g. ${r.exampleCards.map((c) => c.name).join(', ')}`,
    );
  }

  console.log('\n=== Search probes ===');
  const queries = ['blue-eyes', 'LOB-001', 'sky striker', 'ghost rare', 'blue eye'];
  for (const q of queries) {
    const r = await search(q);
    console.log(
      `  q='${q}' → interpreted as ${r.interpretedAs}, ${r.results.length} results, ${r.serverMs}ms, ${r.totalCardsScanned} rows scanned`,
    );
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

#!/usr/bin/env node
// Slice 8 verification. Sanity-checks the market + F&L composition
// helpers against production data without hitting the HTTP layer.

process.env['BYPASS_YGO_CACHE'] = '1';

const {
  VINTAGE_CUTOFF,
  getYugiohMarketHomeData,
  getYugiohMostValuableGraded,
  getYugiohMostValuableRetail,
  getYugiohVintageMostValuable,
} = await import('../src/server/market.ts');
const { getYugiohForbiddenLimited } = await import('../src/server/fnl.ts');

async function main() {
  console.log('=== Slice 8 verification: market + F&L ===\n');

  // ── Market home ──────────────────────────────────────────────
  const home = await getYugiohMarketHomeData();
  console.log(`market home             :`);
  console.log(`  topRetailUsd          : ${home.topRetailUsd.length}`);
  console.log(`  topRetailEur          : ${home.topRetailEur.length}`);
  console.log(`  topGraded             : ${home.topGraded.length}`);
  console.log(`  topVintage            : ${home.topVintage.length}`);
  console.log(`  errors                : ${home.errors.length}`);
  for (const e of home.errors) console.log(`    - ${e}`);
  if (home.topRetailUsd[0]) {
    const t = home.topRetailUsd[0];
    console.log(
      `  usd leader            : ${t.card.name} / ${t.set?.code ?? '—'} / $${t.quote.price}`,
    );
  }
  if (home.topGraded[0]) {
    const g = home.topGraded[0];
    console.log(
      `  graded leader         : ${g.card.name} / ${g.quote.grader} ${g.quote.grade} / $${g.quote.price}`,
    );
  }

  // ── /market/most-valuable ─────────────────────────────────────
  const rankingUsd = await getYugiohMostValuableRetail({
    currency: 'USD',
    limit: 100,
  });
  const rankingEur = await getYugiohMostValuableRetail({
    currency: 'EUR',
    limit: 100,
  });
  console.log(`\n/market/most-valuable    :`);
  console.log(`  usd rows              : ${rankingUsd.length}`);
  console.log(`  eur rows              : ${rankingEur.length}`);

  // Rank invariant: prices must be monotonically non-increasing
  let usdBroken = 0;
  for (let i = 1; i < rankingUsd.length; i++) {
    const prev = rankingUsd[i - 1]!.quote.price ?? -Infinity;
    const cur = rankingUsd[i]!.quote.price ?? Infinity;
    if (cur > prev) usdBroken++;
  }
  console.log(`  usd rank monotonicity : ${usdBroken === 0 ? 'OK' : `${usdBroken} inversions`}`);
  if (usdBroken > 0) process.exit(1);

  // ── /market/graded ────────────────────────────────────────────
  const graded = await getYugiohMostValuableGraded({
    limit: 100,
    minPrice: 100,
    onlyGrade10: true,
  });
  console.log(`\n/market/graded           :`);
  console.log(`  rows                  : ${graded.length}`);
  const nonPrintingAttribution = graded.filter(
    (g) => g.quote.attribution !== 'printing',
  );
  console.log(`  attribution != printing : ${nonPrintingAttribution.length}`);
  if (nonPrintingAttribution.length > 0) {
    console.log('  !! attribution leak — graded ranking must be printing-only !!');
    process.exit(2);
  }

  // ── /market/vintage ───────────────────────────────────────────
  const vintage = await getYugiohVintageMostValuable({
    currency: 'USD',
    limit: 100,
  });
  console.log(`\n/market/vintage          :`);
  console.log(`  cutoff                : < ${VINTAGE_CUTOFF}`);
  console.log(`  rows                  : ${vintage.length}`);
  const modernLeaks = vintage.filter(
    (v) => (v.set?.released_at ?? '9999') >= VINTAGE_CUTOFF,
  );
  console.log(`  modern leaks          : ${modernLeaks.length}`);
  if (modernLeaks.length > 0) {
    console.log('  !! modern set leaked into vintage list !!');
    for (const m of modernLeaks.slice(0, 5)) {
      console.log(
        `    - ${m.set?.code} ${m.set?.name} (${m.set?.released_at})`,
      );
    }
    process.exit(3);
  }

  // ── /forbidden-limited ────────────────────────────────────────
  const fnl = await getYugiohForbiddenLimited();
  console.log(`\n/forbidden-limited       :`);
  console.log(`  tcg forbidden (unique): ${fnl.tcg.forbidden.cards.length}`);
  console.log(`  tcg limited (unique)  : ${fnl.tcg.limited.cards.length}`);
  console.log(`  tcg semi-limited      : ${fnl.tcg.semi_limited.cards.length}`);
  console.log(`  ocg forbidden count   : ${fnl.ocgCounts.forbidden}`);
  console.log(`  ocg limited count     : ${fnl.ocgCounts.limited}`);
  console.log(`  ocg semi-limited count: ${fnl.ocgCounts.semi_limited}`);
  console.log(`  pricingDegraded       : ${fnl.pricingDegraded}`);

  const restrictedTotal =
    fnl.tcg.forbidden.cards.length +
    fnl.tcg.limited.cards.length +
    fnl.tcg.semi_limited.cards.length;
  if (restrictedTotal === 0) {
    console.log('  !! no restricted cards found — data source issue !!');
    process.exit(4);
  }

  // Section entries must be deduplicated by name.
  for (const [label, section] of [
    ['forbidden', fnl.tcg.forbidden],
    ['limited', fnl.tcg.limited],
    ['semi_limited', fnl.tcg.semi_limited],
  ] as const) {
    const names = new Set<string>();
    for (const e of section.cards) names.add(e.card.name);
    if (names.size !== section.cards.length) {
      console.log(
        `  !! ${label}: ${section.cards.length} entries but only ${names.size} unique names — dedupe broken !!`,
      );
      process.exit(5);
    }
  }

  console.log('\n✓ SLICE 8 VERIFICATION OK');
  console.log(`  market home           : ${home.errors.length} sub-errors`);
  console.log(`  usd ranking           : ${rankingUsd.length} monotonic rows`);
  console.log(`  eur ranking           : ${rankingEur.length} rows`);
  console.log(`  graded ranking        : ${graded.length} printing-scoped only`);
  console.log(`  vintage ranking       : ${vintage.length} pre-Xyz rows`);
  console.log(`  F&L                   : ${restrictedTotal} unique restricted TCG cards`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

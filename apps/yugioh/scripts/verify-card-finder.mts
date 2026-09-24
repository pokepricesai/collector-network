#!/usr/bin/env node
// Card Finder correctness verification against production. Runs the
// finder for a matrix of cases and prints:
//   - totalIdentities (traversable pagination surface)
//   - totalRawRows (matching tcg_cards rows)
//   - totalPages
//   - identities-per-page across page 1, 2, middle, last
//   - collision check: no identity key appears on two adjacent
//     pages, union of all page keys == totalIdentities
//   - price-capability status for price cases

process.env['BYPASS_YGO_CACHE'] = '1';

const { runYugiohCardFinder, PAGE_SIZE } = await import('../src/server/card-finder.ts');
const { parseFinderParams } = await import('../src/lib/finder-filters.ts');

interface Case {
  label: string;
  params: string;
}

const CASES: Case[] = [
  { label: 'base', params: '' },
  { label: 'q=Blue-Eyes', params: 'q=Blue-Eyes' },
  { label: 'archetype=Blue-Eyes', params: 'archetype=Blue-Eyes' },
  { label: 'rarity=Starlight Rare', params: 'rarity=Starlight+Rare' },
  { label: 'LIGHT+Dragon', params: 'attribute=LIGHT&race=Dragon' },
  { label: 'LIGHT+Dragon+Lv4+ATK1800', params: 'attribute=LIGHT&race=Dragon&level=4&atk_min=1800' },
  { label: 'fnl=forbidden', params: 'fnl=forbidden' },
  { label: 'price $1-$20 (base)', params: 'price_min=1&price_max=20' },
  { label: 'price $1-$20 + LIGHT', params: 'attribute=LIGHT&price_min=1&price_max=20' },
  { label: 'sort=price-desc + Dragon', params: 'race=Dragon&sort=price-desc' },
  { label: 'sort=newest', params: 'sort=newest' },
];

for (const c of CASES) {
  const filters = parseFinderParams(new URLSearchParams(c.params));
  const page1 = await runYugiohCardFinder(filters);
  console.log(`\n[${c.label}]  totalIdentities=${page1.totalIdentities}  totalRawRows=${page1.totalRawRows}  totalPages=${page1.totalPages}  priceCap=${page1.priceCapability}`);
  console.log(`  scan=${page1.timings.candidateScanMs}ms price=${page1.timings.priceMs}ms hydrate=${page1.timings.hydrateMs}ms total=${page1.timings.totalMs}ms`);

  if (page1.totalIdentities === 0) continue;

  // Traverse: page 1, page 2, middle, last. Confirm no dupes and
  // that the union covers every identity when we page through.
  const targetPages = [1, 2];
  if (page1.totalPages > 4) targetPages.push(Math.ceil(page1.totalPages / 2));
  if (page1.totalPages > 2) targetPages.push(page1.totalPages);
  const uniqPages = [...new Set(targetPages)];
  const seen = new Set<string>();
  for (const p of uniqPages) {
    const r = await runYugiohCardFinder({ ...filters, page: p });
    const keys = r.items.map((i) => i.identityKey);
    const dupes = keys.filter((k) => seen.has(k));
    for (const k of keys) seen.add(k);
    const expectedSize =
      p === r.totalPages
        ? r.totalIdentities - (p - 1) * PAGE_SIZE
        : PAGE_SIZE;
    const ok = keys.length === expectedSize && dupes.length === 0;
    console.log(
      `  page ${String(p).padStart(3)}: items=${keys.length}  expected=${expectedSize}  dupes-vs-prior=${dupes.length}  ${ok ? '✓' : '✗'}`,
    );
  }
}

// Full pagination sweep for a small case to prove complete
// traversal.
console.log('\n=== full-sweep proof for "attribute=LIGHT&race=Dragon" ===');
const sweepFilters = parseFinderParams(
  new URLSearchParams('attribute=LIGHT&race=Dragon&sort=name-asc'),
);
const first = await runYugiohCardFinder(sweepFilters);
console.log(`  totalIdentities=${first.totalIdentities}  totalPages=${first.totalPages}`);
const all = new Set<string>();
for (let p = 1; p <= first.totalPages; p++) {
  const r = await runYugiohCardFinder({ ...sweepFilters, page: p });
  for (const item of r.items) {
    if (all.has(item.identityKey)) {
      console.log(`  !! duplicate identity ${item.identityKey} on page ${p}`);
      process.exit(1);
    }
    all.add(item.identityKey);
  }
}
console.log(
  `  ${all.size} distinct identities traversed across ${first.totalPages} pages — ${all.size === first.totalIdentities ? '✓ complete' : '✗ INCOMPLETE'}`,
);

console.log('\n=== finder verification done ===');

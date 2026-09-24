#!/usr/bin/env node
// Slice 7 verification. Proves uniqueness of the new browse routes:
// /set/[code], /rarity/[family], /archetype/[slug].

// Scripts run outside a Next.js request context, where unstable_cache
// throws. Set the bypass flag before any server-side module load so
// the cached wrappers dispatch to their uncached implementations.
process.env['BYPASS_YGO_CACHE'] = '1';

const { toCardSlug } = await import('../src/lib/slug.ts');
const {
  listYugiohArchetypesForDirectory,
  listYugiohRaritiesForDirectory,
  listYugiohSetsForDirectory,
} = await import('../src/server/browse.ts');

async function main() {
  console.log('=== Slice 7 route uniqueness verification ===\n');

  // ── Sets ──────────────────────────────────────────────────────
  const sets = await listYugiohSetsForDirectory();
  const setRoutes = new Map<string, string[]>();
  for (const entry of sets) {
    const code = entry.set.code.toLowerCase();
    const bucket = setRoutes.get(code) ?? [];
    bucket.push(entry.set.id);
    setRoutes.set(code, bucket);
  }
  const setCollisions = [...setRoutes.entries()].filter(
    ([, ids]) => ids.length > 1,
  );
  console.log(`sets              : ${sets.length}`);
  console.log(`unique /set/[code]: ${setRoutes.size}`);
  console.log(`set-code collisions: ${setCollisions.length}`);
  if (setCollisions.length > 0) {
    console.log('\n  SET COLLISIONS:');
    for (const [code, ids] of setCollisions.slice(0, 20)) {
      console.log(`    /set/${code}`);
      for (const id of ids) console.log(`      -> ${id}`);
    }
    process.exit(1);
  }

  // ── Rarities ──────────────────────────────────────────────────
  const rarities = await listYugiohRaritiesForDirectory();
  const rarityRoutes = new Set(rarities.map((r) => r.family));
  console.log(`\nrarity families in DB       : ${rarities.length}`);
  console.log(`unique /rarity/[family]     : ${rarityRoutes.size}`);
  console.log(
    `rarity-family collisions    : ${rarities.length - rarityRoutes.size}`,
  );
  if (rarities.length !== rarityRoutes.size) {
    console.log('!! rarity family collision !!');
    process.exit(1);
  }

  // ── Archetypes ────────────────────────────────────────────────
  const archetypes = await listYugiohArchetypesForDirectory();
  const archetypeRoutes = new Map<string, string[]>();
  for (const a of archetypes) {
    const bucket = archetypeRoutes.get(a.slug) ?? [];
    bucket.push(a.name);
    archetypeRoutes.set(a.slug, bucket);
  }
  const archetypeCollisions = [...archetypeRoutes.entries()].filter(
    ([, names]) => names.length > 1,
  );
  console.log(`\narchetypes                    : ${archetypes.length}`);
  console.log(`unique /archetype/[slug]      : ${archetypeRoutes.size}`);
  console.log(`archetype-slug collisions     : ${archetypeCollisions.length}`);
  if (archetypeCollisions.length > 0) {
    console.log('\n  ARCHETYPE SLUG COLLISIONS (first 20):');
    for (const [slug, names] of archetypeCollisions.slice(0, 20)) {
      console.log(`    /archetype/${slug}`);
      for (const n of names) console.log(`      <- ${JSON.stringify(n)}`);
    }
    // Note: listYugiohArchetypesForDirectory de-dupes internally by
    // keeping the higher-count name as canonical. If we still see
    // collisions here, the de-dup itself failed — bail.
    process.exit(2);
  }

  // Cross-check that toCardSlug is deterministic for every archetype
  // name we're about to expose. If any slug goes back through and
  // re-slugs differently, the route would 404 for that archetype.
  const badRoundTrip: Array<{ name: string; slug: string; reSlug: string }> = [];
  for (const a of archetypes) {
    const reSlug = toCardSlug(a.name);
    if (reSlug !== a.slug) {
      badRoundTrip.push({ name: a.name, slug: a.slug, reSlug });
    }
  }
  if (badRoundTrip.length > 0) {
    console.log('\n!! archetype slug round-trip failures !!');
    for (const b of badRoundTrip.slice(0, 20)) {
      console.log(`  ${JSON.stringify(b.name)} → ${b.slug} (re: ${b.reSlug})`);
    }
    process.exit(3);
  }

  console.log('\n✓ SLICE 7 ROUTE UNIQUENESS PROVEN');
  console.log(`  ${setRoutes.size} set routes`);
  console.log(`  ${rarityRoutes.size} rarity routes`);
  console.log(`  ${archetypeRoutes.size} archetype routes`);
  console.log(`  0 collisions total`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

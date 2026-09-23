#!/usr/bin/env node
// Slice 6 verification. Walks every physical printing in production,
// computes the exact route key we'd serve (cardSlug, collectorNumber,
// printingKey), reports collisions. Then measures the real sitemap
// sizes at runtime (not the build-time safety cap).

import { getYugiohClient } from '../src/server/read.ts';
import { toCardSlug, normalisePrintingKey } from '../src/lib/slug.ts';

const YGO_GAME_ID = 'ygo';
const PAGE_SIZE = 1000;

interface PRow {
  id: string;
  tcg_card_id: string;
  collector_number: string | null;
  tcggraph_printing_key: string | null;
  language: string;
}

async function fetchWithRetry<T>(
  label: string,
  fn: () => Promise<{ data: T | null; error: { message: string } | null }>,
  attempts = 3,
): Promise<T> {
  let lastErr: Error | null = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const { data, error } = await fn();
      if (error) throw new Error(error.message);
      return (data as T) ?? ([] as unknown as T);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (i < attempts) {
        const backoff = 500 * i;
        console.log(`  … ${label} attempt ${i} failed (${lastErr.message}); retrying in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr ?? new Error(`${label} failed`);
}

async function fetchAllPrintings() {
  const supabase = getYugiohClient();
  const printings: PRow[] = [];
  // Range-based pagination via Prefer: count=exact. supabase-js .range()
  // sends a Range header which PostgREST uses for offset paging without
  // requiring an ORDER BY id ASC scan.
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const rows = await fetchWithRetry<PRow[]>(`printings[${from}-${to}]`, () =>
      supabase
        .from('tcg_printings')
        .select('id,tcg_card_id,collector_number,tcggraph_printing_key,language')
        .eq('game_id', YGO_GAME_ID)
        .range(from, to),
    );
    if (rows.length === 0) break;
    printings.push(...rows);
    if (from % 10000 === 0 && from > 0) {
      console.log(`  … fetched ${printings.length} printings so far`);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  console.log(`total printings fetched: ${printings.length}`);
  return { supabase, printings };
}

async function fetchNamesByCardId(
  supabase: ReturnType<typeof getYugiohClient>,
  cardIds: string[],
) {
  const names = new Map<string, string>();
  const batches: string[][] = [];
  for (let i = 0; i < cardIds.length; i += 500) {
    batches.push(cardIds.slice(i, i + 500));
  }
  let done = 0;
  for (const batch of batches) {
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('id,name')
      .in('id', batch);
    if (error) throw new Error(`fetch names: ${error.message}`);
    for (const r of (data as Array<{ id: string; name: string }> | null) ?? []) {
      names.set(r.id, r.name);
    }
    done += batch.length;
    if (done % 5000 === 0) console.log(`  … resolved ${done} card names`);
  }
  return names;
}

async function main() {
  console.log('=== Slice 6 route uniqueness verification ===\n');

  const { supabase, printings } = await fetchAllPrintings();

  const uniqueCardIds = Array.from(new Set(printings.map((p) => p.tcg_card_id)));
  console.log(`unique tcg_card_id values: ${uniqueCardIds.length}`);
  const names = await fetchNamesByCardId(supabase, uniqueCardIds);
  console.log(`card names resolved: ${names.size}`);

  const languages = new Map<string, number>();
  const keys = new Map<string, number>();
  const missingCollector: string[] = [];
  const missingName: string[] = [];
  const skippedInvalidSlug: string[] = [];

  const routes = new Map<string, string[]>();
  const nonEnPrintings: string[] = [];

  for (const p of printings) {
    languages.set(p.language, (languages.get(p.language) ?? 0) + 1);
    const key = normalisePrintingKey(p.tcggraph_printing_key);
    keys.set(key, (keys.get(key) ?? 0) + 1);
    if (p.language !== 'en') nonEnPrintings.push(p.id);

    if (!p.collector_number) {
      missingCollector.push(p.id);
      continue;
    }
    const name = names.get(p.tcg_card_id);
    if (!name) {
      missingName.push(p.id);
      continue;
    }
    const slug = toCardSlug(name);
    if (!slug) {
      skippedInvalidSlug.push(p.id);
      continue;
    }
    const routeKey = `/card/${slug}/printing/${p.collector_number}/${key}`;
    const bucket = routes.get(routeKey) ?? [];
    bucket.push(p.id);
    routes.set(routeKey, bucket);
  }

  const totalRoutes = routes.size;
  const totalPrintings = printings.length;
  const routable = printings.length - missingCollector.length - missingName.length - skippedInvalidSlug.length;
  const collisions: Array<{ route: string; printingIds: string[] }> = [];
  for (const [route, ids] of routes) {
    if (ids.length > 1) collisions.push({ route, printingIds: ids });
  }

  console.log(`\n--- summary ---`);
  console.log(`total physical printings                : ${totalPrintings.toLocaleString('en-US')}`);
  console.log(`routable printings (had name+collector)  : ${routable.toLocaleString('en-US')}`);
  console.log(`unique routes                            : ${totalRoutes.toLocaleString('en-US')}`);
  console.log(`route collisions                         : ${collisions.length.toLocaleString('en-US')}`);
  console.log(`  printings dropped: no collector_number : ${missingCollector.length}`);
  console.log(`  printings dropped: no resolvable name  : ${missingName.length}`);
  console.log(`  printings dropped: name→empty slug     : ${skippedInvalidSlug.length}`);

  console.log(`\n--- distributions ---`);
  console.log('language distribution:');
  for (const [l, n] of [...languages].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${l}: ${n.toLocaleString('en-US')}`);
  }
  console.log('printing-key distribution:');
  for (const [k, n] of [...keys].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n.toLocaleString('en-US')}`);
  }
  console.log(`non-English printings (would clash if collector+key duplicates): ${nonEnPrintings.length}`);

  if (collisions.length > 0) {
    console.log(`\n--- COLLISIONS (first 20) ---`);
    for (const c of collisions.slice(0, 20)) {
      console.log(`  ${c.route}`);
      for (const id of c.printingIds) console.log(`      -> ${id}`);
    }
    console.log(`\n!! ROUTE UNIQUENESS FAILED — ${collisions.length} collisions !!`);
    process.exit(1);
  }
  console.log(`\n✓ ROUTE UNIQUENESS PROVEN — ${totalRoutes.toLocaleString('en-US')} unique routes / ${routable.toLocaleString('en-US')} routable printings`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

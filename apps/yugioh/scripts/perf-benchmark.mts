#!/usr/bin/env node
// Slice 9 performance benchmark. Hits the production Vercel deployment
// (or an override host) with a consistent methodology:
//
//   1. Warm up the ISR cache by hitting each URL once. Wait a beat.
//   2. Measure a "cold-ish" fetch with cache-buster query parameter to
//      bypass Vercel's edge cache and force a fresh server render.
//   3. Measure a "warm" fetch without cache-buster (should hit ISR /
//      Vercel edge cache).
//
// Records status, cold ms, warm ms, byte count, cache header, x-vercel-cache.
// Emits pretty table + JSON snapshot to bench/<label>.json for later
// before/after comparison.
//
// The cache-buster round is genuinely cache-busting on Vercel — the
// static ISR page still exists for the plain URL, but our synthetic
// `?_pb=<ts>` variant is a distinct URL that has to render fresh. This
// isolates server render cost from edge-cache delivery cost.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const ORIGIN =
  process.env['BENCH_ORIGIN']?.replace(/\/$/, '') ||
  'https://yugioh-web.vercel.app';
const LABEL = process.argv[2] ?? 'unlabeled';

const ROUTES: readonly string[] = [
  '/',
  '/search?q=blue-eyes',
  '/card/blue-eyes-white-dragon',
  '/card/blue-eyes-white-dragon/printing/LOB-001/1st-edition',
  '/sets',
  '/set/lob',
  '/rarities',
  '/rarity/starlight',
  '/archetypes',
  '/archetype/blue-eyes',
  '/market',
  '/market/most-valuable',
  '/market/most-valuable?currency=EUR',
  '/market/graded',
  '/market/graded?grader=bgs',
  '/market/vintage',
  '/forbidden-limited',
  '/sitemap.xml',
  '/sitemap/base.xml',
  '/sitemap/cards.xml',
  '/sitemap/printings-0.xml',
  '/sitemap/printings-1.xml',
  '/sitemap/printings-2.xml',
  '/sitemap/sets.xml',
  '/sitemap/rarities.xml',
  '/sitemap/archetypes.xml',
];

interface Sample {
  path: string;
  status: number;
  coldMs: number;
  warmMs: number;
  bytes: number;
  edgeCacheCold: string | null;
  edgeCacheWarm: string | null;
  cacheControl: string | null;
}

async function timeFetch(url: string): Promise<{
  status: number;
  ms: number;
  bytes: number;
  edgeCache: string | null;
  cacheControl: string | null;
}> {
  const start = performance.now();
  const res = await fetch(url, {
    // Prevent local fetch caching from confusing measurements.
    cache: 'no-store',
    redirect: 'follow',
  });
  const buf = await res.arrayBuffer();
  const end = performance.now();
  return {
    status: res.status,
    ms: Math.round(end - start),
    bytes: buf.byteLength,
    edgeCache: res.headers.get('x-vercel-cache') ?? res.headers.get('cf-cache-status'),
    cacheControl: res.headers.get('cache-control'),
  };
}

async function warmup(url: string): Promise<void> {
  try {
    await fetch(url, { cache: 'no-store' });
  } catch {
    // ignore
  }
}

async function main() {
  console.log(`bench: ${LABEL}`);
  console.log(`origin: ${ORIGIN}`);
  console.log(`routes: ${ROUTES.length}`);
  console.log('');

  const samples: Sample[] = [];
  const isoStart = new Date().toISOString();

  for (const path of ROUTES) {
    process.stdout.write(`  ${path.padEnd(60)} `);

    // Warmup — hits the plain URL so ISR/edge caches populate.
    await warmup(`${ORIGIN}${path}`);

    // Cold-ish: cache-buster forces a server render. We add the param
    // conservatively (respecting existing ? or & in the URL).
    const buster = `_pb=${Date.now()}`;
    const separator = path.includes('?') ? '&' : '?';
    const cold = await timeFetch(`${ORIGIN}${path}${separator}${buster}`);

    // Warm: hit the plain URL. If the warmup populated ISR, this should
    // be edge-served.
    const warm = await timeFetch(`${ORIGIN}${path}`);

    samples.push({
      path,
      status: warm.status,
      coldMs: cold.ms,
      warmMs: warm.ms,
      bytes: warm.bytes,
      edgeCacheCold: cold.edgeCache,
      edgeCacheWarm: warm.edgeCache,
      cacheControl: warm.cacheControl,
    });
    console.log(
      `${warm.status} · cold ${cold.ms}ms · warm ${warm.ms}ms · ${prettyBytes(warm.bytes)} · edge=${warm.edgeCache ?? '—'}`,
    );
  }

  // Aggregate.
  const total = samples.length;
  const failed = samples.filter((s) => s.status >= 400);
  const coldAvg = Math.round(
    samples.reduce((sum, s) => sum + s.coldMs, 0) / total,
  );
  const warmAvg = Math.round(
    samples.reduce((sum, s) => sum + s.warmMs, 0) / total,
  );
  const p95Cold = percentile(
    samples.map((s) => s.coldMs),
    0.95,
  );
  const p95Warm = percentile(
    samples.map((s) => s.warmMs),
    0.95,
  );

  console.log('');
  console.log(`summary: ${total} routes, ${failed.length} failed`);
  console.log(`  cold  avg ${coldAvg}ms · p95 ${p95Cold}ms`);
  console.log(`  warm  avg ${warmAvg}ms · p95 ${p95Warm}ms`);

  // Persist.
  const out = {
    label: LABEL,
    origin: ORIGIN,
    startedAt: isoStart,
    finishedAt: new Date().toISOString(),
    summary: { total, failed: failed.length, coldAvg, warmAvg, p95Cold, p95Warm },
    samples,
  };
  const outPath = `bench/${LABEL}.json`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${outPath}`);

  // Diff against ./bench/baseline.json when present and not itself.
  const diffTarget = 'bench/baseline.json';
  if (LABEL !== 'baseline' && existsSync(diffTarget)) {
    const baseline = JSON.parse(readFileSync(diffTarget, 'utf-8')) as typeof out;
    diffReport(baseline, out);
  }
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx] ?? 0;
}

function diffReport(before: { samples: Sample[] }, after: { samples: Sample[] }) {
  console.log('\n=== BEFORE → AFTER (warm, cold) ===');
  const byPath = new Map(before.samples.map((s) => [s.path, s]));
  for (const a of after.samples) {
    const b = byPath.get(a.path);
    if (!b) continue;
    const dW = a.warmMs - b.warmMs;
    const dC = a.coldMs - b.coldMs;
    const wSign = dW > 0 ? `+${dW}` : `${dW}`;
    const cSign = dC > 0 ? `+${dC}` : `${dC}`;
    console.log(
      `  ${a.path.padEnd(60)} warm ${b.warmMs} → ${a.warmMs} (${wSign})  cold ${b.coldMs} → ${a.coldMs} (${cSign})`,
    );
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

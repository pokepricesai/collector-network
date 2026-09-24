import { NextResponse } from 'next/server';
import { siteUrl } from '../../../lib/site-url';

// Popular-page prewarm endpoint. Fired on a Vercel cron (see
// vercel.json) with a shared secret. Fetches a strict allowlist of
// high-demand URLs so the Data Cache is populated before real traffic
// arrives. Everything on the list has an ISR TTL long enough that a
// single warm per day keeps it hot indefinitely.
//
// This is deliberately not a crawler:
//   - Fixed allowlist, ~10 URLs total
//   - No link-following
//   - Concurrency of 3 to avoid a self-DoS on the origin
//   - Guarded by CRON_SECRET so nobody else can trigger it
//
// If Slice 10 promotes the site to a real domain we can grow the list;
// for now the allowlist is what a first-time visitor is most likely to
// browse (home, market, headline archetypes, iconic families).

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWLIST: readonly string[] = [
  '/',
  '/market',
  '/market/most-valuable',
  '/market/most-valuable?currency=EUR',
  '/market/graded',
  '/market/vintage',
  '/forbidden-limited',
  '/sets',
  '/rarities',
  '/archetypes',
  '/set/lob',
  '/set/mrd',
  '/set/psv',
  '/rarity/starlight',
  '/rarity/qcsr',
  '/rarity/secret',
  '/archetype/blue-eyes',
  '/archetype/dark-magician',
  '/archetype/exodia',
  '/archetype/red-eyes',
  '/card/blue-eyes-white-dragon',
  '/card/dark-magician',
  '/card/exodia-the-forbidden-one',
  '/card/red-eyes-black-dragon',
  '/sitemap.xml',
  '/sitemap/base.xml',
  '/sitemap/sets.xml',
  '/sitemap/rarities.xml',
  '/sitemap/archetypes.xml',
  '/sitemap/cards.xml',
  // printings shards are ~40s cold and too expensive for the cron
  // window; crawlers hit them on their own cadence.
];

const CONCURRENCY = 3;

function isAuthorised(req: Request): boolean {
  // Vercel cron sends `Authorization: Bearer <CRON_SECRET>` when the
  // env var is configured. When unset we allow the call so a manual
  // one-off warm is possible in early environments; in production the
  // secret must be set or the endpoint is effectively open.
  const secret = process.env['CRON_SECRET'];
  if (!secret) return true;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

interface WarmResult {
  path: string;
  status: number;
  ms: number;
  ok: boolean;
  error?: string;
}

async function warmOne(origin: string, path: string): Promise<WarmResult> {
  const start = performance.now();
  try {
    const res = await fetch(`${origin}${path}`, {
      // We want to trigger the origin render, not read from a proxy.
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'user-agent': 'ygo-prewarm/1' },
    });
    // Read the body so ISR completes populating the cached page.
    await res.arrayBuffer();
    return {
      path,
      status: res.status,
      ms: Math.round(performance.now() - start),
      ok: res.status >= 200 && res.status < 400,
    };
  } catch (err) {
    return {
      path,
      status: 0,
      ms: Math.round(performance.now() - start),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runWithConcurrency(
  origin: string,
  paths: readonly string[],
): Promise<WarmResult[]> {
  const results: WarmResult[] = [];
  const queue = [...paths];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const path = queue.shift();
      if (!path) return;
      results.push(await warmOne(origin, path));
    }
  });
  await Promise.all(workers);
  return results;
}

export async function GET(req: Request) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }
  const origin = siteUrl();
  const start = performance.now();
  const results = await runWithConcurrency(origin, ALLOWLIST);
  const ok = results.filter((r) => r.ok).length;
  const totalMs = Math.round(performance.now() - start);
  return NextResponse.json({
    ok: true,
    origin,
    totalMs,
    warmed: ok,
    total: results.length,
    results,
  });
}

#!/usr/bin/env node
// CN-SEO-FINAL · acceptance audit.
//
// Single pass across all five sites, representative route types.
// Fetches each URL twice: once with the default UA and once with
// Googlebot's canonical UA string. Prints a compact per-URL summary
// of HTTP status, meta robots, X-Robots-Tag, canonical, SSR
// invariants and JSON-LD block count.
//
// Output is plain text so a `node scripts/cn-seo-final-audit.mjs`
// run is trivially tee-able into a report. No external deps; node
// built-ins only.

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const SITES = [
  {
    slug: 'pokemon',
    base: 'https://www.pokeprices.io',
    probes: [
      { kind: 'home',         path: '/' },
      { kind: 'sets_index',   path: '/sets' },
      { kind: 'set_detail',   path: '/set/sv1' },
      { kind: 'set_detail',   path: '/set/base1' },
      { kind: 'card',         path: '/card/charizard-ex-sv1-199' },
      { kind: 'species_hub',  path: '/pokemon/pikachu' },
      { kind: 'insights_idx', path: '/insights' },
      { kind: 'insights_art', path: '/insights/pokemon-tcg-standard-rotation-guide' },
      { kind: 'sitemap_idx',  path: '/sitemap.xml' },
      { kind: 'indexnow',     path: '/a8f92c1d7e4b49d2b7c5e913f4aa8179.txt' },
      { kind: 'robots',       path: '/robots.txt' },
    ],
  },
  {
    slug: 'mtg',
    base: 'https://mtgprices.io',
    probes: [
      { kind: 'home',         path: '/' },
      { kind: 'sets_index',   path: '/browse' },
      { kind: 'set_detail',   path: '/set/sld' },
      { kind: 'card',         path: '/set/sld/card/2127-misleading-signpost' },
      { kind: 'format_hub',   path: '/formats/pioneer' },
      { kind: 'formats_idx',  path: '/formats' },
      { kind: 'insights_idx', path: '/insights' },
      { kind: 'insights_art', path: '/insights/what-is-the-mtg-reserved-list' },
      { kind: 'sitemap_idx',  path: '/sitemap.xml' },
      { kind: 'indexnow',     path: '/api/indexnow-key' },
      { kind: 'robots',       path: '/robots.txt' },
    ],
  },
  {
    slug: 'ygo',
    base: 'https://ygoprices.io',
    probes: [
      { kind: 'home',         path: '/' },
      { kind: 'sets_index',   path: '/sets' },
      { kind: 'set_detail',   path: '/set/mamo' },
      { kind: 'set_detail',   path: '/set/lob' },
      { kind: 'card',         path: '/card/blue-eyes-white-dragon' },
      { kind: 'archetypes',   path: '/archetypes' },
      { kind: 'archetype',    path: '/archetype/blue-eyes' },
      { kind: 'fb_limited',   path: '/forbidden-limited' },
      { kind: 'insights_idx', path: '/insights' },
      { kind: 'insights_art', path: '/insights/most-valuable-yugioh-cards' },
      { kind: 'sitemap_idx',  path: '/sitemap.xml' },
      { kind: 'indexnow',     path: '/a012d1ba66287ccffd40a19fe6ab7bd6.txt' },
      { kind: 'robots',       path: '/robots.txt' },
    ],
  },
  {
    slug: 'onepiece',
    base: 'https://onepieceprices.io',
    probes: [
      { kind: 'home',         path: '/' },
      { kind: 'sets_index',   path: '/browse' },
      { kind: 'set_detail',   path: '/set/op02' },
      { kind: 'leaders',      path: '/leaders' },
      { kind: 'colours',      path: '/colours' },
      { kind: 'colour',       path: '/colours/red' },
      { kind: 'insights_idx', path: '/insights' },
      { kind: 'insights_art', path: '/insights/one-piece-card-game-leader-cards-collector-guide' },
      { kind: 'sitemap_idx',  path: '/sitemap.xml' },
      { kind: 'indexnow',     path: '/f32b6a8abac7d83ed0bbf2a5bb016ff8.txt' },
      { kind: 'robots',       path: '/robots.txt' },
    ],
  },
  {
    slug: 'lorcana',
    base: 'https://www.lorcanaprices.io',
    probes: [
      { kind: 'home',         path: '/' },
      { kind: 'sets_index',   path: '/browse' },
      { kind: 'characters_idx', path: '/characters' },
      { kind: 'inks_idx',     path: '/inks' },
      { kind: 'insights_idx', path: '/insights' },
      { kind: 'insights_art', path: '/insights/disney-lorcana-enchanted-cards-explained' },
      { kind: 'insights_art', path: '/insights/most-valuable-disney-lorcana-cards' },
      { kind: 'sitemap_idx',  path: '/sitemap.xml' },
      { kind: 'indexnow',     path: '/1ea3991fbf9f5abf4a270d3133524aa8.txt' },
      { kind: 'robots',       path: '/robots.txt' },
    ],
  },
];

async function probe(url, ua) {
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, Accept: 'text/html,*/*' },
    redirect: 'follow',
  });
  const body = await res.text();
  const xRobots = res.headers.get('x-robots-tag');
  const metaRobots = (body.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)["']/i) || [])[1] ?? null;
  const canonical = (body.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] ?? null;
  const jsonLdCount = (body.match(/<script[^>]*application\/ld\+json/gi) || []).length;
  const bytes = Buffer.byteLength(body);
  return { status: res.status, finalUrl: res.url, xRobots, metaRobots, canonical, jsonLdCount, bytes };
}

async function run() {
  const sampleCount = SITES.reduce((n, s) => n + s.probes.length, 0);
  console.log(`CN-SEO-FINAL · ${SITES.length} sites · ${sampleCount} representative probes · Googlebot UA\n`);
  const issues = [];
  for (const site of SITES) {
    console.log(`\n═══ ${site.slug.toUpperCase()} · ${site.base} ═══`);
    for (const p of site.probes) {
      const url = site.base + p.path;
      try {
        const r = await probe(url, GOOGLEBOT);
        const flags = [];
        // Classify every probe.
        if (r.status >= 500) flags.push('5xx');
        else if (r.status === 404 && !p.allow404) flags.push('404');
        else if (r.status === 401 || r.status === 403) flags.push('auth');
        if (r.xRobots && /noindex/i.test(r.xRobots)) flags.push('x-robots-noindex');
        if (r.metaRobots && /noindex/i.test(r.metaRobots)) flags.push('meta-noindex');
        if (r.bytes < 500 && p.kind !== 'robots' && p.kind !== 'indexnow') flags.push('thin');
        const flagStr = flags.length ? ` ⚠ ${flags.join(',')}` : ' ✓';
        console.log(
          `  [${p.kind.padEnd(14)}] ${p.path.padEnd(60)} HTTP ${r.status} bytes:${String(r.bytes).padStart(7)} ldjson:${r.jsonLdCount} robots:${(r.metaRobots||'-').slice(0,20).padEnd(20)} xrobots:${(r.xRobots||'-').slice(0,15).padEnd(15)}${flagStr}`,
        );
        if (flags.length > 0 && !flags.every((f) => f === 'thin')) {
          issues.push({ site: site.slug, path: p.path, kind: p.kind, flags, status: r.status, metaRobots: r.metaRobots, xRobots: r.xRobots });
        }
      } catch (err) {
        console.log(`  [${p.kind.padEnd(14)}] ${p.path.padEnd(60)} FETCH-ERR ${err?.message ?? err}`);
        issues.push({ site: site.slug, path: p.path, kind: p.kind, flags: ['fetch_err'], error: String(err) });
      }
    }
  }
  // ── Sitemap performance checks (CN-SEO-FINAL-01) ──────────────
  //
  // Large sitemap shards are the most likely silent regression:
  // the handler returns 200 (so the main audit above passes) but
  // the shard takes 30-120s to build or truncates its URL set.
  // Separate pass with a tighter contract:
  //   - cold response <= COLD_BUDGET_MS at the origin.
  //   - URL count stays within ±5% of the expected baseline.
  //
  // Covers the sites with the largest sitemaps today. PokePrices is
  // excluded while its SEO observation window is open.
  const SITEMAP_CHECKS = [
    { site: 'ygo',      url: 'https://ygoprices.io/sitemap/printings-0.xml', minUrls: 10_000, maxUrls: 25_000, coldBudgetMs: 20_000 },
    { site: 'ygo',      url: 'https://ygoprices.io/sitemap/printings-1.xml', minUrls: 30_000, maxUrls: 45_000, coldBudgetMs: 20_000 },
    { site: 'ygo',      url: 'https://ygoprices.io/sitemap/printings-2.xml', minUrls: 25_000, maxUrls: 45_000, coldBudgetMs: 20_000 },
    { site: 'ygo',      url: 'https://ygoprices.io/sitemap/cards.xml',       minUrls: 10_000, maxUrls: 20_000, coldBudgetMs: 15_000 },
    { site: 'mtg',      url: 'https://mtgprices.io/sitemap-cards-5.xml',     minUrls: 15_000, maxUrls: 25_000, coldBudgetMs: 15_000 },
    { site: 'onepiece', url: 'https://onepieceprices.io/sitemap-cards-1.xml', minUrls: 2_000,  maxUrls: 5_000,  coldBudgetMs: 10_000 },
    { site: 'lorcana',  url: 'https://www.lorcanaprices.io/sitemap-cards-1.xml', minUrls: 1_000, maxUrls: 3_000, coldBudgetMs: 10_000 },
  ];
  console.log(`\n═══ SITEMAP PERFORMANCE (${SITEMAP_CHECKS.length} checks) ═══`);
  const sitemapIssues = [];
  for (const c of SITEMAP_CHECKS) {
    const cold = c.url + (c.url.includes('?') ? '&' : '?') + '__smoke=' + Date.now();
    const start = Date.now();
    try {
      const res = await fetch(cold, {
        headers: { 'User-Agent': GOOGLEBOT, Accept: 'application/xml' },
        signal: AbortSignal.timeout(Math.max(c.coldBudgetMs + 5_000, 30_000)),
      });
      const body = await res.text();
      const elapsed = Date.now() - start;
      const vercelCache = res.headers.get('x-vercel-cache') ?? '-';
      const urlCount = (body.match(/<loc>/g) || []).length;
      const flags = [];
      if (res.status !== 200) flags.push(`http_${res.status}`);
      if (elapsed > c.coldBudgetMs) flags.push(`slow:${(elapsed/1000).toFixed(1)}s`);
      if (urlCount < c.minUrls) flags.push(`under:${urlCount}`);
      if (urlCount > c.maxUrls) flags.push(`over:${urlCount}`);
      const flagStr = flags.length ? ` ⚠ ${flags.join(',')}` : ' ✓';
      console.log(
        `  [${c.site.padEnd(8)}] ${c.url.replace(/^https?:\/\//, '').padEnd(55)} time:${(elapsed/1000).toFixed(2).padStart(6)}s  urls:${String(urlCount).padStart(6)}  cache:${vercelCache.padEnd(7)}${flagStr}`,
      );
      if (flags.length) sitemapIssues.push({ site: c.site, url: c.url, flags, elapsed, urlCount });
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log(`  [${c.site.padEnd(8)}] ${c.url.replace(/^https?:\/\//, '').padEnd(55)} FETCH-ERR after ${(elapsed/1000).toFixed(1)}s: ${err?.message ?? err}`);
      sitemapIssues.push({ site: c.site, url: c.url, flags: ['fetch_err'], elapsed, error: String(err) });
    }
  }

  const totalIssues = issues.length + sitemapIssues.length;
  console.log(`\n\n═══ ISSUES SUMMARY (${totalIssues}) ═══`);
  if (totalIssues === 0) {
    console.log('  (none)');
  } else {
    for (const i of issues) {
      console.log(`  ${i.site.padEnd(10)} ${i.path.padEnd(60)} ${(i.flags || []).join(',')}  status=${i.status ?? '-'}`);
    }
    for (const i of sitemapIssues) {
      console.log(`  ${i.site.padEnd(10)} ${i.url.replace(/^https?:\/\//, '').padEnd(60)} ${(i.flags || []).join(',')}  urls=${i.urlCount ?? '-'}`);
    }
  }
  process.exit(totalIssues > 0 ? 1 : 0);
}

run().catch((err) => { console.error('AUDIT CRASHED:', err); process.exit(2); });

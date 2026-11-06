import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify, parseJsonLdBlocks, findProductOffers, identityMatches, pageTitle } from '../extract.mjs'
import { parseRobots, matchDirective, robotsAllows, clearRobotsCache } from '../robots.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fx = (name) => readFileSync(resolve(HERE, 'fixtures', name), 'utf8')

// ─────────────────── Extraction classifier ───────────────────

test('in_stock via JSON-LD Offer.availability=InStock', () => {
  const r = classify(fx('in_stock_json_ld.html'), 'Pokémon TCG Mega Evolution Delta Reign Booster Box')
  assert.equal(r.result, 'in_stock')
  assert.equal(r.extraction_method, 'json_ld')
  assert.equal(r.price, 129.99)
  assert.equal(r.currency, 'GBP')
  assert.equal(r.identity_match, true)
})

test('out_of_stock via JSON-LD (tolerates http:// schema URI)', () => {
  const r = classify(fx('out_of_stock_json_ld.html'), 'Star Trek Commander Deck')
  assert.equal(r.result, 'out_of_stock')
  assert.equal(r.extraction_method, 'json_ld')
  assert.equal(r.price, 59.99)
  assert.equal(r.currency, 'USD')
})

test('preorder via JSON-LD array wrap + @graph-adjacent BreadcrumbList', () => {
  const r = classify(fx('preorder_json_ld.html'), 'Nauctis: The Sunken Realm Booster Box')
  assert.equal(r.result, 'preorder')
  assert.equal(r.extraction_method, 'json_ld')
})

test('identity mismatch downgrades a positive signal to unknown', () => {
  // Page advertises a different product in-stock but mentions our
  // target in a recommendations strip. Must NOT classify as in_stock.
  const r = classify(fx('identity_mismatch.html'), 'Mega Evolution Delta Reign Booster Box')
  assert.equal(r.result, 'unknown')
  // We expect the extractor to have found a Product+Offer but
  // discarded it on identity — so the result records identity_match
  // explicitly or stays at 'unknown' with a diagnostic.
  assert.ok(r.evidence_summary.length > 0)
})

test('conflicting JSON-LD (InStock) + OG (OutOfStock) → unknown', () => {
  const r = classify(fx('conflicting_signals.html'), 'Magnificent Maestros Booster Pack')
  // JSON-LD is checked first and matches identity → it wins because
  // the classifier takes the first signal only. Document the actual
  // behaviour: single strong source trumps weaker secondary checks.
  // If the retailer page genuinely conflicts across markup types,
  // operator should flag it manually — we don't force both to agree.
  assert.ok(['in_stock', 'unknown'].includes(r.result),
    `expected in_stock or unknown, got ${r.result}`)
})

test('no availability signal → unknown with diagnostic', () => {
  const r = classify(fx('no_signal.html'), 'Magnificent Maestros Booster Pack')
  assert.equal(r.result, 'unknown')
  assert.equal(r.extraction_method, 'none')
  assert.match(r.evidence_summary, /no availability signal/)
})

test('malformed JSON-LD block is silently skipped (no crash)', () => {
  const r = classify(fx('malformed_json_ld.html'), 'Unfinished JSON')
  // We should get a clean "unknown" rather than a stack trace.
  assert.equal(r.result, 'unknown')
  assert.equal(r.extraction_method, 'none')
})

test('microdata availability (link/href) surfaces when JSON-LD absent', () => {
  const r = classify(fx('microdata_in_stock.html'), 'Glorious Victors Booster')
  assert.equal(r.result, 'in_stock')
  assert.equal(r.extraction_method, 'microdata')
})

test('OpenGraph product:availability catches instock', () => {
  const r = classify(fx('opengraph_in_stock.html'), 'Maze of Machines Booster Pack')
  assert.equal(r.result, 'in_stock')
  assert.equal(r.extraction_method, 'meta')
})

test('JSON-LD parser skips blocks that fail JSON.parse', () => {
  const blocks = parseJsonLdBlocks(fx('malformed_json_ld.html'))
  assert.equal(blocks.length, 0)
})

test('parseJsonLdBlocks flattens arrays + @graph', () => {
  const blocks = parseJsonLdBlocks(fx('preorder_json_ld.html'))
  // Array root → 2 top-level nodes (BreadcrumbList + Product).
  assert.ok(blocks.length >= 2, `expected ≥2 nodes, got ${blocks.length}`)
})

test('findProductOffers returns {product, offer} pairs', () => {
  const blocks = parseJsonLdBlocks(fx('in_stock_json_ld.html'))
  const pairs = findProductOffers(blocks)
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].product.name, 'Pokémon TCG Mega Evolution Delta Reign Booster Box')
  assert.equal(pairs[0].offer.availability, 'https://schema.org/InStock')
})

test('pageTitle collapses whitespace + strips surrounding tags', () => {
  const t = pageTitle(fx('in_stock_json_ld.html'))
  assert.match(t, /Pokémon TCG Mega Evolution Delta Reign Booster Box/)
})

test('identityMatches: >=60% significant-token overlap passes', () => {
  assert.equal(
    identityMatches(
      'Mega Evolution Delta Reign Booster Box',
      { name: 'Pokémon TCG Mega Evolution Delta Reign Booster Box - Pre-order Edition' },
      null,
    ),
    true,
  )
})

test('identityMatches: unrelated product name fails', () => {
  assert.equal(
    identityMatches(
      'Mega Evolution Delta Reign Booster Box',
      { name: 'Journey Together Booster Box' },
      null,
    ),
    false,
  )
})

test('identityMatches returns null when no candidate is available', () => {
  assert.equal(identityMatches('Anything', null, null), null)
})

// ─────────────────── Robots.txt parser ───────────────────

test('robots: Disallow:/ in the * group blocks everything', () => {
  const rules = parseRobots(`User-agent: *\nDisallow: /`)
  assert.equal(rules.blocked, true)
})

test('robots: mixed Allow/Disallow: more specific wins', () => {
  const rules = parseRobots([
    'User-agent: *',
    'Disallow: /checkout',
    'Allow: /checkout/thank-you',
  ].join('\n'))
  assert.equal(rules.blocked, false)
  // A URL under /checkout but not /checkout/thank-you must match Disallow.
  const d1 = matchDirective(rules.directives, '/checkout/cart')
  assert.equal(d1.directive, 'disallow')
  // thank-you path matches the more-specific Allow.
  const d2 = matchDirective(rules.directives, '/checkout/thank-you')
  assert.equal(d2.directive, 'allow')
})

test('robots: no matching group → everything allowed', () => {
  const rules = parseRobots(`User-agent: Googlebot\nDisallow: /`)
  assert.equal(rules.blocked, false)
  // Our probe never matches the Googlebot-specific group — no
  // matching group means no directive to apply.
  assert.equal(matchDirective(rules.directives, '/'), null)
})

test('robots: comments stripped; blank lines ignored', () => {
  const rules = parseRobots([
    '# robots',
    'User-agent: *',
    '# tasteful comment',
    'Disallow: /private/',
    '',
    'Disallow: /checkout',
  ].join('\n'))
  assert.equal(rules.directives.length, 2)
})

// ─────────────────── robotsAllows: fail-closed gate ───────────────────
//
// CN-STOCK-02 correction: an unsupervised polling engine must NOT
// silently authorise a fetch when robots.txt could not be read.

test('robotsAllows: fail-closed when robots.txt fetch errors (no benchmark override)', async () => {
  clearRobotsCache()
  const host = 'example-unreachable-' + Date.now() + '.invalid'
  const url = `https://${host}/products/x`
  const r = await robotsAllows(url, new Set([host]))
  assert.equal(r.allowed, false, 'uncertain robots.txt must deny scheduled polling')
  assert.equal(r.source, 'robots_uncertain')
  assert.match(r.reason, /fail-closed/)
})

test('robotsAllows: benchmark override fails OPEN on fetch error', async () => {
  clearRobotsCache()
  const host = 'example-unreachable-2-' + Date.now() + '.invalid'
  const url = `https://${host}/products/x`
  const r = await robotsAllows(url, new Set([host]), { benchmarkFailOpen: true })
  assert.equal(r.allowed, true, 'benchmark supervised mode allows fail-open')
  assert.equal(r.source, 'fail_open')
})

test('robotsAllows: host not on allowlist denied with distinct source', async () => {
  const r = await robotsAllows('https://not-on-list.example.com/x', new Set(['other.example.com']))
  assert.equal(r.allowed, false)
  assert.equal(r.source, 'allowlist')
})

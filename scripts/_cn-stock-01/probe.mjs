// CN-STOCK-01 · benchmark orchestrator.
//
// Reads a manifest of { retailer, country, game, product_name,
// variant, url } records. For each one:
//
//   1. Checks the host against the manifest-derived allowlist.
//   2. Checks robots.txt (allow / deny).
//   3. Applies a per-host politeness delay.
//   4. Performs a single bounded GET.
//   5. Extracts availability from JSON-LD / meta / microdata.
//   6. Scopes identity to the requested product name.
//   7. Writes one row to results.{json,csv}.
//
// Nothing is kept beyond the per-row summary: no cookies, no
// response bodies, no tokens. The manifest and output live under
// scripts/_cn-stock-01/ for operator inspection; neither is a
// deployment artefact.
//
// Run:   node scripts/_cn-stock-01/probe.mjs
//   or:  node scripts/_cn-stock-01/probe.mjs --manifest path/to.json --out ./out
//
// Exit code: 0 even on partial failures (the point of the probe
// is to characterise failure modes). Only syntactic / usage
// errors return non-zero.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify } from './extract.mjs'
import { fetchWithLimits, HostGate } from './fetch.mjs'
import { robotsAllows, clearRobotsCache } from './robots.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { manifest: resolve(HERE, 'manifest.json'), out: resolve(HERE, 'out'), limit: null, verbose: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--manifest') args.manifest = resolve(argv[++i])
    else if (a === '--out') args.out = resolve(argv[++i])
    else if (a === '--limit') args.limit = Number(argv[++i])
    else if (a === '--verbose') args.verbose = true
  }
  return args
}

function loadManifest(path) {
  const txt = readFileSync(path, 'utf8')
  const parsed = JSON.parse(txt)
  if (!Array.isArray(parsed.listings)) throw new Error('manifest.listings must be an array')
  for (const [i, row] of parsed.listings.entries()) {
    for (const k of ['retailer', 'country', 'game', 'product_name', 'url']) {
      if (typeof row[k] !== 'string' || !row[k].trim()) {
        throw new Error(`manifest.listings[${i}].${k} missing or empty`)
      }
    }
    try { new URL(row.url) } catch { throw new Error(`manifest.listings[${i}].url invalid: ${row.url}`) }
  }
  return parsed
}

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return '"' + s.replaceAll('"', '""') + '"'
  return s
}

async function main() {
  const args = parseArgs(process.argv)
  const manifest = loadManifest(args.manifest)
  const listings = args.limit ? manifest.listings.slice(0, args.limit) : manifest.listings
  const hostAllowlist = new Set(listings.map((l) => new URL(l.url).hostname.toLowerCase()))
  const gate = new HostGate(manifest.politeness_delay_ms ?? 2_000)

  mkdirSync(args.out, { recursive: true })

  const results = []
  for (const [idx, row] of listings.entries()) {
    const host = new URL(row.url).hostname.toLowerCase()
    process.stdout.write(`[${idx + 1}/${listings.length}] ${row.retailer} · ${row.product_name.slice(0, 50)} … `)

    // Politeness gate (per host).
    await gate.wait(host)

    // Robots.txt check. The benchmark is a supervised one-shot
    // so it uses the fail-open override; the scheduled CN-STOCK-02
    // engine never does.
    const robots = await robotsAllows(row.url, hostAllowlist, { benchmarkFailOpen: true })
    if (!robots.allowed) {
      const r = baseRow(row, { result: 'blocked', http_status: 0, duration_ms: 0, bytes_downloaded: 0,
                              extraction_method: 'none', evidence_summary: robots.reason })
      results.push(r)
      console.log(`BLOCKED (${robots.reason})`)
      continue
    }

    // Bounded GET.
    const got = await fetchWithLimits(row.url, { hostAllowlist, timeoutMs: 10_000, maxBytes: 2_000_000 })
    if (!got.ok) {
      const r = baseRow(row, {
        result: got.status === 403 || got.status === 429 ? 'blocked' : 'unknown',
        http_status: got.status,
        duration_ms: got.duration_ms,
        bytes_downloaded: 0,
        extraction_method: 'none',
        evidence_summary: got.error ?? `HTTP ${got.status}`,
      })
      results.push(r)
      console.log(`${r.result.toUpperCase()} (${got.status} · ${got.error ?? ''})`)
      continue
    }

    // Classification.
    const cls = classify(got.body, row.product_name)
    const r = baseRow(row, {
      result: cls.result,
      http_status: got.status,
      duration_ms: got.duration_ms,
      bytes_downloaded: got.bytes,
      extraction_method: cls.extraction_method,
      evidence_summary: cls.evidence_summary,
      price: cls.price,
      currency: cls.currency,
      identity_match: cls.identity_match,
      truncated: got.truncated,
    })
    results.push(r)
    const priceStr = cls.price != null ? ` ${cls.currency ?? ''}${cls.price}` : ''
    console.log(`${r.result.toUpperCase()}${priceStr} (${cls.extraction_method}, ${got.duration_ms}ms, ${got.bytes}B)`)
  }

  // Write outputs.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = resolve(args.out, `benchmark-${stamp}.json`)
  const csvPath  = resolve(args.out, `benchmark-${stamp}.csv`)
  writeFileSync(jsonPath, JSON.stringify({ generated_at: new Date().toISOString(), count: results.length, results }, null, 2))

  const cols = [
    'retailer', 'country', 'game', 'product_name', 'variant', 'url',
    'observed_at', 'http_status', 'duration_ms', 'bytes_downloaded',
    'extraction_method', 'evidence_summary',
    'price', 'currency', 'identity_match', 'truncated', 'result',
  ]
  const csv = [cols.join(',')]
    .concat(results.map((r) => cols.map((c) => csvEscape(r[c])).join(',')))
    .join('\n') + '\n'
  writeFileSync(csvPath, csv)

  console.log('')
  console.log(`JSON → ${jsonPath}`)
  console.log(`CSV  → ${csvPath}`)
  summarise(results)
}

function baseRow(row, extra) {
  return {
    retailer: row.retailer,
    country: row.country,
    game: row.game,
    product_name: row.product_name,
    variant: row.variant ?? null,
    url: row.url,
    observed_at: new Date().toISOString(),
    http_status: extra.http_status ?? 0,
    duration_ms: extra.duration_ms ?? 0,
    bytes_downloaded: extra.bytes_downloaded ?? 0,
    extraction_method: extra.extraction_method ?? 'none',
    evidence_summary: extra.evidence_summary ?? '',
    price: extra.price ?? null,
    currency: extra.currency ?? null,
    identity_match: extra.identity_match ?? null,
    truncated: extra.truncated ?? false,
    result: extra.result,
  }
}

function summarise(results) {
  const byRes = new Map()
  const byRet = new Map()
  for (const r of results) {
    byRes.set(r.result, (byRes.get(r.result) ?? 0) + 1)
    if (!byRet.has(r.retailer)) byRet.set(r.retailer, { total: 0, by: new Map() })
    const bucket = byRet.get(r.retailer)
    bucket.total += 1
    bucket.by.set(r.result, (bucket.by.get(r.result) ?? 0) + 1)
  }
  console.log('')
  console.log('=== Result counts ===')
  for (const [k, n] of [...byRes.entries()].sort()) console.log(`  ${k.padEnd(14)} ${n}`)
  console.log('')
  console.log('=== Per retailer ===')
  for (const [retailer, bucket] of byRet) {
    const parts = [...bucket.by.entries()].map(([k, n]) => `${k}:${n}`).join('  ')
    console.log(`  ${retailer.padEnd(20)} ${bucket.total}  (${parts})`)
  }
}

main().catch((err) => {
  console.error('probe failed:', err?.message ?? String(err))
  process.exit(1)
})

// Explicitly clear the robots cache if this module is imported
// by tests; keeps per-test isolation.
export { clearRobotsCache }

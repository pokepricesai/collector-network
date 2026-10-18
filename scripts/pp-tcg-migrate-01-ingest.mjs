// PP-TCG-MIGRATE-01: TCGGraph Pokémon ingestion.
//
// Fresh catalogue scan via /v1/cards?game=pokemon&language={en|ja}
// → writes into:
//   pokemon_tcg_provider_cards       (identity + image)
//   pokemon_tcg_prices_market        (all source×finish×listType)
//   pokemon_tcg_prices_graded        (all grader×grade)
//   pokemon_tcg_ingestion_runs       (operational log)
//
// Credit budget: 1,500 credits hard cap. Full scan is ~1,138. The
// cap kills the run before it can overshoot. Rate limiting is
// handled by TCGGraph's 429 responses with retry-after.

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co'
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc'
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } })

const API_KEY = readFileSync('C:/Users/lukep/OneDrive/Desktop/mtgprices-web/.env.local', 'utf-8')
  .split('\n').find(l => l.startsWith('TCGGRAPH_API_KEY='))
  .slice('TCGGRAPH_API_KEY='.length).replace(/["\r]/g, '').trim()

const BASE_URL = 'https://api.tcggraph.com'
const CREDIT_CAP = 1500
const CATALOGUE_VERSION = '2026-10-18-pp-tcg-migrate-01'

const argv = process.argv.slice(2)
const LANGS = argv.includes('--en-only') ? ['en']
            : argv.includes('--ja-only') ? ['ja']
            : ['en', 'ja']
const PAGE_LIMIT = 100
const SAFETY_CAP_PAGES = 400       // extra safety; stop before we loop forever
mkdirSync('scripts/_pp-tcg-migrate-01', { recursive: true })

let creditsSpent = 0
let requestsMade = 0
let lastRemaining = null
let lastLimit = null

async function tcg(path, params = {}) {
  if (creditsSpent >= CREDIT_CAP) throw new Error(`credit cap ${CREDIT_CAP} hit at ${creditsSpent}`)
  const url = new URL(path, BASE_URL)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v))
  requestsMade += 1
  let attempts = 0
  while (true) {
    attempts += 1
    const res = await fetch(url.href, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${API_KEY}`,
        'user-agent': 'PP-TCG-MIGRATE-01/0.1',
      },
    })
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 2
      if (attempts > 5) throw new Error(`429 after ${attempts} attempts`)
      console.log(`  [429] waiting ${wait}s`)
      await new Promise(r => setTimeout(r, wait * 1000))
      continue
    }
    const cost = Number(res.headers.get('x-credits-cost'))
    const rem = res.headers.get('x-credits-remaining')
    const lim = res.headers.get('x-credits-limit')
    if (rem != null) lastRemaining = Number(rem)
    if (lim != null) lastLimit = Number(lim)
    creditsSpent += Number.isFinite(cost) && cost > 0 ? cost : 1
    if (res.status >= 500 && attempts < 3) {
      await new Promise(r => setTimeout(r, 1000 * attempts))
      continue
    }
    const body = await res.json().catch(() => null)
    return { status: res.status, body }
  }
}

// Start ingestion run row
async function startRun() {
  const { data, error } = await sb.from('pokemon_tcg_ingestion_runs').insert({
    kind: 'full_catalogue',
    provider: 'tcggraph',
    pp_language: LANGS.join('+'),
    state: 'running',
    metadata: { catalogue_version: CATALOGUE_VERSION, langs: LANGS },
  }).select('id').single()
  if (error) throw new Error(`run insert: ${error.message}`)
  console.log(`[run] started ${data.id}`)
  return data.id
}

async function finishRun(id, state, extra = {}) {
  const payload = {
    state,
    finished_at: new Date().toISOString(),
    credits_spent: creditsSpent,
    requests_made: requestsMade,
    ...extra,
  }
  await sb.from('pokemon_tcg_ingestion_runs').update(payload).eq('id', id)
}

function sanitizeFinish(finish) {
  if (!finish) return null
  return String(finish).slice(0, 64)
}

function cardToProviderRows(card) {
  const printings = card.printings || []
  const providerCardRows = []
  const marketRows = []
  const gradedRows = []

  const basePrint = {
    provider: 'tcggraph',
    tcg_card_id: card.id,
    tcg_set_code: card.set?.code || null,
    tcg_set_name: card.set?.name || null,
    tcg_language: card.language,
    tcg_card_name: card.name,
    tcg_collector_number: card.collectorNumber ?? null,
    tcg_rarity: card.rarity ?? null,
    base_card_id: card.baseCardId ?? null,
    english_id: card.englishId ?? null,
    price_status: card.priceStatus ?? null,
    catalogue_version: CATALOGUE_VERSION,
  }

  // Provider card: one row per printing_key
  if (printings.length === 0) {
    providerCardRows.push({
      ...basePrint,
      tcg_printing_key: 'normal',
      image_small: card.images?.small ?? null,
      image_normal: card.images?.normal ?? null,
      image_large: card.images?.large ?? null,
      image_source: card.imageFrom ?? null,
      prices_updated_at: null,
      graded_updated_at: null,
      raw_payload: { has_printings: false },
    })
  } else {
    for (const p of printings) {
      providerCardRows.push({
        ...basePrint,
        tcg_printing_key: p.key || 'normal',
        image_small: p.images?.small ?? card.images?.small ?? null,
        image_normal: p.images?.normal ?? card.images?.normal ?? null,
        image_large: p.images?.large ?? card.images?.large ?? null,
        image_source: p.imageFrom ?? card.imageFrom ?? null,
        prices_updated_at: null,       // filled below from the price with max updatedAt
        graded_updated_at: null,
        raw_payload: { external_ids: p.externalIds || null, label: p.label, kind: p.kind },
      })
      // Prices on this printing
      for (const pr of (p.prices || [])) {
        marketRows.push({
          provider: 'tcggraph',
          tcg_card_id: card.id,
          tcg_printing_key: p.key || 'normal',
          source: pr.source,
          region: pr.region ?? null,
          list_type: pr.listType || 'retail',
          finish: sanitizeFinish(pr.finish),
          currency: pr.currency,
          market: pr.market ?? null,
          low: pr.low ?? null,
          trend: pr.trend ?? null,
          avg1: pr.avg1 ?? null,
          avg7: pr.avg7 ?? null,
          avg30: pr.avg30 ?? null,
          basis: pr.basis ?? null,
          source_updated_at: pr.updatedAt ?? null,
        })
      }
    }
  }

  // Top-level prices too (sometimes populated when no printing-specific match)
  for (const pr of (card.prices || [])) {
    marketRows.push({
      provider: 'tcggraph',
      tcg_card_id: card.id,
      tcg_printing_key: 'normal',
      source: pr.source,
      region: pr.region ?? null,
      list_type: pr.listType || 'retail',
      finish: sanitizeFinish(pr.finish),
      currency: pr.currency,
      market: pr.market ?? null,
      low: pr.low ?? null,
      trend: pr.trend ?? null,
      avg1: pr.avg1 ?? null,
      avg7: pr.avg7 ?? null,
      avg30: pr.avg30 ?? null,
      basis: pr.basis ?? null,
      source_updated_at: pr.updatedAt ?? null,
    })
  }

  // Graded prices are per-card (not per-printing on the API)
  for (const g of (card.gradedPrices || [])) {
    gradedRows.push({
      provider: 'tcggraph',
      tcg_card_id: card.id,
      grader: g.grader,
      grade: String(g.grade),
      currency: g.currency || 'USD',
      price: g.price ?? null,
      sales_volume: g.salesVolume ?? null,
      source_updated_at: g.updatedAt ?? null,
    })
  }

  return { providerCardRows, marketRows, gradedRows }
}

async function bulkUpsert(table, rows, onConflict, batch = 500) {
  // Dedupe within a batch on the conflict key to avoid "ON CONFLICT
  // cannot affect row a second time" from Postgres.
  const seen = new Set()
  const keys = onConflict.split(',').map(s => s.trim())
  const deduped = []
  for (const r of rows) {
    const k = keys.map(c => String(r[c] ?? '∅')).join('|')
    if (seen.has(k)) continue
    seen.add(k); deduped.push(r)
  }
  for (let i = 0; i < deduped.length; i += batch) {
    const chunk = deduped.slice(i, i + batch)
    const { error } = await sb.from(table).upsert(chunk, { onConflict })
    if (error) throw new Error(`${table} chunk ${i}: ${error.message}`)
  }
  return deduped.length
}

async function ingestLanguage(lang, runId) {
  console.log(`\n[lang=${lang}] starting`)
  let page = 1
  let totalCards = 0
  const providerCards = []
  const marketPrices = []
  const gradedPrices = []
  while (true) {
    if (creditsSpent >= CREDIT_CAP - 20) {
      console.log(`  stopping ${lang} early: credit cap approaching`)
      break
    }
    const res = await tcg('/v1/cards', { game: 'pokemon', language: lang, page, limit: PAGE_LIMIT })
    if (res.status !== 200) throw new Error(`${lang} page ${page}: ${res.status}`)
    const data = res.body?.data || []
    const meta = res.body?.meta || {}
    totalCards += data.length
    for (const c of data) {
      const { providerCardRows, marketRows, gradedRows } = cardToProviderRows(c)
      providerCards.push(...providerCardRows)
      marketPrices.push(...marketRows)
      gradedPrices.push(...gradedRows)
    }
    if ((page % 20) === 0 || !meta.hasMore) {
      console.log(`  ${lang} page ${page}: +${data.length} cards (total ${totalCards} / ${meta.totalCount || '?'}), credits=${creditsSpent}`)
    }
    if (!meta.hasMore || data.length === 0) break
    page += 1
    if (page > SAFETY_CAP_PAGES) { console.log(`  safety cap page=${SAFETY_CAP_PAGES} hit`); break }
  }
  console.log(`[lang=${lang}] cards=${totalCards}, market=${marketPrices.length}, graded=${gradedPrices.length}`)

  console.log(`[lang=${lang}] upserting provider cards…`)
  const pcN = await bulkUpsert('pokemon_tcg_provider_cards', providerCards, 'provider,tcg_card_id,tcg_printing_key')
  console.log(`[lang=${lang}] upserting market prices…`)
  const mkN = await bulkUpsert('pokemon_tcg_prices_market', marketPrices, 'provider,tcg_card_id,tcg_printing_key,source,list_type,finish,currency')
  console.log(`[lang=${lang}] upserting graded prices…`)
  const gdN = await bulkUpsert('pokemon_tcg_prices_graded', gradedPrices, 'provider,tcg_card_id,grader,grade')
  return { totalCards, providerCards: pcN, marketPrices: mkN, gradedPrices: gdN }
}

// -------- Main --------
let runId = null
try {
  runId = await startRun()

  // Preflight: /v1/games/pokemon to confirm credits remaining
  const pre = await tcg('/v1/games/pokemon')
  if (pre.status !== 200) throw new Error(`preflight: ${pre.status}`)
  console.log(`[preflight] monthly remaining: ${lastRemaining} / ${lastLimit}`)

  let totals = { totalCards: 0, providerCards: 0, marketPrices: 0, gradedPrices: 0 }
  for (const lang of LANGS) {
    const r = await ingestLanguage(lang, runId)
    totals.totalCards += r.totalCards
    totals.providerCards += r.providerCards
    totals.marketPrices += r.marketPrices
    totals.gradedPrices += r.gradedPrices
  }

  await finishRun(runId, 'completed', {
    cards_ingested: totals.providerCards,
    prices_market_rows: totals.marketPrices,
    prices_graded_rows: totals.gradedPrices,
    metadata: {
      catalogue_version: CATALOGUE_VERSION,
      langs: LANGS,
      monthly_remaining: lastRemaining,
      totals,
    },
  })

  console.log('\n[DONE]')
  console.log(`credits spent:    ${creditsSpent}`)
  console.log(`requests made:    ${requestsMade}`)
  console.log(`provider cards:   ${totals.providerCards}`)
  console.log(`market prices:    ${totals.marketPrices}`)
  console.log(`graded prices:    ${totals.gradedPrices}`)
  console.log(`monthly remaining:${lastRemaining} / ${lastLimit}`)
  writeFileSync('scripts/_pp-tcg-migrate-01/ingest.json', JSON.stringify({ run_id: runId, totals, credits_spent: creditsSpent, monthly_remaining: lastRemaining }, null, 2))
} catch (err) {
  console.error('[err]', err.message)
  if (runId) await finishRun(runId, 'failed', { error_message: err.message })
  process.exit(1)
}

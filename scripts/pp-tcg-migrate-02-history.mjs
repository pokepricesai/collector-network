// PP-TCG-MIGRATE-02: ingest historical price series for a curated
// set of sample cards used by the admin preview.
//
// /v1/prices/{id}/history costs 3 credits per call per series. We
// pull one series per card by default (whichever TCGGraph returns —
// usually market cardmarket-normal). For graded history we'd pass
// grader + grade params.
//
// Credit cost: 30 sample cards × 3 cr = 90 credits.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

const API_KEY = readFileSync('C:/Users/lukep/OneDrive/Desktop/mtgprices-web/.env.local', 'utf-8')
  .split('\n').find(l => l.startsWith('TCGGRAPH_API_KEY='))
  .slice('TCGGRAPH_API_KEY='.length).replace(/["\r]/g, '').trim()

const CREDIT_CAP = 150
let creditsSpent = 0
let requestsMade = 0

mkdirSync('scripts/_pp-tcg-migrate-02', { recursive: true })

async function tcg(path, params = {}) {
  if (creditsSpent >= CREDIT_CAP) throw new Error('cap')
  const url = new URL(path, 'https://api.tcggraph.com')
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v))
  requestsMade += 1
  const r = await fetch(url.href, { headers: { authorization: `Bearer ${API_KEY}`, accept: 'application/json' } })
  const cost = Number(r.headers.get('x-credits-cost'))
  creditsSpent += Number.isFinite(cost) && cost > 0 ? cost : 1
  const b = await r.json().catch(() => null)
  return { status: r.status, body: b }
}

// Curated card ids spanning cohorts.
// Deterministic — we pick representative cards from each cohort we
// surface on the preview index.
const SAMPLE_SLUGS = []
for (const [preset, filter] of [
  ['vintage_bulk_safe', q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').in('pp_set_name', ['Base Set','Jungle','Fossil','Base Set 2','Team Rocket','Neo Genesis'])],
  ['modern_bulk_safe', q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').ilike('pp_set_name', '%Scarlet%')],
  ['ja_bulk_safe',     q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'jp')],
  ['variant_1st_ed',   q => q.eq('pricing_eligibility', 'market_only').ilike('pp_card_name', '%[1st Edition]%')],
  ['variant_shad',     q => q.eq('pricing_eligibility', 'market_only').ilike('pp_card_name', '%[Shadowless]%')],
  ['variant_rh',       q => q.eq('pricing_eligibility', 'market_only').ilike('pp_card_name', '%[Reverse Holo]%')],
  ['high_traffic',     q => q.not('commercial_rank', 'is', null).order('commercial_rank', { ascending: true })],
]) {
  let q = sb.from('pokemon_tcg_mappings')
    .select('pp_card_slug, tcg_card_id, tcg_printing_key, pricing_eligibility, pp_card_name, pp_set_name')
    .eq('provider', 'tcggraph').not('tcg_card_id', 'is', null).limit(4)
  q = filter(q)
  const { data } = await q
  for (const r of (data || [])) SAMPLE_SLUGS.push({ cohort: preset, ...r })
}
// Dedupe by tcg_card_id to avoid wasting credits on duplicates
const seen = new Set(), picks = []
for (const r of SAMPLE_SLUGS) {
  if (seen.has(r.tcg_card_id)) continue
  seen.add(r.tcg_card_id); picks.push(r)
}
console.log(`[sample] ${picks.length} unique cards selected across cohorts`)

const historyRows = []
let picksProcessed = 0
for (const r of picks) {
  if (creditsSpent >= CREDIT_CAP - 10) break
  const res = await tcg(`/v1/prices/${encodeURIComponent(r.tcg_card_id)}/history`)
  picksProcessed += 1
  if (res.status !== 200) {
    console.log(`  ${r.tcg_card_id}: HTTP ${res.status}`)
    continue
  }
  const data = res.body?.data
  if (!data) continue
  const kind = data.grader ? 'graded' : 'market'
  for (const p of (data.points || [])) {
    historyRows.push({
      provider: 'tcggraph',
      tcg_card_id: data.cardId,
      tcg_printing_key: r.tcg_printing_key || 'normal',
      series_kind: kind,
      source: data.source || null,
      finish: data.finish || null,
      grader: data.grader || null,
      grade: data.grade ? String(data.grade) : null,
      currency: p.currency || 'USD',
      day: p.day,
      market: p.market ?? null,
      low: p.low ?? null,
    })
  }
  if ((picksProcessed % 5) === 0) {
    console.log(`  processed ${picksProcessed}/${picks.length}, history rows=${historyRows.length}, credits=${creditsSpent}`)
  }
}
console.log(`[fetch] ${picksProcessed} cards, ${historyRows.length} history points, ${creditsSpent} credits`)

// Dedupe within batch on the unique key
const seenKey = new Set(), dedup = []
for (const r of historyRows) {
  const k = [r.provider, r.tcg_card_id, r.tcg_printing_key, r.series_kind, r.source, r.finish, r.grader, r.grade, r.day].join('|')
  if (seenKey.has(k)) continue
  seenKey.add(k); dedup.push(r)
}
console.log(`[dedupe] ${historyRows.length} → ${dedup.length} history rows`)

// Bulk upsert
const BATCH = 500
for (let i = 0; i < dedup.length; i += BATCH) {
  const chunk = dedup.slice(i, i + BATCH)
  const { error } = await sb.from('pokemon_tcg_prices_history').upsert(chunk, {
    onConflict: 'provider,tcg_card_id,tcg_printing_key,series_kind,source,finish,grader,grade,day',
  })
  if (error) throw new Error(`history chunk ${i}: ${error.message}`)
}

// Operational log
await sb.from('pokemon_tcg_ingestion_runs').insert({
  kind: 'history_batch', provider: 'tcggraph', state: 'completed',
  started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
  credits_spent: creditsSpent, requests_made: requestsMade,
  metadata: { kind: 'sample_history', picks: picksProcessed, history_points: dedup.length },
})

writeFileSync('scripts/_pp-tcg-migrate-02/history-ingest.json', JSON.stringify({
  cohorts_sampled: picks.length, history_points: dedup.length, credits_spent: creditsSpent,
}, null, 2))
console.log(`\n[DONE] ${dedup.length} points, ${creditsSpent} credits`)

// PP-TCG-MIGRATE-01: new-set discovery job.
//
// Enumerate /v1/sets?game=pokemon with language={en,ja}, diff
// against pokemon_tcg_sets_observed, write snapshot rows, open an
// alert for every new set code or materially-changed set.
//
// Credit cost per run: 1 (preflight) + ceil(230/100)=3 (EN sets)
// + ceil(453/100)=5 (JA sets) = 9 credits. Daily cadence budget:
// 9 × 30 = 270/mo. Trivial.
//
// This script is standalone + idempotent. It is NOT registered as
// a hub cron in this migration. The admin page shows "Last run"
// and offers a Run Now button; recurring cron scheduling is a
// Phase-8 operator decision.

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

const CREDIT_CAP = 50
let creditsSpent = 0
let requestsMade = 0

async function tcg(path, params = {}) {
  if (creditsSpent >= CREDIT_CAP) throw new Error(`cap ${CREDIT_CAP}`)
  const url = new URL(path, 'https://api.tcggraph.com')
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v))
  requestsMade += 1
  const r = await fetch(url.href, { headers: { authorization: `Bearer ${API_KEY}`, accept: 'application/json' } })
  const cost = Number(r.headers.get('x-credits-cost'))
  creditsSpent += Number.isFinite(cost) && cost > 0 ? cost : 1
  const b = await r.json().catch(() => null)
  return { status: r.status, body: b }
}

async function fetchSetsForLang(language) {
  const all = []
  let page = 1
  while (true) {
    const r = await tcg('/v1/sets', { game: 'pokemon', language, page, limit: 100 })
    if (r.status !== 200) throw new Error(`sets ${language} page ${page}: ${r.status}`)
    const rows = r.body?.data || []
    for (const s of rows) {
      all.push({
        tcg_set_code: s.code,
        tcg_set_name: s.name,
        tcg_language: s.language,
        released_at: s.releasedAt || null,
        card_count: s.cards ?? null,
        printing_count: s.counts?.printings ?? null,
      })
    }
    if (!r.body?.meta?.hasMore || rows.length === 0) break
    page += 1
    if (page > 20) break
  }
  return all
}

async function startRun() {
  const { data, error } = await sb.from('pokemon_tcg_ingestion_runs').insert({
    kind: 'set_discovery', provider: 'tcggraph', state: 'running',
  }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}
async function finishRun(id, state, extra = {}) {
  await sb.from('pokemon_tcg_ingestion_runs').update({
    state, finished_at: new Date().toISOString(),
    credits_spent: creditsSpent, requests_made: requestsMade, ...extra,
  }).eq('id', id)
}

const runId = await startRun()
try {
  console.log('[sets] fetching EN + JA sets...')
  const enSets = await fetchSetsForLang('en')
  const jaSets = await fetchSetsForLang('ja')
  const observed = [...enSets, ...jaSets]
  const observed_at = new Date().toISOString()
  for (const s of observed) s.observed_at = observed_at
  console.log(`[sets] got ${enSets.length} EN + ${jaSets.length} JA = ${observed.length}`)

  // Load the last-known snapshot per set_code (most recent observation).
  const { data: lastRows, error } = await sb
    .from('pokemon_tcg_sets_observed')
    .select('tcg_set_code, tcg_set_name, tcg_language, released_at, card_count, observed_at')
    .order('observed_at', { ascending: false })
  if (error) throw new Error(`last snapshot: ${error.message}`)

  const lastByCode = new Map()
  for (const r of (lastRows || [])) {
    if (!lastByCode.has(r.tcg_set_code)) lastByCode.set(r.tcg_set_code, r)
  }

  // Dedupe snapshot inserts within this run (some codes exist for
  // both EN and JA sets endpoints; the TCG API also returns a few
  // dupes across pages for cross-language sets). We keep whichever
  // row we saw last for a given (code, observed_at).
  const seen = new Set()
  const toInsert = []
  for (const o of observed) {
    const k = `${o.tcg_set_code}|${observed_at}`
    if (seen.has(k)) continue
    seen.add(k)
    toInsert.push({
      provider: 'tcggraph', tcg_set_code: o.tcg_set_code,
      tcg_set_name: o.tcg_set_name, tcg_language: o.tcg_language,
      released_at: o.released_at, card_count: o.card_count,
      printing_count: o.printing_count, observed_at,
    })
  }

  const BATCH = 500
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH)
    const { error: insErr } = await sb.from('pokemon_tcg_sets_observed').upsert(chunk, {
      onConflict: 'provider,tcg_set_code,observed_at',
    })
    if (insErr) throw new Error(`snapshot: ${insErr.message}`)
  }
  console.log(`[sets] inserted ${toInsert.length} snapshot rows`)

  // Diff + open alerts
  const alerts = []
  for (const o of observed) {
    const prev = lastByCode.get(o.tcg_set_code)
    if (!prev) {
      alerts.push({
        provider: 'tcggraph', kind: 'new_set',
        tcg_set_code: o.tcg_set_code, tcg_set_name: o.tcg_set_name, tcg_language: o.tcg_language,
        payload: { released_at: o.released_at, card_count: o.card_count },
      })
    } else {
      if ((prev.card_count ?? null) !== (o.card_count ?? null)) {
        alerts.push({
          provider: 'tcggraph', kind: 'card_count_changed',
          tcg_set_code: o.tcg_set_code, tcg_set_name: o.tcg_set_name, tcg_language: o.tcg_language,
          payload: { previous: prev.card_count, current: o.card_count },
        })
      }
      if ((prev.released_at ?? null) !== (o.released_at ?? null)) {
        alerts.push({
          provider: 'tcggraph', kind: 'release_date_changed',
          tcg_set_code: o.tcg_set_code, tcg_set_name: o.tcg_set_name, tcg_language: o.tcg_language,
          payload: { previous: prev.released_at, current: o.released_at },
        })
      }
    }
  }

  // Only open an alert if an identical alert isn't already open (unacknowledged)
  let opened = 0
  for (const a of alerts) {
    const { count } = await sb.from('pokemon_tcg_set_alerts').select('id', { count: 'exact', head: true })
      .eq('provider', a.provider).eq('kind', a.kind).eq('tcg_set_code', a.tcg_set_code)
      .is('acknowledged_at', null)
    if ((count ?? 0) > 0) continue
    const { error: alErr } = await sb.from('pokemon_tcg_set_alerts').insert(a)
    if (alErr) console.error(`alert insert: ${alErr.message}`)
    else opened += 1
  }
  console.log(`[alerts] detected: ${alerts.length}, newly opened: ${opened}`)

  await finishRun(runId, 'completed', { sets_observed: observed.length, alerts_opened: opened })

  const summary = {
    run_id: runId, en_sets: enSets.length, ja_sets: jaSets.length,
    alerts_total: alerts.length, alerts_opened: opened, credits_spent: creditsSpent,
  }
  mkdirSync('scripts/_pp-tcg-migrate-01', { recursive: true })
  writeFileSync('scripts/_pp-tcg-migrate-01/discover.json', JSON.stringify(summary, null, 2))
  console.log(`\n[done]`, summary)
} catch (err) {
  console.error('[err]', err.message)
  await finishRun(runId, 'failed', { error_message: err.message })
  process.exit(1)
}

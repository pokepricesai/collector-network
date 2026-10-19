// PP-TCG-PRINTING-RECLASS-FIX §1-§3 — detect reclassified printings and
// mark them `superseded`. Safe-by-default: only marks when a COMPLETE
// API response for the same (set, language) confirms the stored
// printing_key has been reclassified (same card_id, new printing_key).
//
// Usage:
//   node scripts/pp-tcg-reclass-fix-01-detect-mark.mjs                  # dry-run
//   node scripts/pp-tcg-reclass-fix-01-detect-mark.mjs --apply           # mark superseded
//   node scripts/pp-tcg-reclass-fix-01-detect-mark.mjs --budget 60       # cap credits
//   node scripts/pp-tcg-reclass-fix-01-detect-mark.mjs --pair sp5|ja     # single-pair mode
//
// Reads TCGGraph API ($$ credits). Dry-run default. Budget cap defaults 60.

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const APPLY = process.argv.includes('--apply')
const PAIR_IDX = process.argv.indexOf('--pair')
const PAIR = PAIR_IDX > -1 ? process.argv[PAIR_IDX + 1] : null
const BUDGET_IDX = process.argv.indexOf('--budget')
const BUDGET = BUDGET_IDX > -1 ? Number(process.argv[BUDGET_IDX + 1]) : 60

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

const apiKey = process.env.TCGGRAPH_API_KEY
if (!apiKey) { console.error('TCGGRAPH_API_KEY must be in env'); process.exit(1) }

mkdirSync('scripts/_pp-tcg-reclass-fix', { recursive: true })

// Pull the current scattered-orphan cohort (daily-2026-10-18 across (set, lang)
// pairs excluding the known seeding-gap pairs that will be refreshed naturally).
const SEEDING_GAP = new Set(['xyp|ja','xy10|ja','sv6|ja','sm7|ja','sm8|ja','bw2|ja','bw4|ja'])
const scattered = []
{
  let from = 0
  while (true) {
    const { data } = await sb.from('pokemon_tcg_provider_cards')
      .select('tcg_set_code,tcg_language,tcg_card_id,tcg_printing_key,provider_status')
      .eq('catalogue_version', 'daily-2026-10-18')
      .range(from, from + 999)
    if (!data || !data.length) break
    scattered.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
}
const candidates = scattered.filter(r => !SEEDING_GAP.has(r.tcg_set_code + '|' + r.tcg_language) && r.provider_status === 'active')
const pairsSet = new Set(candidates.map(r => r.tcg_set_code + '|' + r.tcg_language))

const pairs = PAIR ? [PAIR] : [...pairsSet].sort()
console.log(`[1/4] Candidate (set, lang) pairs: ${pairs.length}`)
console.log(`      Candidate orphan rows (dry-run target max): ${candidates.length}`)

let spent = 0
const findings = []

async function fetchAllPages(set, lang) {
  const results = []
  let page = 1
  let completed = false
  let lastRemaining = null
  while (page <= 20) {
    if (spent >= BUDGET) throw new Error('BUDGET_CAP')
    const u = new URL('https://api.tcggraph.com/v1/cards')
    u.searchParams.set('game','pokemon'); u.searchParams.set('set',set); u.searchParams.set('language',lang)
    u.searchParams.set('page',String(page)); u.searchParams.set('limit','100')
    const r = await fetch(u, { headers: { authorization: 'Bearer ' + apiKey, accept: 'application/json' } })
    if (r.status !== 200) throw new Error(`HTTP ${r.status} on ${set}|${lang} p${page}`)
    const cost = Number(r.headers.get('x-credits-cost'))
    const rem = Number(r.headers.get('x-credits-remaining'))
    if (Number.isFinite(cost) && cost > 0) spent += cost
    if (Number.isFinite(rem)) lastRemaining = rem
    const body = await r.json()
    results.push(...(body.data || []))
    if (!body.meta?.hasMore || !(body.data?.length)) { completed = true; break }
    page += 1
  }
  if (!completed) throw new Error(`PAGINATION_INCOMPLETE: ${set}|${lang} hit page-20 cap`)
  return { cards: results, lastRemaining }
}

console.log(`\n[2/4] Probing TCGGraph (budget=${BUDGET}cr, ${APPLY ? 'APPLY' : 'DRY-RUN'})...`)
for (const key of pairs) {
  if (spent >= BUDGET) { console.log(`  BUDGET CAP (${BUDGET}cr) — stopping probes.`); break }
  const [set, lang] = key.split('|')
  try {
    const { cards, lastRemaining } = await fetchAllPages(set, lang)
    // Build (card_id → set of printing_keys) from API
    const apiPrintings = new Map()
    for (const c of cards) {
      const keys = new Set()
      if (!c.printings || c.printings.length === 0) keys.add('normal')
      for (const p of (c.printings || [])) keys.add(p.key || 'normal')
      apiPrintings.set(c.id, keys)
    }
    // Pull stored active rows for this (set, lang)
    const { data: storedActive } = await sb.from('pokemon_tcg_provider_cards')
      .select('id,tcg_card_id,tcg_printing_key,catalogue_version')
      .eq('tcg_set_code', set).eq('tcg_language', lang).eq('provider_status', 'active')
    // Identify RECLASSIFICATION candidates: card_id is in API, but printing_key is NOT
    const reclass = []
    const removedCardId = []
    const legitActive = []
    for (const s of (storedActive || [])) {
      const apiKeys = apiPrintings.get(s.tcg_card_id)
      if (!apiKeys) { removedCardId.push(s); continue }
      if (apiKeys.has(s.tcg_printing_key)) { legitActive.push(s); continue }
      // Same card_id, DIFFERENT printing_key — reclassification candidate
      const newKey = [...apiKeys][0] || null       // one of the new keys
      reclass.push({ ...s, superseded_by_printing_key: newKey, api_keys: [...apiKeys] })
    }
    findings.push({ pair: key, api_cards: cards.length, stored_active: storedActive?.length ?? 0, reclass: reclass.length, removed_card_id: removedCardId.length, legit: legitActive.length, remaining_cr: lastRemaining, reclass_details: reclass })
    console.log(`  ${key.padEnd(14)} api=${cards.length} stored=${storedActive?.length ?? 0} reclass=${reclass.length} removed=${removedCardId.length} legit=${legitActive.length} (spent=${spent}cr)`)
    if (APPLY && reclass.length > 0) {
      // Mark each reclassified row as superseded. One-by-one update with audit metadata.
      for (const r of reclass) {
        const { error } = await sb.from('pokemon_tcg_provider_cards').update({
          provider_status: 'superseded',
          superseded_at: new Date().toISOString(),
          superseded_reason: `tcggraph reclassified printing_key: '${r.tcg_printing_key}' → '${r.superseded_by_printing_key}'`,
          superseded_by_printing_key: r.superseded_by_printing_key,
        }).eq('id', r.id).eq('provider_status', 'active')     // optimistic: don't double-mark
        if (error) throw new Error(`update ${r.id}: ${error.message}`)
      }
    }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e))
    findings.push({ pair: key, error: msg })
    if (msg === 'BUDGET_CAP') { console.log(`  BUDGET CAP — stopping probes.`); break }
    console.log(`  ${key.padEnd(14)} ERROR: ${msg}`)
  }
}

console.log(`\n[3/4] Total credits spent: ${spent} / ${BUDGET}`)
console.log(`      Pairs probed: ${findings.filter(f => !f.error).length}`)
console.log(`      Pairs with ANY reclass orphan: ${findings.filter(f => (f.reclass ?? 0) > 0).length}`)
console.log(`      Total reclass orphans: ${findings.reduce((s, f) => s + (f.reclass ?? 0), 0)}`)
console.log(`      Total removed card_ids (NOT marked, requires separate review): ${findings.reduce((s, f) => s + (f.removed_card_id ?? 0), 0)}`)

const outPath = APPLY ? 'scripts/_pp-tcg-reclass-fix/apply-run.json' : 'scripts/_pp-tcg-reclass-fix/dry-run.json'
writeFileSync(outPath, JSON.stringify({ mode: APPLY ? 'applied' : 'dry_run', spent, budget: BUDGET, findings }, null, 2))
console.log(`\n[4/4] Report: ${outPath}`)

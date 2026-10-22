// PP-TCG-APPROVAL-02 §3 — independent cross-check against pokemontcg.io.
//
// Pokemontcg.io is a free community-maintained Pokémon TCG catalogue
// separate from TCGGraph. For each card in the 25-card validation
// sample we:
//   1. Pull TCG card identity from TCGGraph (name, set code, collector#)
//   2. Query pokemontcg.io by set.id + number
//   3. Compare: name match, number match, image existence
//
// Pass criteria: exact name match (normalised) + exact number match.
// Fail criteria: either differ, OR pokemontcg.io has no entry.
//
// Rate-limit: pokemontcg.io is 1000 req/hr without key. 25 req is trivial.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-qa', { recursive: true })

function normName(s) {
  if (!s) return ''
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').trim()
}

// Load the 25-card sample
const sample = JSON.parse(readFileSync('scripts/_pp-tcg-match-qa/validation-sample.json', 'utf-8'))

async function ptcgQuery(setId, number, retries = 4) {
  const url = `https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(setId)}%20number:${encodeURIComponent(number)}`
  for (let a = 0; a < retries; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'pp-tcg-qa-crosscheck/1.0' } })
      if (r.ok) {
        const j = await r.json()
        return { data: j.data || [] }
      }
      if (r.status === 500 || r.status === 502 || r.status === 503 || r.status === 429) {
        await new Promise(res => setTimeout(res, 1500 * (a + 1)))
        continue
      }
      return { error: `http ${r.status}` }
    } catch (e) {
      if (a === retries - 1) return { error: e.message }
      await new Promise(res => setTimeout(res, 1500 * (a + 1)))
    }
  }
  return { error: 'retries exhausted' }
}

const report = { by_cohort: {}, pass: 0, fail: 0, no_entry: 0, errors: 0 }

console.log('Cross-check against pokemontcg.io (free, no key)\n')

for (const [cohort, cards] of Object.entries(sample)) {
  console.log(`\n=== ${cohort} ===`)
  report.by_cohort[cohort] = { pass: 0, fail: 0, no_entry: 0, cards: [] }

  for (const c of cards) {
    const tcgSetCode = c.tcg?.tcg_set_code
    const tcgNumber = c.tcg?.tcg_collector_number
    const tcgName = c.tcg?.tcg_card_name
    const ppName = c.pp?.card_name
    const ppNumber = c.pp?.card_number

    const result = await ptcgQuery(tcgSetCode, tcgNumber)
    let verdict, note
    if (result.error) {
      verdict = 'error'
      note = result.error
      report.errors++
    } else if (result.data.length === 0) {
      verdict = 'no_entry'
      note = `no pokemontcg.io record for set=${tcgSetCode} number=${tcgNumber}`
      report.by_cohort[cohort].no_entry++
      report.no_entry++
    } else {
      // Multiple hits possible (variant cards). Prefer first hit by set code.
      const hit = result.data[0]
      const nameMatch = normName(tcgName) === normName(hit.name)
      const numberMatch = String(tcgNumber) === String(hit.number)
      const imagePresent = !!hit.images?.large
      if (nameMatch && numberMatch) {
        verdict = 'pass'
        note = `pokemontcg.io agrees: "${hit.name}" #${hit.number}`
        report.by_cohort[cohort].pass++
        report.pass++
      } else {
        verdict = 'fail'
        note = `pokemontcg.io has: "${hit.name}" #${hit.number} | ours: "${tcgName}" #${tcgNumber}`
        report.by_cohort[cohort].fail++
        report.fail++
      }
    }
    report.by_cohort[cohort].cards.push({
      pp_slug: c.pp_card_slug,
      pp_name: ppName,
      pp_number: ppNumber,
      tcg_set_code: tcgSetCode,
      tcg_number: tcgNumber,
      tcg_name: tcgName,
      verdict,
      note,
    })
    console.log(`  [${verdict.toUpperCase().padEnd(8)}] ${(ppName || '').slice(0, 36).padEnd(36)} ${tcgSetCode}#${tcgNumber}  — ${note}`)
    await new Promise(r => setTimeout(r, 500))     // rate-limit gentle
  }
}

console.log('\n=== Totals ===')
console.log(`  PASS:     ${report.pass}`)
console.log(`  FAIL:     ${report.fail}`)
console.log(`  NO_ENTRY: ${report.no_entry}`)
console.log(`  ERROR:    ${report.errors}`)
console.log(`  TOTAL:    ${report.pass + report.fail + report.no_entry + report.errors}`)

writeFileSync('scripts/_pp-tcg-match-qa/pokemontcg-io-crosscheck.json', JSON.stringify(report, null, 2))
console.log('\nreport → scripts/_pp-tcg-match-qa/pokemontcg-io-crosscheck.json')

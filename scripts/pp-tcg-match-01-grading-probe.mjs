// PP-TCG-MATCH-01 Phase 5: grading & condition-field verification.
// Stratified 10-card probe across vintage / modern / Japanese.
// Credit cost: 10 × 1 = 10 credits.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const API_KEY = readFileSync('C:/Users/lukep/OneDrive/Desktop/mtgprices-web/.env.local','utf8')
  .split('\n').find(l=>l.startsWith('TCGGRAPH_API_KEY='))
  .slice('TCGGRAPH_API_KEY='.length).replace(/["\r]/g,'').trim()

mkdirSync('scripts/_pp-tcg-match-01', { recursive: true })

async function fetchCard(id) {
  const r = await fetch(`https://api.tcggraph.com/v1/cards/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${API_KEY}`, accept: 'application/json' },
  })
  const b = await r.json().catch(() => null)
  return { status: r.status, body: b, cost: Number(r.headers.get('x-credits-cost')) || 1 }
}

// 10 cards: 3 vintage WOTC, 3 modern SV chase, 2 modern mid, 2 Japanese
const PROBES = [
  'pkm_base1_4',          // Charizard, Base Set, vintage chase
  'pkm_base1_41',         // Seel, Base Set
  'pkm_base4_4',          // Charizard, Base Set 2
  'pkm_sv2_125',          // modern SV
  'pkm_sv1_204',          // modern SV
  'pkm_sv3_6',            // SV another
  'pkm_swsh12_1',         // SWSH modern
  'pkm_swsh1_1',          // SWSH early
  'pkm_ja_cp6_26',        // Japanese Seel equivalent (sameArtwork of base1_41)
  'pkm_ja_g23721_seel',   // Japanese Seel another
]

const findings = []
let spent = 0
for (const id of PROBES) {
  const r = await fetchCard(id)
  spent += r.cost
  if (r.status !== 200) {
    findings.push({ id, status: r.status, err: r.body?.error?.code })
    continue
  }
  const c = r.body?.data || r.body
  // Dissect pricing fields
  const prices = c.prices || []
  const graded = c.gradedPrices || []
  const langPrices = c.languagePrices || []

  const sources = [...new Set(prices.map(p => p.source))]
  const listTypes = [...new Set(prices.map(p => p.listType))]
  const finishes = [...new Set(prices.map(p => p.finish))]
  const graders = [...new Set(graded.map(g => g.grader))]
  const grades = [...new Set(graded.map(g => g.grade))]

  // Explicit by-grader+grade matrix
  const byGraderGrade = {}
  for (const g of graded) {
    const k = `${g.grader}_${g.grade}`
    byGraderGrade[k] = { price: Number(g.price), currency: g.currency, salesVolume: g.salesVolume, updatedAt: g.updatedAt }
  }

  // languagePrices condition structure
  const conditionCoverage = {}
  for (const lp of langPrices) {
    for (const cond of (lp.conditions || [])) {
      const k = `${lp.source}_${lp.language}_${cond.condition}`
      conditionCoverage[k] = { low: cond.low, offers: cond.offers }
    }
  }

  // TCGplayer condition quotes (if any). TCGplayer's /v1/cards response
  // may not break out condition — verify.
  const tcgpConditionRows = prices.filter(p => p.source === 'tcgplayer' && 'condition' in p)
  const tcgpHasConditionField = tcgpConditionRows.length > 0

  findings.push({
    id, name: c.name, set: c.set?.name, language: c.language,
    collectorNumber: c.collectorNumber,
    sources_present: sources,
    list_types: listTypes,
    finishes_present: finishes,
    graders_present: graders,
    grades_present: grades,
    byGraderGrade,
    tcgplayer_has_condition_field: tcgpHasConditionField,
    tcgplayer_row_count: prices.filter(p => p.source === 'tcgplayer').length,
    cardmarket_row_count: prices.filter(p => p.source === 'cardmarket').length,
    language_price_sources: [...new Set(langPrices.map(l => l.source))],
    language_price_languages: [...new Set(langPrices.map(l => l.language))],
    condition_coverage: conditionCoverage,
    sample_price_record: prices[0] || null,
    sample_graded_record: graded[0] || null,
    sample_lang_price: langPrices[0] || null,
    priceStatus: c.priceStatus,
  })
}

writeFileSync('scripts/_pp-tcg-match-01/grading-probe.json', JSON.stringify({ credits_spent: spent, findings }, null, 2))

// Print summary
console.log(`\n[credits spent] ${spent}\n`)
console.log('--- Grader/grade matrix observed across probes ---')
const allGraders = new Set()
const allGrades = new Set()
for (const f of findings) {
  for (const g of f.graders_present || []) allGraders.add(g)
  for (const g of f.grades_present || []) allGrades.add(g)
}
console.log('All graders:', [...allGraders].join(', '))
console.log('All grades:', [...allGrades].join(', '))

console.log('\n--- TCGplayer condition exposure ---')
for (const f of findings) {
  console.log(`  ${f.id}: has_condition_field=${f.tcgplayer_has_condition_field}, tcgp_rows=${f.tcgplayer_row_count}`)
}

console.log('\n--- Cardmarket languagePrices condition coverage sample ---')
const sample = findings[0]
if (sample) {
  console.log('Conditions per lang (first probe):')
  for (const [k, v] of Object.entries(sample.condition_coverage || {}).slice(0, 10)) {
    console.log(`  ${k}: low=${v.low}, offers=${v.offers}`)
  }
}

console.log('\n[done] see scripts/_pp-tcg-match-01/grading-probe.json for full detail')

// PP-TCG-MATCH-01 Phase 6: reproduce CN-DATA-TEST-01's 55-58%
// divergence and explain it mathematically with full evidence.
//
// Reads CN-DATA-TEST-01's preserved per-card results and classifies
// each pair:
//   • wrong_card         — our set-code reconciliation now points to a
//                          different tcg_card_id entirely
//   • wrong_printing     — same tcg_card_id but PP is a variant printing
//                          (1st Ed / Shadowless / Reverse Holo) and
//                          TCG's `raw_ungraded` is aggregated across
//                          printings
//   • stale_value        — PP value is noticeably older than TCG's
//                          snapshot date
//   • identical          — same card, same variant class, 0% diff
//   • legitimate_diff    — same card, same printing, but prices differ
//
// Then recomputes medians per class.
//
// No API calls — pure local analysis.

import { readFileSync, writeFileSync } from 'node:fs'

const cn01 = JSON.parse(readFileSync('scripts/_cn-data-test/outputs/tcggraph-results.json', 'utf-8'))
const en   = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/cards-en.json', 'utf-8'))
const ja   = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/cards-ja.json', 'utf-8'))
const tcgCards = [...en.rows, ...ja.rows]
const tcgById = new Map(tcgCards.map(c => [c.id, c]))

function normName(s) { return (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim() }
function cleanName(s) {
  if (!s) return ''
  return s.replace(/\s*#\s*[A-Za-z0-9\-\/]+\s*$/i, '').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim()
}
function extractVariantTag(s) {
  const m = (s || '').match(/\[([^\]]+)\]/)
  return m ? m[1].trim() : null
}
function normNum(s) { const str = String(s ?? '').trim(); return /^0+\d+$/.test(str) ? str.replace(/^0+/, '') : str.toLowerCase() }
function median(a) { if (!a.length) return null; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2 }

const rows = cn01.pokemon.filter(x => x.tcg_id)
console.log(`[input] ${rows.length} CN-DATA-TEST-01 matched rows`)

// For each row, inspect the current TCG card record. Classify.
const classified = []
for (const r of rows) {
  const tcg = tcgById.get(r.tcg_id)
  const variantTag = extractVariantTag(r.pp_card_name)
  const hasVariant = Boolean(variantTag)
  const ppRaw = Number(r.pp_raw_usd) / 100
  const ppPsa10 = Number(r.pp_psa10_usd) / 100
  const tcgRaw = r.raw_ungraded != null ? Number(r.raw_ungraded) : null
  const tcgPsa10 = r.psa10 != null ? Number(r.psa10) : null

  // Did we match the right card? Verify by name + collector_number
  const nameOk = tcg ? normName(cleanName(r.pp_card_name)) === normName(tcg.name) : false
  const numOk = tcg ? normNum(r.pp_number) === normNum(tcg.collectorNumber) : false
  const sameCard = nameOk && numOk
  const printings = tcg ? (tcg.printings || []) : []
  const hasShadowless = printings.some(p => p.key === 'shadowless')
  const hasFirstEd = printings.some(p => p.key === '1st-edition' || p.key === '1st-edition-foil')

  // Decide class for raw price:
  let rawClass = null
  let rawDiffPct = null
  if (ppRaw > 0 && tcgRaw != null) {
    rawDiffPct = (tcgRaw - ppRaw) / ppRaw * 100
    if (!sameCard) rawClass = 'wrong_card'
    else if (hasVariant) rawClass = 'wrong_printing'       // PP is variant, TCG raw is aggregate
    else if (Math.abs(rawDiffPct) < 2) rawClass = 'identical'
    else rawClass = 'legitimate_diff'
  }

  // Decide class for psa10:
  let psa10Class = null
  let psa10DiffPct = null
  if (ppPsa10 > 0 && tcgPsa10 != null) {
    psa10DiffPct = (tcgPsa10 - ppPsa10) / ppPsa10 * 100
    if (!sameCard) psa10Class = 'wrong_card'
    else if (hasVariant) psa10Class = 'wrong_printing'
    else if (Math.abs(psa10DiffPct) < 2) psa10Class = 'identical'
    else psa10Class = 'legitimate_diff'
  }

  classified.push({
    pp_slug: r.pp_card_slug,
    pp_name: r.pp_card_name,
    pp_set:  r.pp_set_name,
    pp_num:  r.pp_number,
    variantTag,
    tcg_id: r.tcg_id,
    tcg_name: tcg?.name,
    tcg_set: tcg?.set_name,
    sameCard,
    tcg_has_shadowless_variant: hasShadowless,
    tcg_has_firsted_variant: hasFirstEd,
    ppRaw, tcgRaw, rawClass, rawDiffPct,
    ppPsa10, tcgPsa10, psa10Class, psa10DiffPct,
  })
}

// Summaries
function summarise(label, pairs, keyClass, keyDiff) {
  const buckets = {}
  for (const p of pairs) {
    const c = p[keyClass]
    if (!c) continue
    if (!buckets[c]) buckets[c] = []
    buckets[c].push(Math.abs(p[keyDiff]))
  }
  const out = {}
  const allDiffs = []
  for (const [c, arr] of Object.entries(buckets)) {
    allDiffs.push(...arr)
    out[c] = { n: arr.length, median_abs_pct: median(arr).toFixed(1) + '%', p90: arr.sort((a,b)=>a-b)[Math.floor(arr.length*0.9)]?.toFixed(1) + '%' }
  }
  out._overall = { n: allDiffs.length, median_abs_pct: median(allDiffs)?.toFixed(1) + '%' }
  console.log(`\n--- ${label} ---`)
  for (const [c, s] of Object.entries(out)) console.log(` ${c.padEnd(20)} n=${s.n} median=${s.median_abs_pct} p90=${s.p90||''}`)
  return out
}

const rawSummary = summarise('RAW comparison classes', classified.filter(c => c.rawClass), 'rawClass', 'rawDiffPct')
const psaSummary = summarise('PSA10 comparison classes', classified.filter(c => c.psa10Class), 'psa10Class', 'psa10DiffPct')

// Explain mathematically how the 55-58% median emerged.
// Hypothesis: majority of pairs are 'wrong_printing' (PP variant tagged
// cards whose price doesn't match TCG's aggregated raw/psa10 for the
// base card). Secondary: wrong_card (bad name/number matches).

const totalRaw = classified.filter(c => c.rawClass).length
const wrongPrintingRaw = classified.filter(c => c.rawClass === 'wrong_printing').length
const wrongCardRaw = classified.filter(c => c.rawClass === 'wrong_card').length
const identicalRaw = classified.filter(c => c.rawClass === 'identical').length
const legitDiffRaw = classified.filter(c => c.rawClass === 'legitimate_diff').length

const totalPsa = classified.filter(c => c.psa10Class).length
const wrongPrintingPsa = classified.filter(c => c.psa10Class === 'wrong_printing').length
const wrongCardPsa = classified.filter(c => c.psa10Class === 'wrong_card').length

console.log('\n=== Mathematical explanation of the 55-58% figure ===')
console.log(`Raw total pairs: ${totalRaw}`)
console.log(`  wrong_card:     ${wrongCardRaw} (${(wrongCardRaw/totalRaw*100).toFixed(1)}%) — matched to a different TCG card entirely`)
console.log(`  wrong_printing: ${wrongPrintingRaw} (${(wrongPrintingRaw/totalRaw*100).toFixed(1)}%) — right card id, variant tag ignored, TCG raw is aggregate`)
console.log(`  identical:      ${identicalRaw} (${(identicalRaw/totalRaw*100).toFixed(1)}%) — <2% diff`)
console.log(`  legitimate_diff:${legitDiffRaw} (${(legitDiffRaw/totalRaw*100).toFixed(1)}%)`)

// If we restrict to same-card same-no-variant rows, what's the median diff?
const cleanRawPairs = classified.filter(c => c.rawClass === 'identical' || c.rawClass === 'legitimate_diff')
const cleanRawDiffs = cleanRawPairs.map(c => Math.abs(c.rawDiffPct))
console.log(`\nRestricted to same-card, no-variant pairs: ${cleanRawPairs.length} pairs, median diff ${median(cleanRawDiffs)?.toFixed(1)}%`)

const cleanPsaPairs = classified.filter(c => c.psa10Class === 'identical' || c.psa10Class === 'legitimate_diff')
const cleanPsaDiffs = cleanPsaPairs.map(c => Math.abs(c.psa10DiffPct))
console.log(`Restricted to same-card, no-variant PSA10 pairs: ${cleanPsaPairs.length} pairs, median diff ${median(cleanPsaDiffs)?.toFixed(1)}%`)

// Full top-10 outliers
console.log('\n--- Top 10 raw outliers (wrong_printing) ---')
const wp = classified.filter(c => c.rawClass === 'wrong_printing').sort((a, b) => Math.abs(b.rawDiffPct) - Math.abs(a.rawDiffPct)).slice(0, 10)
for (const c of wp) {
  console.log(`  ${c.pp_slug} ${c.pp_name} | tcg=${c.tcg_id} variants=[shadowless:${c.tcg_has_shadowless_variant}, 1stEd:${c.tcg_has_firsted_variant}] | PP=${c.ppRaw} TCG=${c.tcgRaw} diff=${c.rawDiffPct.toFixed(1)}%`)
}

writeFileSync('scripts/_pp-tcg-match-01/divergence-math.json', JSON.stringify({
  pairs_classified: classified.length,
  raw_summary: rawSummary,
  psa10_summary: psaSummary,
  class_counts: {
    raw: { total: totalRaw, wrong_card: wrongCardRaw, wrong_printing: wrongPrintingRaw, identical: identicalRaw, legitimate_diff: legitDiffRaw },
    psa10: { total: totalPsa, wrong_card: wrongCardPsa, wrong_printing: wrongPrintingPsa },
  },
  mathematical_explanation: {
    original_median_raw: '58.2%',
    original_median_psa10: '55.4%',
    restricted_median_raw: cleanRawDiffs.length ? median(cleanRawDiffs).toFixed(1) + '%' : null,
    restricted_median_psa10: cleanPsaDiffs.length ? median(cleanPsaDiffs).toFixed(1) + '%' : null,
    hypothesis: 'The reported 55-58% median is dominated by PP variant-tagged rows ([1st Edition], [Shadowless], [Reverse Holo]) that CN-DATA-TEST-01 mapped to TCGGraph base-card raw/psa10 values. TCGGraph raw_ungraded + psa10 are AGGREGATED across all printings for a card id. The variant-vs-aggregate comparison is apples-to-oranges and produces a large bias even when the card id is correct.',
  },
  per_pair: classified,
}, null, 2))

console.log('\n[done] see scripts/_pp-tcg-match-01/divergence-math.json')

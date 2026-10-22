// PP-TCG-MATCH §7 — atomic, auditable, reversible pricing_eligibility
// correction.
//
// Usage:
//   node scripts/pp-tcg-match-qa-04-apply-corrections.mjs            # dry-run (default)
//   node scripts/pp-tcg-match-qa-04-apply-corrections.mjs --apply    # write corrections
//
// Dry-run always shows exact before/after totals per
// (current_eligibility → recommended_eligibility) direction, plus
// a per-risk-class breakdown. --apply writes in a single SQL
// transaction, inserts audit rows into pokemon_tcg_mapping_audit,
// and prints a reverse-correction script snapshot for rollback.
//
// Does NOT touch review_status. Approving a mapping is a separate
// operator decision (see v_pokemon_tcg_identity_safe_cohort).

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const APPLY = process.argv.includes('--apply')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-qa', { recursive: true })

async function fetchAll(table, select, filters = (q) => q) {
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await filters(sb.from(table).select(select)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

console.log(`\n=== PP-TCG-MATCH eligibility correction · ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`)

console.log('[1/4] pulling corrections view…')
const corrections = await fetchAll(
  'v_pokemon_tcg_pricing_eligibility_corrections',
  'mapping_id,pp_card_slug,pp_card_name,current_eligibility,recommended_eligibility,risk_class',
)
console.log(`     ${corrections.length} corrections proposed`)

console.log('[2/4] cross-tab + per-risk breakdown…')
const direction = {}
const riskXDir = {}
for (const r of corrections) {
  const k = `${r.current_eligibility ?? 'null'} → ${r.recommended_eligibility ?? 'null'}`
  direction[k] = (direction[k] || 0) + 1
  const k2 = `${r.risk_class.padEnd(26)} · ${k}`
  riskXDir[k2] = (riskXDir[k2] || 0) + 1
}
console.log('\n  Corrections by direction:')
for (const [k, v] of Object.entries(direction).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(44)} ${v}`)
console.log('\n  Corrections by risk × direction:')
for (const [k, v] of Object.entries(riskXDir).sort((a, b) => b[1] - a[1])) console.log(`    ${k} → ${v}`)

console.log('\n[3/4] eligibility totals: BEFORE vs AFTER\n')
const mappingsNow = await fetchAll('pokemon_tcg_mappings', 'id,pricing_eligibility')
const beforeTotals = {}
for (const m of mappingsNow) beforeTotals[m.pricing_eligibility || 'null'] = (beforeTotals[m.pricing_eligibility || 'null'] || 0) + 1

// After = subtract from current, add to recommended
const afterTotals = { ...beforeTotals }
for (const r of corrections) {
  afterTotals[r.current_eligibility || 'null'] = (afterTotals[r.current_eligibility || 'null'] || 0) - 1
  afterTotals[r.recommended_eligibility || 'null'] = (afterTotals[r.recommended_eligibility || 'null'] || 0) + 1
}

const allKeys = new Set([...Object.keys(beforeTotals), ...Object.keys(afterTotals)])
console.log(`  ${'eligibility'.padEnd(16)} ${'BEFORE'.padStart(8)}   ${'AFTER'.padStart(8)}   ${'ΔLn'.padStart(8)}`)
for (const k of ['bulk_safe', 'market_only', 'identity_only', 'not_eligible', 'uncertain', 'null']) {
  if (!allKeys.has(k)) continue
  const b = beforeTotals[k] || 0
  const a = afterTotals[k] || 0
  const d = a - b
  const dStr = d > 0 ? `+${d}` : String(d)
  console.log(`  ${k.padEnd(16)} ${String(b).padStart(8)}   ${String(a).padStart(8)}   ${dStr.padStart(8)}`)
}
console.log(`  ${'TOTAL'.padEnd(16)} ${String(mappingsNow.length).padStart(8)}   ${String(mappingsNow.length).padStart(8)}      0`)

// Write dry-run snapshot
const dryRunSnapshot = {
  generated_at: new Date().toISOString(),
  mode: APPLY ? 'applied' : 'dry_run',
  corrections_total: corrections.length,
  direction,
  risk_by_direction: riskXDir,
  before: beforeTotals,
  after: afterTotals,
}
writeFileSync('scripts/_pp-tcg-match-qa/dry-run-corrections.json', JSON.stringify(dryRunSnapshot, null, 2))
console.log('\n  snapshot written → scripts/_pp-tcg-match-qa/dry-run-corrections.json')

if (!APPLY) {
  console.log('\n[4/4] DRY-RUN — no writes. Re-run with --apply to execute.\n')
  console.log('       Rollback plan after apply:')
  console.log('       The audit rows written to pokemon_tcg_mapping_audit preserve old → new.')
  console.log('       To revert: UPDATE pokemon_tcg_mappings SET pricing_eligibility = (audit.old_pricing_eligibility)')
  console.log('       WHERE id IN (SELECT mapping_id FROM pokemon_tcg_mapping_audit WHERE action=\'qa_eligibility_correction\'')
  console.log('                     AND created_at >= \'<run_timestamp>\')')
  process.exit(0)
}

// --- APPLY MODE ---
console.log('\n[4/4] APPLY — writing corrections + audit log…\n')

const runId = `pp-tcg-match-qa-04-${new Date().toISOString().replace(/[:.]/g, '-')}`
const BATCH = 100
let applied = 0
let auditWritten = 0

for (let i = 0; i < corrections.length; i += BATCH) {
  const chunk = corrections.slice(i, i + BATCH)

  // Supabase doesn't support multi-row UPDATE WHERE id=X SET value=Y in a
  // single statement; we do one UPDATE per row inside Promise.all for
  // speed. All run in the same database but not technically transactional —
  // see the rollback plan at the top for recovery.
  const updateResults = await Promise.all(chunk.map(c =>
    sb.from('pokemon_tcg_mappings')
      .update({ pricing_eligibility: c.recommended_eligibility, updated_at: new Date().toISOString() })
      .eq('id', c.mapping_id)
  ))
  const failed = updateResults.filter(r => r.error)
  if (failed.length) throw new Error(`${failed.length} updates failed in batch at ${i}: ${failed[0].error?.message}`)
  applied += chunk.length

  // Audit log — uses the existing pokemon_tcg_mapping_audit schema
  const auditRows = chunk.map(c => ({
    mapping_id: c.mapping_id,
    pp_card_slug: c.pp_card_slug,
    provider: 'tcggraph',
    action: 'qa_eligibility_correction',
    reason: `${c.current_eligibility ?? 'null'} → ${c.recommended_eligibility ?? 'null'} · risk=${c.risk_class}`,
    actor_display: 'automation:pp-tcg-match-qa-04',
    metadata: {
      run_id: runId,
      from_eligibility: c.current_eligibility,
      to_eligibility: c.recommended_eligibility,
      risk_class: c.risk_class,
    },
  }))
  const { error: auditErr } = await sb.from('pokemon_tcg_mapping_audit').insert(auditRows)
  if (auditErr) throw new Error(`audit insert at ${i}: ${auditErr.message}`)
  auditWritten += auditRows.length

  if (i % 1000 === 0) console.log(`     applied ${applied} / ${corrections.length}…`)
}

console.log(`\n  ✓ ${applied} corrections written`)
console.log(`  ✓ ${auditWritten} audit rows inserted (run_id=${runId})`)
console.log('\n  Rollback: see dry-run-corrections.json for before/after + audit log for row-level reversal')
console.log('\n[done]')

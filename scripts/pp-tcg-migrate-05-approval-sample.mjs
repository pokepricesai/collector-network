// PP-TCG-MIGRATE-05 §6: stratified mapping-approval sample.
//
// Picks 50 real bulk_safe candidates across cohorts (language, era,
// printing type, high-traffic). Writes them to
// pokemon_tcg_mapping_approval_samples with passed=null (pending
// operator review). The admin UI surfaces them so the operator
// can mark each pass/fail before kicking off a bulk approve.
//
// This script generates the sample set; it does NOT approve any
// mapping or write to live pricing surfaces.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-migrate-05', { recursive: true })

const PICKS = [
  { cohort: 'en-modern', n: 10, filter: q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').ilike('pp_set_name', '%Scarlet%') },
  { cohort: 'en-vintage', n: 6, filter: q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').in('pp_set_name', ['Base Set','Jungle','Fossil','Base Set 2','Team Rocket','Neo Genesis','Neo Discovery','Neo Destiny']) },
  { cohort: 'en-ex-era',  n: 6, filter: q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').in('pp_set_name', ['EX Ruby & Sapphire','EX Hidden Legends','EX Delta Species','EX Dragon Frontiers','EX Power Keepers']) },
  { cohort: 'en-swsh', n: 6, filter: q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').in('pp_set_name', ['Sword & Shield','Vivid Voltage','Chilling Reign','Evolving Skies','Fusion Strike']) },
  { cohort: 'jp-modern',  n: 6, filter: q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'jp').ilike('pp_set_name', '%Scarlet%') },
  { cohort: 'jp-vintage', n: 4, filter: q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'jp').ilike('pp_set_name', '%Base%') },
  { cohort: 'top-traffic', n: 6, filter: q => q.eq('pricing_eligibility', 'bulk_safe').not('commercial_rank', 'is', null).order('commercial_rank', { ascending: true }) },
  { cohort: 'promo-verified', n: 6, filter: q => q.eq('pricing_eligibility', 'bulk_safe').ilike('pp_set_name', '%Promo%').eq('confidence', 'verified') },
]

const sampleRows = []
for (const p of PICKS) {
  let q = sb.from('pokemon_tcg_mappings')
    .select('pp_card_slug, pp_card_name, pp_set_name, pp_language, tcg_card_id, tcg_printing_key, tcg_set_code, tcg_name, confidence, pricing_eligibility, commercial_rank')
    .eq('provider', 'tcggraph')
  q = p.filter(q).limit(p.n)
  const { data } = await q
  const rows = data || []
  console.log(`[cohort] ${p.cohort}: wanted=${p.n}, got=${rows.length}`)
  for (const r of rows) {
    sampleRows.push({
      cohort: p.cohort,
      pp_card_slug: r.pp_card_slug,
      checker: 'auto',
      passed: null,
      reason: null,
      notes: JSON.stringify({ pp_name: r.pp_card_name, pp_set: r.pp_set_name, tcg: r.tcg_card_id, printing: r.tcg_printing_key, rank: r.commercial_rank }),
    })
  }
}

// Clear previous auto samples and insert fresh ones (idempotent)
await sb.from('pokemon_tcg_mapping_approval_samples').delete().eq('checker', 'auto')
const { error } = await sb.from('pokemon_tcg_mapping_approval_samples').insert(sampleRows)
if (error) throw new Error(`insert: ${error.message}`)
console.log(`[write] ${sampleRows.length} samples inserted`)

// Human-readable report
let md = '# PP-TCG-MIGRATE-05 §6 — Mapping Approval Sample\n\n'
md += `_Generated: ${new Date().toISOString()}_\n\n`
md += `**Total samples**: ${sampleRows.length}\n\n`
md += `**Review state**: `+ sampleRows.length + ` pending (passed=null)\n\n`
md += '## By cohort\n\n'
const grouped = sampleRows.reduce((o, r) => { (o[r.cohort] ||= []).push(r); return o }, {})
for (const [cohort, rows] of Object.entries(grouped)) {
  md += `### ${cohort} (${rows.length})\n\n`
  for (const r of rows.slice(0, 20)) {
    const notes = JSON.parse(r.notes)
    md += `- \`${r.pp_card_slug}\` · ${notes.pp_name} · _${notes.pp_set}_ → \`${notes.tcg}\` / \`${notes.printing}\`` + (notes.rank ? ` · GSC #${notes.rank}` : '') + '\n'
  }
  md += '\n'
}
md += '## Operator workflow\n\n'
md += '1. Open `/admin/pokemon-matching/approval-sample` (deployed in this ticket).\n'
md += '2. For each row, verify the match is correct (TCGGraph card = PP card, same identity, same printing).\n'
md += '3. Mark pass/fail. Mapping stays as-is in `pokemon_tcg_mappings` either way.\n'
md += '4. When pass-rate on the sample is >95%, operator can safely trigger the bulk-approve of all 23,474 bulk_safe candidates via the existing resumable batch.\n'
md += '5. **Mapping approval is NOT public pricing activation** — that is a separate operator flip of `PP_USE_TCGGRAPH_PRICES=1`.\n'
writeFileSync('scripts/_pp-tcg-migrate-05/approval-sample.md', md)
console.log('\n[done] report at scripts/_pp-tcg-migrate-05/approval-sample.md')

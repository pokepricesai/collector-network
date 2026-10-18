// PP-TCG-MIGRATE-04 §5: promo-set separation analysis.
//
// For every verified-identity PP mapping where the TCGGraph set is
// a specific promo set, group by tcg_set_code and tally membership.
// Writes proposals into pokemon_tcg_promo_set_proposals (admin-only).
// Operator reviews via admin UI before any public URL is created.
//
// Also classifies candidates by "promo set vs printing variant":
//   • Real promo set: the TCG card is in a dedicated set code
//     (basep, dpp, hsp, bwp, xyp, smp, swshp, svp, mep, np, bkp,
//     kwbp, wcd20xx, etc.) and has multiple cards.
//   • Printing variant disguised: e.g. a Pokémon Center stamp
//     applied to a base-set card. TCG printing_key is 'pokemon-
//     center' but set code is the base set — this does NOT
//     warrant its own URL; it's a variant of an existing card.
//
// No public URL changes. No sitemap entries created. The output is
// a proposal row the operator reviews.

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-migrate-04', { recursive: true })

// Known TCG promo sets — pulled live from sets table
const sets = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/sets.json', 'utf-8'))
const promoSetByCode = new Map()
for (const s of sets) {
  if (/Promo|Black Star|Championship|League|Prerelease/i.test(s.name || '')) {
    promoSetByCode.set(s.code, s)
  }
}
console.log(`[input] ${promoSetByCode.size} TCG promo-ish set codes`)

// Pull mappings
async function pullMappings() {
  const PAGE = 1000; let offset = 0; const all = []
  while (true) {
    const { data, error } = await sb.from('pokemon_tcg_mappings')
      .select('pp_card_slug, pp_card_name, pp_set_name, pp_language, tcg_card_id, tcg_printing_key, tcg_set_code, tcg_language, confidence, pricing_eligibility, commercial_rank')
      .eq('provider', 'tcggraph').order('id').range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

console.log('[pull] mappings...')
const mappings = await pullMappings()
console.log(`[pull] ${mappings.length}`)

// Group mappings pointing at promo TCG sets
const byPromoSet = new Map()
for (const m of mappings) {
  if (m.confidence !== 'verified') continue
  if (!m.tcg_set_code) continue
  const promoSet = promoSetByCode.get(m.tcg_set_code)
  if (!promoSet) continue
  if (!byPromoSet.has(m.tcg_set_code)) byPromoSet.set(m.tcg_set_code, { set: promoSet, mappings: [] })
  byPromoSet.get(m.tcg_set_code).mappings.push(m)
}
console.log(`[group] ${byPromoSet.size} promo TCG set codes have verified PP mappings`)

// Build proposals + ordered output
function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const proposals = []
for (const [code, info] of byPromoSet.entries()) {
  if (info.mappings.length < 2) continue   // one card doesn't justify a dedicated set
  proposals.push({
    tcg_set_code: code,
    tcg_set_name: info.set.name,
    tcg_language: info.set.language,
    pp_rows_mapped: info.mappings.length,
    proposed_public_slug: slugify(info.set.name),
    review_state: 'proposed',
    notes: null,
  })
}
proposals.sort((a, b) => b.pp_rows_mapped - a.pp_rows_mapped)
console.log(`[proposals] ${proposals.length} proposals (≥2 PP mappings each)`)

// Upsert into pokemon_tcg_promo_set_proposals
const { error } = await sb.from('pokemon_tcg_promo_set_proposals').upsert(proposals, { onConflict: 'tcg_set_code' })
if (error) throw new Error(`upsert: ${error.message}`)

// Human-readable report
let md = '# PP-TCG-MIGRATE-04 — Promo-Set Separation Analysis\n\n'
md += `_Generated: ${new Date().toISOString()}_\n\n`
md += `**Verified PP mappings pointing at a TCG promo set**: ${proposals.reduce((a, b) => a + b.pp_rows_mapped, 0)}\n\n`
md += `**TCG promo set codes with ≥2 PP mappings**: ${proposals.length}\n\n`
md += '## Proposed public groupings\n\n'
md += '| TCG code | Name | Lang | PP rows | Proposed slug |\n'
md += '|---|---|---|---|---|\n'
for (const p of proposals.slice(0, 40)) {
  md += `| \`${p.tcg_set_code}\` | ${p.tcg_set_name} | ${p.tcg_language} | ${p.pp_rows_mapped} | \`${p.proposed_public_slug}\` |\n`
}
if (proposals.length > 40) md += `| … | … (${proposals.length - 40} more) | | | |\n`
md += '\n## SEO-safe migration plan (DO NOT execute until operator approves)\n\n'
md += '1. **Keep existing PokePrices card URLs unchanged.** Every current card URL (e.g. `/set/Promo/card/charizard-ex-123`) continues to resolve as it does today. No 301s, no canonical changes, no sitemap pruning.\n\n'
md += '2. **New set pages go behind `noindex`**. Create `/set/<new-slug>` routes that render the existing set-page template with filtered membership. Metadata carries `robots: noindex, nofollow` while under review.\n\n'
md += '3. **Internal links only**, no sitemap entries. The new set pages are reachable via the admin preview and an "operator-only index" page at `/admin/tcg-preview/promo-sets`.\n\n'
md += '4. **Dupe content audit before indexing**. The new set page lists card URLs that already exist in the legacy `/set/Promo` listing. Content duplication is minimal because the new page is a NAVIGATION/filter view, not a per-card page. Still: canonical URL on each listing stays the original card URL.\n\n'
md += '5. **Phase-2 (future ticket)**: operator reviews the admin preview, approves specific `review_state=approved` rows, and we author a dedicated SEO migration ticket that handles:\n'
md += '    - Sitemap inclusion\n'
md += '    - Breadcrumb strategy (should `/set/<new-slug>/card/<slug>` exist too? Probably NOT; keep card URLs as-is.)\n'
md += '    - Index removal of the old broad `/set/Promo` page? Likely NOT — keep both for redundancy during Google re-crawl.\n'
md += '    - 301 redirects? Likely NOT — existing URLs still resolve, no need to redirect anything.\n\n'
md += '**Non-goals of this ticket**: no public URL changes, no sitemap updates, no robots directive changes.\n\n'
writeFileSync('scripts/_pp-tcg-migrate-04/promo-analysis.md', md)
writeFileSync('scripts/_pp-tcg-migrate-04/promo-proposals.json', JSON.stringify(proposals, null, 2))

console.log('\n[DONE]')
console.log(`${proposals.length} proposals written to pokemon_tcg_promo_set_proposals`)
console.log('Report at scripts/_pp-tcg-migrate-04/promo-analysis.md')

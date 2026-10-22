// PP-TCG-MATCH-01A: audit the 43,766 "verified pending" bucket.
// Separate card-identity verified from price-applicability verified.
// Pure SQL; no API calls.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-01a', { recursive: true })

// Pull all verified pending mappings
async function pullVerified() {
  const PAGE = 1000
  let offset = 0
  const all = []
  while (offset < 100000) {
    const { data, error } = await sb.from('pokemon_tcg_mappings')
      .select('id, pp_card_slug, pp_card_name, pp_set_name, pp_language, tcg_card_id, tcg_printing_key, tcg_language, tcg_name, confidence, review_status, match_method')
      .eq('review_status', 'pending_review')
      .eq('confidence', 'verified')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

const rows = await pullVerified()
console.log(`[input] ${rows.length} verified pending rows loaded`)

function extractVariantTag(s) {
  const m = (s || '').match(/\[([^\]]+)\]/)
  return m ? m[1].trim() : null
}

// Classification per row
function classify(r) {
  const tag = extractVariantTag(r.pp_card_name)
  const printing = r.tcg_printing_key || 'normal'
  const isNormalPrinting = printing === 'normal'
  const isVariantPrinting = !isNormalPrinting
  const langsMatch = (r.pp_language === 'jp' && r.tcg_language === 'ja')
                  || (r.pp_language === 'en' && r.tcg_language === 'en')

  // Reasons this is NOT bulk-safe for pricing
  const reasons = []

  if (tag) {
    // PP has a variant tag — the printing distinction matters for pricing
    // even if the card identity is correct.
    if (isNormalPrinting) {
      // PP says [1st Edition] but matcher gave normal printing — mismatch
      reasons.push(`variant_tag_but_normal_printing:${tag}`)
    }
    // Even when the printing_key matches the variant tag, graded prices
    // are per-card-id (aggregated across printings) — so bulk-approving
    // the variant row's PRICE from the aggregate is unsafe. Market quotes
    // (TCGplayer/Cardmarket per-finish) are the only safe source.
    reasons.push(`variant_requires_market_split:${tag}`)
  }

  if (!langsMatch) {
    reasons.push(`language_mismatch:pp=${r.pp_language} tcg=${r.tcg_language}`)
  }

  // Known structurally missing TCG printing keys for PP tags
  const KNOWN_UNSUPPORTED = ['Mirror Holo', 'Jumbo', 'Prize Pack', 'Rainbow Foil', 'Stamped', 'Prism', 'Gold Star']
  if (tag && KNOWN_UNSUPPORTED.includes(tag)) {
    reasons.push(`tcg_has_no_printing_key_for:${tag}`)
  }

  // Promo/World-Championship reprints: tcg card id contains these markers
  const isPromoLike = /_promo|wcd\d|_jumbo|_prize|_sparkle|_tekno/i.test(r.tcg_card_id || '')
  if (isPromoLike) reasons.push('tcg_card_is_promo_reprint')

  return {
    pp_slug: r.pp_card_slug,
    pp_name: r.pp_card_name,
    pp_set: r.pp_set_name,
    pp_lang: r.pp_language,
    tcg_id: r.tcg_card_id,
    tcg_printing: printing,
    tcg_lang: r.tcg_language,
    tag,
    reasons,
    identity_verified: true,       // true for everyone in this bucket (set+collector#+name)
    price_safe_bulk_normal: tag == null && isNormalPrinting && langsMatch && !isPromoLike,
    price_safe_bulk_variant_market_only: tag != null && isVariantPrinting && !KNOWN_UNSUPPORTED.includes(tag) && langsMatch,
    identity_only_price_unsafe: reasons.length > 0,
  }
}

const classified = rows.map(classify)

const breakdown = {
  total_verified: classified.length,
  safe_bulk_normal_pricing: classified.filter(c => c.price_safe_bulk_normal).length,
  variant_market_only_safe: classified.filter(c => c.price_safe_bulk_variant_market_only).length,
  identity_only_price_unsafe: classified.filter(c => c.identity_only_price_unsafe).length,
  by_reason: {},
  by_language: {},
  by_variant_tag: {},
  by_pp_language: {},
}

for (const c of classified) {
  for (const r of c.reasons) breakdown.by_reason[r] = (breakdown.by_reason[r] || 0) + 1
  const lk = `pp=${c.pp_lang}|tcg=${c.tcg_lang}`
  breakdown.by_language[lk] = (breakdown.by_language[lk] || 0) + 1
  const tk = c.tag || 'NO_TAG'
  breakdown.by_variant_tag[tk] = (breakdown.by_variant_tag[tk] || 0) + 1
  breakdown.by_pp_language[c.pp_lang] = (breakdown.by_pp_language[c.pp_lang] || 0) + 1
}

// Also look for duplicates within verified: two PP cards pointing to same tcg_card_id + printing_key
const tcgIdSeen = new Map()
for (const c of classified) {
  if (!c.price_safe_bulk_normal) continue
  const k = `${c.tcg_id}|${c.tcg_printing}`
  if (!tcgIdSeen.has(k)) tcgIdSeen.set(k, [])
  tcgIdSeen.get(k).push(c.pp_slug)
}
let dupClashes = 0
const sampleClash = []
for (const [k, slugs] of tcgIdSeen.entries()) {
  if (slugs.length > 1) {
    dupClashes += slugs.length
    if (sampleClash.length < 5) sampleClash.push({ tcg: k, pp_slugs: slugs })
  }
}
breakdown.safe_bulk_normal_pp_slugs_sharing_tcg_id = dupClashes
breakdown.sample_shared_tcg_target = sampleClash

writeFileSync('scripts/_pp-tcg-match-01a/audit.json', JSON.stringify(breakdown, null, 2))

console.log('\n=== AUDIT RESULTS ===')
console.log(`Total "verified pending": ${breakdown.total_verified}`)
console.log(`\nBreakdown by safety:`)
console.log(`  safe bulk normal pricing (approved identity + aggregate graded safe to use): ${breakdown.safe_bulk_normal_pricing}`)
console.log(`  variant market-only safe (price only from per-finish market quotes): ${breakdown.variant_market_only_safe}`)
console.log(`  identity-only, price unsafe for aggregates: ${breakdown.identity_only_price_unsafe}`)

console.log(`\nSample exclusion reasons (top 15):`)
for (const [k, v] of Object.entries(breakdown.by_reason).sort((a,b)=>b[1]-a[1]).slice(0, 15)) {
  console.log(`  ${k.padEnd(50)} ${v}`)
}

console.log(`\nBy variant tag (top 15):`)
for (const [k, v] of Object.entries(breakdown.by_variant_tag).sort((a,b)=>b[1]-a[1]).slice(0, 15)) {
  console.log(`  ${k.padEnd(30)} ${v}`)
}

console.log(`\nBy language pairing:`)
for (const [k, v] of Object.entries(breakdown.by_language)) console.log(`  ${k.padEnd(20)} ${v}`)

if (dupClashes > 0) {
  console.log(`\n⚠️ ${dupClashes} safe-bulk-normal rows share TCG card+printing with other PP rows.`)
  console.log(`Sample clashes:`)
  for (const c of sampleClash) console.log(`  ${c.tcg} ← PP slugs: ${c.pp_slugs.join(', ')}`)
}

console.log('\n[done] see scripts/_pp-tcg-match-01a/audit.json')

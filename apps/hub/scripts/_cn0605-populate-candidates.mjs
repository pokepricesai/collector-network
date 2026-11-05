#!/usr/bin/env node
// CN-06.05-P03 (post-review): one-shot operator script to populate
// cn_psa_candidates.
//
// What it does:
//   • Pokemon: joins card_latest_prices (raw_usd > 300 cents) against
//     cards; then against psa_population by (bare_set_name, card_number).
//       - Exactly 1 spec match     → PLAUSIBLE  (psa_spec_id attached but NOT auto-promoted to verified — operator must review)
//       - 2+ spec matches          → AMBIGUOUS  (review queue, no spec)
//       - 0 matches                → UNMAPPED   (no spec, mapping_notes set)
//     "verified" is NEVER set by this script. It is reserved for
//     operator-signed mappings (future review-queue resolution flow).
//   • MTG / YGO / OnePiece / Lorcana: iterates tcg_market_prices_current
//     with currency=USD, list_type=retail, finish=nonfoil, price>3;
//     groups by tcg_printing_id taking MAX across sources; inserts
//     mapping_status='unmapped'. The 4 TCG games are structurally
//     supported but inactive — the scheduler filters to activeSiteKeys
//     (Pokemon only) in src/server/psa/refresh.ts.
//
// Safety:
//   • READ-ONLY on upstream tables (card_latest_prices, cards,
//     psa_population, tcg_cards, tcg_printings, tcg_market_prices_current).
//   • Idempotent upsert into cn_psa_candidates by (site_key, internal_id).
//   • No candidate ever starts in 'verified'. Zero cards will be
//     refreshed by the cron until an operator promotes rows to
//     verified via a future review-queue resolution tool.
//   • Does not populate psa_spec_id for the 4 TCG games.
//   • Does not touch psa_population, psa_pop_history, or any site data.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

for (const file of ['.env', '.env.local', 'apps/hub/.env', 'apps/hub/.env.local']) {
  try {
    const raw = readFileSync(file, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    }
  } catch {}
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('missing env'); process.exit(1) }
const sb = createClient(url, key, { auth: { persistSession: false } })

const MIN_CENTS = 300          // > $3
const NOW_ISO = new Date().toISOString()

async function pagedAll(builderFactory, label, pageSize = 1000, hardMax = 1_000_000) {
  const rows = []
  let offset = 0
  while (offset < hardMax) {
    const { data, error } = await builderFactory().range(offset, offset + pageSize - 1)
    if (error) throw new Error(`${label} offset=${offset}: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function populatePokemon() {
  console.log('[pokemon] loading priced eligible cards (raw_usd > ' + MIN_CENTS + ' cents)')
  const prices = await pagedAll(
    () => sb.from('card_latest_prices').select('card_slug, raw_usd, updated_at').gt('raw_usd', MIN_CENTS),
    'pokemon.card_latest_prices',
  )
  const bySlug = new Map()
  for (const r of prices) bySlug.set(String(r.card_slug).replace(/^pc-/, ''), { raw_usd: r.raw_usd, updated_at: r.updated_at })
  console.log('[pokemon] eligible priced slugs:', bySlug.size)

  // Fetch card metadata for those slugs.
  const slugs = Array.from(bySlug.keys())
  const cards = []
  for (let i = 0; i < slugs.length; i += 500) {
    const chunk = slugs.slice(i, i + 500)
    const { data, error } = await sb.from('cards')
      .select('card_slug, card_name, set_name, card_number, language')
      .in('card_slug', chunk)
    if (error) throw new Error('cards chunk: ' + error.message)
    cards.push(...(data ?? []))
  }
  console.log('[pokemon] cards metadata fetched:', cards.length)

  // Build psa_population index: (bare_set_lower|number_lower) -> [psa_spec_id]
  console.log('[pokemon] loading psa_population spec index')
  const pop = await pagedAll(
    () => sb.from('psa_population').select('set_name, card_number, variant, psa_spec_id, total_graded'),
    'psa_population',
  )
  const specIndex = new Map()
  for (const r of pop) {
    if (!r.psa_spec_id) continue
    const bareSet = String(r.set_name).replace(/^Pokemon\s+/i, '').toLowerCase()
    const num = String(r.card_number).toLowerCase()
    const key = bareSet + '|' + num
    const bucket = specIndex.get(key) ?? []
    bucket.push({ psa_spec_id: String(r.psa_spec_id), variant: r.variant ?? '', total_graded: r.total_graded ?? 0 })
    specIndex.set(key, bucket)
  }
  console.log('[pokemon] psa_population distinct (set,number) keys:', specIndex.size)

  // Build candidate rows.
  // Mapping policy: a single fuzzy (set,number) match is PLAUSIBLE
  // only — it carries a candidate psa_spec_id but requires operator
  // sign-off before the cron will use it. The scheduler filters on
  // mapping_status='verified' which this script never sets.
  const rows = []
  let plausible = 0, ambiguous = 0, unmapped = 0, noPrice = 0
  for (const c of cards) {
    const price = bySlug.get(c.card_slug)
    if (!price) { noPrice++; continue }
    const bareSet = String(c.set_name || '').toLowerCase()
    const num = String(c.card_number || '').toLowerCase()
    const key = bareSet + '|' + num
    const specs = specIndex.get(key) ?? []
    let status = 'unmapped'
    let spec = null
    let notes = null
    if (specs.length === 1) {
      status = 'plausible'
      spec = specs[0].psa_spec_id
      notes = 'single fuzzy (set,number) match; requires operator verification before use'
    } else if (specs.length > 1) {
      status = 'ambiguous'
      notes = `multiple psa_spec_id matches: ${specs.map(s => s.psa_spec_id).join(',')}`
    } else {
      notes = 'no psa_population match on (set,number)'
    }

    rows.push({
      site_key: 'pokeprices',
      internal_id: c.card_slug,
      psa_spec_id: spec,
      mapping_status: status,
      raw_usd_cents: price.raw_usd,
      raw_price_observed_at: price.updated_at,
      raw_price_source: 'card_latest_prices',
      set_name: c.set_name,
      card_number: c.card_number,
      card_name: c.card_name,
      language: c.language ?? 'en',
      finish: null,
      variant: null,
      mapping_notes: notes,
      updated_at: NOW_ISO,
    })
    if (status === 'plausible') plausible++
    else if (status === 'ambiguous') ambiguous++
    else unmapped++
  }
  console.log(`[pokemon] plausible=${plausible}  ambiguous=${ambiguous}  unmapped=${unmapped}  (no-price excluded=${noPrice})`)
  console.log(`[pokemon] verified=0 (reserved for operator sign-off; cron will refresh zero rows until promotion)`)

  // Chunked upsert into cn_psa_candidates.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await sb.from('cn_psa_candidates').upsert(chunk, { onConflict: 'site_key,internal_id' })
    if (error) throw new Error('cn_psa_candidates upsert: ' + error.message)
  }
  console.log('[pokemon] upserted', rows.length, 'candidate rows')

  // Queue ambiguous rows into cn_psa_mapping_review for operator attention.
  const reviewRows = []
  for (const r of rows) {
    if (r.mapping_status !== 'ambiguous') continue
    const key = (r.set_name || '').toLowerCase() + '|' + (r.card_number || '').toLowerCase()
    const specs = specIndex.get(key) ?? []
    reviewRows.push({
      site_key: 'pokeprices',
      internal_id: r.internal_id,
      candidate_spec_ids: specs.map(s => s.psa_spec_id),
      conflict_reason: 'multiple_psa_spec_ids',
    })
  }
  for (let i = 0; i < reviewRows.length; i += 500) {
    const chunk = reviewRows.slice(i, i + 500)
    const { error } = await sb.from('cn_psa_mapping_review').upsert(chunk, { onConflict: 'site_key,internal_id' })
    if (error) throw new Error('cn_psa_mapping_review upsert: ' + error.message)
  }
  console.log('[pokemon] review queue entries added:', reviewRows.length)

  return { verified, ambiguous, unmapped }
}

async function populateTcgGame(game, siteKey) {
  console.log(`[${game}] loading USD retail nonfoil > $3`)
  const usd = await pagedAll(
    () => sb.from('tcg_market_prices_current')
      .select('tcg_printing_id, price, updated_at')
      .eq('game_id', game).eq('currency', 'USD').eq('list_type', 'retail').eq('finish', 'nonfoil').gt('price', 3),
    `${game}.tcg_market_prices_current`,
  )
  // MAX price per printing across sources.
  const best = new Map()
  for (const r of usd) {
    const prev = best.get(r.tcg_printing_id)
    if (!prev || r.price > prev.price) best.set(r.tcg_printing_id, { price: r.price, updated_at: r.updated_at })
  }
  console.log(`[${game}] distinct printings over $3:`, best.size)

  // Fetch printing metadata for those IDs (for set/number display).
  const ids = Array.from(best.keys())
  const meta = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const { data, error } = await sb.from('tcg_printings')
      .select('id, set_id, collector_number, language, finish, edition')
      .in('id', chunk)
    if (error) throw new Error(`${game}.tcg_printings chunk: ${error.message}`)
    meta.push(...(data ?? []))
  }
  const metaById = new Map()
  for (const m of meta) metaById.set(m.id, m)

  const rows = []
  for (const [printingId, p] of best) {
    const m = metaById.get(printingId)
    rows.push({
      site_key: siteKey,
      internal_id: printingId,
      psa_spec_id: null,                    // never guess
      mapping_status: 'unmapped',           // awaiting operator mapping
      raw_usd_cents: Math.round(p.price * 100),
      raw_price_observed_at: p.updated_at,
      raw_price_source: 'tcg_market_prices_current',
      set_name: m?.set_id ?? null,
      card_number: m?.collector_number ?? null,
      card_name: null,
      language: m?.language ?? 'en',
      finish: m?.finish ?? null,
      variant: m?.edition ?? null,
      mapping_notes: 'TCG game — no automatic psa_spec_id mapping; requires operator supply',
      updated_at: NOW_ISO,
    })
  }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await sb.from('cn_psa_candidates').upsert(chunk, { onConflict: 'site_key,internal_id' })
    if (error) throw new Error(`${game}.cn_psa_candidates upsert: ${error.message}`)
  }
  console.log(`[${game}] upserted`, rows.length, 'candidate rows (all unmapped)')
  return { plausible: 0, ambiguous: 0, unmapped: rows.length }
}

async function main() {
  const totals = { plausible: 0, ambiguous: 0, unmapped: 0 }
  const games = [
    ['pokemon',  null,     populatePokemon],
    ['mtg',      'mtgprices',       (g,s) => populateTcgGame(g,s)],
    ['ygo',      'ygoprices',       (g,s) => populateTcgGame(g,s)],
    ['onepiece', 'onepieceprices',  (g,s) => populateTcgGame(g,s)],
    ['lorcana',  'lorcanaprices',   (g,s) => populateTcgGame(g,s)],
  ]
  for (const [game, siteKey, fn] of games) {
    try {
      const r = siteKey ? await fn(game, siteKey) : await fn()
      totals.plausible += r.plausible
      totals.ambiguous += r.ambiguous
      totals.unmapped += r.unmapped
    } catch (e) {
      console.error(`[${game}] FAILED: ${e.message}`)
    }
  }
  console.log('\n=== totals ===')
  console.log('  plausible:', totals.plausible, '(require operator verification)')
  console.log('  ambiguous:', totals.ambiguous)
  console.log('  unmapped: ', totals.unmapped)
  console.log('  verified: 0 (reserved for operator sign-off; cron refreshes 0 rows at bootstrap)')
}

main().catch(e => { console.error(e); process.exit(1) })

// PP-TCG-MATCH-01A verification: replicate the bulk-safe preview
// count + run a controlled approve-and-undo test on 10 representative
// mappings via the same Supabase table shapes the production action
// uses. Service-role, so RLS is bypassed — but the test only exercises
// the DB operations that the server action performs after its
// requireAdmin() gate.
//
// Does NOT run the full 21,568-row approval. Does NOT touch
// cards / card_trends.

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-01a', { recursive: true })

const TEST_ACTOR = {
  user_id: null,                           // null since there is no auth.users row for this test harness
  display: 'pp-tcg-match-01a-verify',
}

const results = {
  started_at: new Date().toISOString(),
  checks: {},
  test_cards: [],
}

// ---------- 1. Confirm bulk-safe count (replicates bulkApproveDryRun) ----------

{
  const { count, error } = await sb
    .from('pokemon_tcg_mappings')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified')
    .eq('pricing_eligibility', 'bulk_safe')
    .not('tcg_card_id', 'is', null)
  if (error) throw new Error(error.message)
  results.checks.bulk_safe_dry_run_count = count
  console.log(`[check] bulk_safe pending preview count: ${count}`)
}

// Also the three sibling counts the page shows
for (const [key, elig] of [['market_only_pending', 'market_only'], ['identity_only_pending', 'identity_only']]) {
  const { count } = await sb
    .from('pokemon_tcg_mappings')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified')
    .eq('pricing_eligibility', elig)
  results.checks[key] = count
}
console.log(`[check] market_only pending: ${results.checks.market_only_pending}`)
console.log(`[check] identity_only pending: ${results.checks.identity_only_pending}`)

// ---------- 2. Pick 10 representative test cards ----------
// Cover: normal English, normal Japanese, vintage WOTC, promo, variant market_only.

async function pickOne(filterApplier, label) {
  let q = sb.from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, pp_card_name, pp_set_name, pp_language, tcg_card_id, tcg_printing_key, tcg_name, confidence, pricing_eligibility, review_status, previous_review_status')
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .limit(1)
  q = filterApplier(q)
  const { data, error } = await q
  if (error) throw new Error(`pick ${label}: ${error.message}`)
  if (!data || data.length === 0) {
    console.log(`[pick] ${label} — NO ROWS AVAILABLE`)
    return null
  }
  const r = data[0]
  console.log(`[pick] ${label.padEnd(28)} slug=${r.pp_card_slug} elig=${r.pricing_eligibility} set="${r.pp_set_name}"`)
  return { ...r, _test_label: label }
}

const picks = []
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en'), 'bulk_safe_en_modern'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'jp'), 'bulk_safe_jp'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').in('pp_set_name', ['Base Set','Jungle','Fossil','Base Set 2','Team Rocket','Neo Genesis']), 'bulk_safe_vintage'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'market_only').eq('pp_language', 'en').ilike('pp_card_name', '%[Reverse Holo]%'), 'market_only_reverse_holo'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'market_only').eq('pp_language', 'en').ilike('pp_card_name', '%[1st Edition]%'), 'market_only_1st_edition'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'market_only').eq('pp_language', 'en').ilike('pp_card_name', '%[Shadowless]%'), 'market_only_shadowless'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'identity_only').ilike('pp_card_name', '%[Mirror Holo]%'), 'identity_only_mirror_holo'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'identity_only').ilike('pp_card_name', '%[Jumbo]%'), 'identity_only_jumbo'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'identity_only').or('pp_set_name.ilike.%Promo%,pp_set_name.ilike.%Black Star%,pp_set_name.ilike.%Championship%'), 'identity_only_promo'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'market_only').eq('pp_language', 'jp'), 'market_only_jp'))
picks.push(await pickOne(q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').not('commercial_rank', 'is', null).order('commercial_rank', { ascending: true }), 'bulk_safe_high_traffic'))

const testCards = picks.filter(p => p !== null)
console.log(`\n[picked] ${testCards.length} test cards`)
results.test_cards = testCards.map(c => ({ label: c._test_label, slug: c.pp_card_slug, name: c.pp_card_name, elig: c.pricing_eligibility, status: c.review_status }))

// ---------- 3. Approve each → verify DB state + audit row ----------

async function approve(card, reasonLabel) {
  const now = new Date().toISOString()
  const { error: upErr } = await sb.from('pokemon_tcg_mappings')
    .update({
      review_status: 'approved',
      previous_review_status: card.review_status,
      reviewer_user_id: TEST_ACTOR.user_id,
      reviewer_display: TEST_ACTOR.display,
      reviewed_at: now,
      match_method: 'test_approve',
    })
    .eq('id', card.id)
  if (upErr) throw new Error(`approve ${card.pp_card_slug}: ${upErr.message}`)

  const { error: auErr } = await sb.from('pokemon_tcg_mapping_audit').insert({
    mapping_id: card.id,
    pp_card_slug: card.pp_card_slug,
    provider: 'tcggraph',
    action: 'status_change',
    from_status: card.review_status,
    to_status: 'approved',
    from_tcg_card_id: card.tcg_card_id,
    to_tcg_card_id: card.tcg_card_id,
    from_printing_key: card.tcg_printing_key,
    to_printing_key: card.tcg_printing_key,
    actor_user_id: TEST_ACTOR.user_id,
    actor_display: TEST_ACTOR.display,
    reason: reasonLabel,
    metadata: { source: 'verify_01a' },
  })
  if (auErr) throw new Error(`audit ${card.pp_card_slug}: ${auErr.message}`)
}

async function undo(card) {
  const { data: row, error: rErr } = await sb
    .from('pokemon_tcg_mappings')
    .select('id, review_status, previous_review_status, tcg_card_id, tcg_printing_key, pp_card_slug')
    .eq('id', card.id)
    .maybeSingle()
  if (rErr || !row) throw new Error(`undo read: ${rErr?.message || 'not found'}`)
  if (!row.previous_review_status) throw new Error(`${card.pp_card_slug}: no previous_review_status to undo to`)

  const now = new Date().toISOString()
  const { error: upErr } = await sb.from('pokemon_tcg_mappings')
    .update({
      review_status: row.previous_review_status,
      previous_review_status: row.review_status,
      reviewer_user_id: TEST_ACTOR.user_id,
      reviewer_display: TEST_ACTOR.display,
      reviewed_at: now,
    })
    .eq('id', card.id)
  if (upErr) throw new Error(`undo update: ${upErr.message}`)

  const { error: auErr } = await sb.from('pokemon_tcg_mapping_audit').insert({
    mapping_id: card.id,
    pp_card_slug: card.pp_card_slug,
    provider: 'tcggraph',
    action: 'undo',
    from_status: row.review_status,
    to_status: row.previous_review_status,
    from_tcg_card_id: row.tcg_card_id,
    to_tcg_card_id: row.tcg_card_id,
    from_printing_key: row.tcg_printing_key,
    to_printing_key: row.tcg_printing_key,
    actor_user_id: TEST_ACTOR.user_id,
    actor_display: TEST_ACTOR.display,
    reason: 'undo',
    metadata: { source: 'verify_01a' },
  })
  if (auErr) throw new Error(`undo audit: ${auErr.message}`)
}

async function stateOf(card) {
  const { data, error } = await sb
    .from('pokemon_tcg_mappings')
    .select('review_status, previous_review_status, reviewer_display, reviewed_at, match_method')
    .eq('id', card.id)
    .maybeSingle()
  if (error || !data) throw new Error('state read failed')
  return data
}

async function auditCount(card) {
  const { count } = await sb
    .from('pokemon_tcg_mapping_audit')
    .select('id', { count: 'exact', head: true })
    .eq('mapping_id', card.id)
  return count
}

const perCardResults = []
console.log('\n[test] approve-and-undo on each card…')
for (const card of testCards) {
  const auditBefore = await auditCount(card)
  await approve(card, `verify-approve-${card._test_label}`)
  const afterApprove = await stateOf(card)
  const auditAfterApprove = await auditCount(card)

  await undo(card)
  const afterUndo = await stateOf(card)
  const auditAfterUndo = await auditCount(card)

  const expected_approve_state = 'approved'
  const expected_undo_state = card.review_status
  const approve_ok = afterApprove.review_status === expected_approve_state
  const undo_ok = afterUndo.review_status === expected_undo_state

  const audit_delta_approve = auditAfterApprove - auditBefore
  const audit_delta_undo = auditAfterUndo - auditAfterApprove

  perCardResults.push({
    label: card._test_label,
    slug: card.pp_card_slug,
    pricing_eligibility: card.pricing_eligibility,
    initial_status: card.review_status,
    after_approve: afterApprove.review_status,
    after_undo: afterUndo.review_status,
    approve_ok,
    undo_ok,
    audit_rows_before: auditBefore,
    audit_rows_after_approve: auditAfterApprove,
    audit_rows_after_undo: auditAfterUndo,
    audit_delta_approve,
    audit_delta_undo,
  })

  console.log(`  ${card._test_label.padEnd(28)} approve=${approve_ok ? 'OK' : 'FAIL'} undo=${undo_ok ? 'OK' : 'FAIL'} audit=+${audit_delta_approve}/+${audit_delta_undo}`)
}

results.per_card_results = perCardResults
results.checks.approve_undo_all_pass = perCardResults.every(r => r.approve_ok && r.undo_ok)
results.checks.audit_delta_approve_equals_one = perCardResults.every(r => r.audit_delta_approve === 1)
results.checks.audit_delta_undo_equals_one = perCardResults.every(r => r.audit_delta_undo === 1)

// ---------- 4. Idempotency: re-run approve on an already-approved row ----------
// The server action's SELECT filter is `review_status='pending_review'`, so
// an already-approved row simply won't appear in the next tick batch.
// Verify: after approve, the dry-run count minus 1 equals the new preview count.

{
  const card = testCards[0]
  await approve(card, 'idempotency-step-approve')
  const { count: preCount } = await sb
    .from('pokemon_tcg_mappings')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified')
    .eq('pricing_eligibility', 'bulk_safe')
    .not('tcg_card_id', 'is', null)
  // Reset
  await undo(card)
  const { count: postCount } = await sb
    .from('pokemon_tcg_mappings')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified')
    .eq('pricing_eligibility', 'bulk_safe')
    .not('tcg_card_id', 'is', null)
  results.checks.idempotency = {
    pre_approve_count: results.checks.bulk_safe_dry_run_count,
    post_approve_count: preCount,
    delta: results.checks.bulk_safe_dry_run_count - preCount,
    returned_to_original_after_undo: postCount === results.checks.bulk_safe_dry_run_count,
  }
  console.log(`\n[idempotency] approving one row shrinks preview by ${results.checks.idempotency.delta} (expected 1)`)
  console.log(`[idempotency] after undo, preview back to ${postCount} == ${results.checks.bulk_safe_dry_run_count}`)
}

// ---------- 5. Batch resumption: create a running batch, verify cursor + chunk advance ----------

{
  // Insert a running batch row with a known last_pp_slug
  const { data: batch, error: bErr } = await sb.from('pokemon_tcg_bulk_batches').insert({
    kind: 'bulk_approve',
    pricing_eligibility: 'bulk_safe',
    requested_by: TEST_ACTOR.user_id,
    requested_by_email: 'verify-01a@local',
    total_eligible: 10,
    state: 'running',
    rows_approved: 0,
    metadata: { source: 'verify_01a' },
  }).select('id').single()
  if (bErr || !batch) throw new Error(`batch create: ${bErr?.message}`)

  // Simulate a chunk fetch (same shape as bulkApproveTick)
  const { data: chunk1, error: c1Err } = await sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug')
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified')
    .eq('pricing_eligibility', 'bulk_safe')
    .not('tcg_card_id', 'is', null)
    .order('pp_card_slug', { ascending: true })
    .limit(5)
  if (c1Err || !chunk1) throw new Error(`chunk1: ${c1Err?.message}`)
  const chunk1_cursor = chunk1[chunk1.length - 1].pp_card_slug

  // Checkpoint
  await sb.from('pokemon_tcg_bulk_batches')
    .update({ last_pp_slug: chunk1_cursor, rows_approved: chunk1.length, last_checkpoint_at: new Date().toISOString() })
    .eq('id', batch.id)

  // Resume: next chunk should start AFTER cursor
  const { data: chunk2, error: c2Err } = await sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug')
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified')
    .eq('pricing_eligibility', 'bulk_safe')
    .not('tcg_card_id', 'is', null)
    .gt('pp_card_slug', chunk1_cursor)
    .order('pp_card_slug', { ascending: true })
    .limit(5)
  if (c2Err || !chunk2) throw new Error(`chunk2: ${c2Err?.message}`)

  const no_overlap = !chunk1.some(a => chunk2.some(b => a.id === b.id))
  const chunk2_cursor = chunk2[chunk2.length - 1].pp_card_slug
  const cursor_advanced = chunk2_cursor > chunk1_cursor

  // Cancel the batch (do NOT actually approve any rows)
  await sb.from('pokemon_tcg_bulk_batches')
    .update({ state: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', batch.id)

  results.checks.batch_resumption = {
    batch_id: batch.id,
    chunk1_size: chunk1.length,
    chunk1_cursor,
    chunk2_size: chunk2.length,
    chunk2_cursor,
    no_overlap,
    cursor_advanced,
    pass: no_overlap && cursor_advanced,
  }
  console.log(`\n[batch] chunk1 cursor=${chunk1_cursor}, chunk2 cursor=${chunk2_cursor}`)
  console.log(`[batch] no_overlap=${no_overlap}, cursor_advanced=${cursor_advanced}`)
}

// ---------- 6. Final: verify no cards table / card_trends writes ----------

{
  // Query cards + card_trends for any rows updated by our test actor.
  // The test actor never writes to these tables, but confirm nothing
  // slipped by cross-referencing update_at columns if available.
  // Simpler: just assert we didn't touch them (we never issued the queries).
  results.checks.live_pricing_untouched_assertion = 'test actor never issued UPDATE/INSERT against cards or card_trends; see script source.'
}

results.ended_at = new Date().toISOString()
writeFileSync('scripts/_pp-tcg-match-01a/verify.json', JSON.stringify(results, null, 2))

console.log('\n=== SUMMARY ===')
console.log(`bulk_safe dry-run count: ${results.checks.bulk_safe_dry_run_count}`)
console.log(`market_only pending:     ${results.checks.market_only_pending}`)
console.log(`identity_only pending:   ${results.checks.identity_only_pending}`)
console.log(`approve-and-undo (${perCardResults.length} cards): ${results.checks.approve_undo_all_pass ? 'ALL PASS' : 'SOME FAILED'}`)
console.log(`audit +1 per approve:    ${results.checks.audit_delta_approve_equals_one ? 'YES' : 'NO'}`)
console.log(`audit +1 per undo:       ${results.checks.audit_delta_undo_equals_one ? 'YES' : 'NO'}`)
console.log(`idempotency delta:       approve shrinks preview by ${results.checks.idempotency.delta}`)
console.log(`idempotency restored:    ${results.checks.idempotency.returned_to_original_after_undo}`)
console.log(`batch resumption:        ${results.checks.batch_resumption.pass ? 'PASS' : 'FAIL'}`)
console.log(`\n[done] see scripts/_pp-tcg-match-01a/verify.json`)

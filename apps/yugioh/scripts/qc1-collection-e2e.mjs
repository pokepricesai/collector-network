#!/usr/bin/env node
// YGO QC1 §A — REAL Collection E2E against Production Supabase.
//
// Covers:
//   1. temp user A + user B (email-confirmed via service role)
//   2. Card with exactly ONE valid printing → add RAW → verify row
//   3. Same printing → add GRADED (PSA 10) → separate row
//   4. Read both rows back
//   5. Edit raw row (quantity 1 → 3)
//   6. RLS: user B cannot READ, UPDATE or DELETE user A's rows
//   7. Card with MULTIPLE printings → choose non-default → add →
//      verify exact tcg_printing_id stored → delete
//   8. Delete both original rows as user A
//   9. Cleanup both users + any leftover rows

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MTG_ENV = readFileSync('C:/Users/lukep/OneDrive/Desktop/mtgprices-web/.env.local', 'utf8');
function envFrom(text, key) {
  const m = new RegExp('^' + key + '=(.*)$', 'm').exec(text);
  return m ? m[1].replace(/^"|"$/g, '') : '';
}
const SUPABASE_URL = envFrom(MTG_ENV, 'NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = envFrom(MTG_ENV, 'SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = envFrom(MTG_ENV, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Missing SUPABASE_URL / SERVICE_KEY / ANON_KEY');
  process.exit(1);
}

const SERVICE = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const stamp = Date.now();
const emailA = `ygo-qc1-a-${stamp}@ygoprices-test.invalid`;
const emailB = `ygo-qc1-b-${stamp}@ygoprices-test.invalid`;
const password = randomUUID();
const created = [];

let failCount = 0;
function step(n, name) { console.log(`\n[${n}] ${name}`); }
function pass(msg) { console.log(`  PASS · ${msg}`); }
function fail(msg) { console.log(`  FAIL · ${msg}`); failCount += 1; }
function info(msg) { console.log(`  ${msg}`); }

async function cleanup() {
  console.log(`\n[cleanup] removing ${created.length} test user(s) + rows`);
  for (const uid of created) {
    try {
      const { error: delErr } = await SERVICE.from('ygo_collection_items').delete().eq('user_id', uid);
      if (delErr) console.error(`  ! row-cleanup ${uid}: ${delErr.message}`);
      await SERVICE.auth.admin.deleteUser(uid);
      console.log(`  ✓ removed user ${uid}`);
    } catch (e) { console.error(`  ! cleanup ${uid}: ${e.message}`); }
  }
}

const TABLE = 'ygo_collection_items';

try {
  // ─────────────────────────────────────────────────────────────
  step('1/9', 'Locate real test fixtures in the production DB');
  // Scan several thousand YGO cards, count printings per card, pick
  // one with exactly one printing and one with several.
  // Cheap two-stage: grab a batch of YGO cards without the FK embed
  // (which times out at scale on this dataset), then fetch printings
  // for those specific cards.
  const { data: cardBatch, error: cbErr } = await SERVICE.from('tcg_cards')
    .select('id, name').eq('game_id', 'ygo').limit(200);
  if (cbErr) { fail(`card batch: ${cbErr.message}`); await cleanup(); process.exit(1); }
  const cardIds = cardBatch.map((c) => c.id);
  const { data: printings, error: pErr } = await SERVICE.from('tcg_printings')
    .select('id, tcg_card_id, set_id, collector_number').in('tcg_card_id', cardIds);
  if (pErr) { fail(`printings batch: ${pErr.message}`); await cleanup(); process.exit(1); }
  const byCard = new Map();
  for (const p of printings) {
    const arr = byCard.get(p.tcg_card_id) ?? [];
    arr.push(p); byCard.set(p.tcg_card_id, arr);
  }
  info(`scanned ${cardBatch.length} YGO cards with ${printings.length} printings`);
  const singles = cardBatch.filter((c) => (byCard.get(c.id) ?? []).length === 1);
  if (!singles.length) { fail('no single-printing YGO card found'); await cleanup(); process.exit(1); }
  const singleCard = singles[0];
  singleCard.tcg_printings = byCard.get(singleCard.id);
  const singlePrintingId = singleCard.tcg_printings[0].id;
  info(`single-printing card: ${singleCard.name} (${singleCard.id}) → printing ${singlePrintingId}`);

  const multi = cardBatch.find((c) => (byCard.get(c.id) ?? []).length >= 3);
  if (!multi) { fail('no multi-printing YGO card found in batch'); await cleanup(); process.exit(1); }
  multi.tcg_printings = byCard.get(multi.id);
  const multiCard = multi;
  const nonDefaultPrinting = multiCard.tcg_printings[Math.floor(multiCard.tcg_printings.length / 2)];
  info(`multi-printing card: ${multiCard.name} (${multiCard.id}) → non-default printing ${nonDefaultPrinting.id} (${multiCard.tcg_printings.length} total)`);

  // ─────────────────────────────────────────────────────────────
  step('2/9', 'Create user A + user B (email-confirmed via service role)');
  const { data: uA, error: uaErr } = await SERVICE.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (uaErr) { fail(`create user A: ${uaErr.message}`); await cleanup(); process.exit(1); }
  created.push(uA.user.id);
  const clientA = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: sigAErr } = await clientA.auth.signInWithPassword({ email: emailA, password });
  if (sigAErr) { fail(`sign in A: ${sigAErr.message}`); await cleanup(); process.exit(1); }
  info(`user A authenticated: ${uA.user.id}`);

  const { data: uB, error: ubErr } = await SERVICE.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (ubErr) { fail(`create user B: ${ubErr.message}`); await cleanup(); process.exit(1); }
  created.push(uB.user.id);
  const clientB = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: sigBErr } = await clientB.auth.signInWithPassword({ email: emailB, password });
  if (sigBErr) { fail(`sign in B: ${sigBErr.message}`); await cleanup(); process.exit(1); }
  info(`user B authenticated: ${uB.user.id}`);

  // ─────────────────────────────────────────────────────────────
  step('3/9', 'User A adds single-printing card RAW');
  const { data: rawRow, error: rawErr } = await clientA.from(TABLE).insert({
    user_id: uA.user.id,
    tcg_card_id: singleCard.id,
    tcg_printing_id: singlePrintingId,
    quantity: 1,
    is_graded: false,
    condition: 'near-mint',
    purchase_price: 12.34,
    purchase_currency: 'USD',
    notes: 'QC1 raw',
  }).select().single();
  if (rawErr) { fail(`raw insert: ${rawErr.message}`); await cleanup(); process.exit(1); }
  if (rawRow.tcg_printing_id === singlePrintingId) pass(`raw row ${rawRow.id} stored exact printing ${rawRow.tcg_printing_id}`);
  else fail(`raw printing mismatch: expected ${singlePrintingId}, got ${rawRow.tcg_printing_id}`);
  if (rawRow.is_graded === false) pass(`is_graded=false`); else fail(`is_graded should be false, got ${rawRow.is_graded}`);
  if (rawRow.condition === 'near-mint') pass(`condition=near-mint`); else fail(`condition mismatch`);

  // ─────────────────────────────────────────────────────────────
  step('4/9', 'User A adds SAME printing GRADED (PSA 10)');
  const { data: slabRow, error: slabErr } = await clientA.from(TABLE).insert({
    user_id: uA.user.id,
    tcg_card_id: singleCard.id,
    tcg_printing_id: singlePrintingId,
    quantity: 1,
    is_graded: true,
    grader: 'psa',
    grade: '10',
    condition: 'near-mint',
    purchase_price: 250,
    purchase_currency: 'USD',
    notes: 'QC1 graded',
  }).select().single();
  if (slabErr) { fail(`slab insert: ${slabErr.message}`); await cleanup(); process.exit(1); }
  if (slabRow.id !== rawRow.id) pass(`graded row ${slabRow.id} is separate from raw row ${rawRow.id}`);
  else fail(`graded row id collides with raw row`);
  if (slabRow.is_graded === true && slabRow.grader === 'psa' && slabRow.grade === '10') pass(`is_graded=true, grader=psa, grade=10`);
  else fail(`graded fields mismatch: is_graded=${slabRow.is_graded}, grader=${slabRow.grader}, grade=${slabRow.grade}`);

  // ─────────────────────────────────────────────────────────────
  step('5/9', 'Read back both rows for single-printing card');
  const { data: readback, error: readErr } = await clientA.from(TABLE)
    .select('id, tcg_printing_id, is_graded, grader, grade, quantity, condition, purchase_price')
    .eq('tcg_printing_id', singlePrintingId);
  if (readErr) { fail(`readback: ${readErr.message}`); await cleanup(); process.exit(1); }
  const rawFound = readback.find((r) => r.id === rawRow.id);
  const slabFound = readback.find((r) => r.id === slabRow.id);
  if (rawFound && slabFound) pass(`both rows visible to user A (${readback.length} rows)`);
  else fail(`readback missing rows: raw=${!!rawFound} slab=${!!slabFound}`);

  // ─────────────────────────────────────────────────────────────
  step('6/9', 'User A edits raw row (quantity 1 → 3)');
  const { error: updErr } = await clientA.from(TABLE).update({ quantity: 3 }).eq('id', rawRow.id);
  if (updErr) { fail(`edit qty: ${updErr.message}`); await cleanup(); process.exit(1); }
  const { data: reread } = await clientA.from(TABLE).select('quantity').eq('id', rawRow.id).single();
  if (reread.quantity === 3) pass(`edit persisted (quantity=${reread.quantity})`);
  else fail(`edit not persisted; qty=${reread?.quantity}`);
  // Also edit the graded row (change grade 10 → 9.5 to prove graded editable)
  const { error: gUpdErr } = await clientA.from(TABLE).update({ grade: '9.5' }).eq('id', slabRow.id);
  if (gUpdErr) fail(`edit graded: ${gUpdErr.message}`);
  const { data: slabRead } = await clientA.from(TABLE).select('grade').eq('id', slabRow.id).single();
  if (slabRead.grade === '9.5') pass(`graded row edit persisted (grade=${slabRead.grade})`);
  else fail(`graded edit not persisted; grade=${slabRead?.grade}`);

  // ─────────────────────────────────────────────────────────────
  step('7/9', 'RLS proof: user B cannot READ, UPDATE or DELETE user A rows');
  const { data: bReads, error: bReadErr } = await clientB.from(TABLE).select('id').eq('user_id', uA.user.id);
  if (bReadErr) info(`  (user B read errored, which is also fine: ${bReadErr.message})`);
  if (!bReads || bReads.length === 0) pass('user B sees 0 of user A rows');
  else fail(`RLS READ LEAK: user B saw ${bReads.length} rows`);

  // Attempt UPDATE
  const { data: bUpd, error: bUpdErr } = await clientB.from(TABLE)
    .update({ quantity: 999 }).eq('id', rawRow.id).select();
  if (bUpdErr || !bUpd || bUpd.length === 0) pass('user B UPDATE blocked (0 rows affected)');
  else fail(`RLS UPDATE LEAK: user B modified ${bUpd.length} row(s)`);
  // Confirm A's row still qty=3
  const { data: postUpd } = await clientA.from(TABLE).select('quantity').eq('id', rawRow.id).single();
  if (postUpd.quantity === 3) pass('user A row remains quantity=3 after user B update attempt');
  else fail(`user A row corrupted by user B; qty=${postUpd?.quantity}`);

  // Attempt DELETE
  const { data: bDel, error: bDelErr } = await clientB.from(TABLE)
    .delete().eq('id', rawRow.id).select();
  if (bDelErr || !bDel || bDel.length === 0) pass('user B DELETE blocked (0 rows affected)');
  else fail(`RLS DELETE LEAK: user B deleted ${bDel.length} row(s)`);
  const { data: stillThere } = await clientA.from(TABLE).select('id').eq('id', rawRow.id);
  if (stillThere && stillThere.length === 1) pass('user A row survived user B delete attempt');
  else fail(`user A row missing after user B delete attempt`);

  // ─────────────────────────────────────────────────────────────
  step('8/9', 'Multi-printing card: user A adds non-default printing');
  const { data: multiRow, error: multiErr } = await clientA.from(TABLE).insert({
    user_id: uA.user.id,
    tcg_card_id: multiCard.id,
    tcg_printing_id: nonDefaultPrinting.id,
    quantity: 1,
    is_graded: false,
    condition: 'mint',
    purchase_price: 55.55,
    purchase_currency: 'USD',
    notes: 'QC1 multi',
  }).select().single();
  if (multiErr) { fail(`multi insert: ${multiErr.message}`); }
  else if (multiRow.tcg_printing_id === nonDefaultPrinting.id) pass(`non-default printing ${nonDefaultPrinting.id} stored exactly`);
  else fail(`multi printing mismatch: expected ${nonDefaultPrinting.id}, got ${multiRow?.tcg_printing_id}`);

  // Delete multi row
  const { error: mDelErr, count: mDelCount } = await clientA.from(TABLE)
    .delete({ count: 'exact' }).eq('id', multiRow.id);
  if (mDelErr) fail(`multi delete: ${mDelErr.message}`);
  else pass(`multi row deleted (${mDelCount ?? '?'} rows)`);

  // ─────────────────────────────────────────────────────────────
  step('9/9', 'User A deletes both original rows');
  const { error: rawDelErr, count: rawDelCount } = await clientA.from(TABLE)
    .delete({ count: 'exact' }).eq('id', rawRow.id);
  if (rawDelErr) fail(`raw delete: ${rawDelErr.message}`);
  else pass(`raw row deleted (${rawDelCount ?? '?'} rows)`);
  const { error: slabDelErr, count: slabDelCount } = await clientA.from(TABLE)
    .delete({ count: 'exact' }).eq('id', slabRow.id);
  if (slabDelErr) fail(`slab delete: ${slabDelErr.message}`);
  else pass(`slab row deleted (${slabDelCount ?? '?'} rows)`);

  // Final read: should be zero rows for user A now
  const { data: finalRead } = await clientA.from(TABLE).select('id');
  if (finalRead && finalRead.length === 0) pass('user A has zero rows after cleanup');
  else fail(`user A has ${finalRead?.length} row(s) remaining, expected 0`);
} finally {
  await cleanup();
  console.log(`\n${failCount === 0 ? 'ALL PASS' : failCount + ' FAIL(S)'}`);
  process.exit(failCount === 0 ? 0 : 1);
}

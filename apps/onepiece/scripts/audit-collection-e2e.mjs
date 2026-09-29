#!/usr/bin/env node
// OP Collection E2E — creates 2 scoped test users, exercises raw +
// graded holdings on a real OP printing, verifies RLS isolation, and
// cleans up. Uses the shared network Supabase project.
//
// Table: op_collection_items
// Schema mirrors ygo_collection_items 1:1 (see
// docs/onepiece/schema-request-collection.md).

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Service-role + anon keys live in the MTG local env (same shared
// Supabase project across MTG/Poke/YGO/OP/Lorcana).
const MTG_ENV = readFileSync('C:/Users/lukep/OneDrive/Desktop/mtgprices-web/.env.local', 'utf8');
function envFrom(text, key) {
  const m = new RegExp('^' + key + '=(.*)$', 'm').exec(text);
  return m ? m[1].replace(/^"|"$/g, '') : '';
}
const SUPABASE_URL = envFrom(MTG_ENV, 'NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = envFrom(MTG_ENV, 'SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = envFrom(MTG_ENV, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('FAIL: missing Supabase env keys in MTG .env.local');
  process.exit(1);
}

const SERVICE = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const TABLE = 'op_collection_items';
const stamp = Date.now();
const emailA = `op-audit-${stamp}-1@ygoprices.io`;
const emailB = `op-audit-${stamp}-2@ygoprices.io`;
const password = randomUUID();
const created = [];

let stepOk = true;
function pass(n, msg) {
  console.log(`[step ${n}/8] PASS ${msg}`);
}
function fail(n, msg) {
  console.error(`[step ${n}/8] FAIL ${msg}`);
  stepOk = false;
}
function abort(n, msg) {
  fail(n, msg);
  throw new Error(`abort at step ${n}: ${msg}`);
}

async function cleanup() {
  console.log('\nCleanup:');
  for (const uid of created) {
    try {
      const { error: delRowsErr } = await SERVICE.from(TABLE).delete().eq('user_id', uid);
      if (delRowsErr) console.error(`  ! rows for ${uid}: ${delRowsErr.message}`);
      const { error: delUserErr } = await SERVICE.auth.admin.deleteUser(uid);
      if (delUserErr) console.error(`  ! user ${uid}: ${delUserErr.message}`);
      else console.log(`  - deleted user ${uid}`);
    } catch (e) {
      console.error(`  ! cleanup ${uid}: ${e.message}`);
    }
  }
}

try {
  // ── Fetch a real OP printing ────────────────────────────────────
  const { data: prints, error: printErr } = await SERVICE.from('tcg_printings')
    .select('id, tcg_card_id, collector_number, set_id')
    .eq('game_id', 'onepiece')
    .limit(1);
  if (printErr) abort(1, `printing lookup: ${printErr.message}`);
  if (!prints?.length) abort(1, 'no OP printings in tcg_printings');
  const testPrinting = prints[0];
  const testCardId = testPrinting.tcg_card_id;

  // ── Step 1: create two test users ───────────────────────────────
  const { data: uA, error: uAErr } = await SERVICE.auth.admin.createUser({
    email: emailA,
    password,
    email_confirm: true,
  });
  if (uAErr || !uA?.user) abort(1, `create user A: ${uAErr?.message}`);
  created.push(uA.user.id);
  const { data: uB, error: uBErr } = await SERVICE.auth.admin.createUser({
    email: emailB,
    password,
    email_confirm: true,
  });
  if (uBErr || !uB?.user) abort(1, `create user B: ${uBErr?.message}`);
  created.push(uB.user.id);
  pass(
    1,
    `created test users A=${uA.user.id.slice(0, 8)}… B=${uB.user.id.slice(0, 8)}… printing=${testPrinting.id}`,
  );

  // Auth-scoped anon client for user A.
  const clientA = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: signAErr } = await clientA.auth.signInWithPassword({
    email: emailA,
    password,
  });
  if (signAErr) abort(1, `sign in A: ${signAErr.message}`);

  // ── Step 2: insert raw holding ──────────────────────────────────
  const { data: rawRow, error: rawErr } = await clientA
    .from(TABLE)
    .insert({
      user_id: uA.user.id,
      tcg_card_id: testCardId,
      tcg_printing_id: testPrinting.id,
      quantity: 2,
      is_graded: false,
      condition: 'near-mint',
      purchase_price: 5.0,
      purchase_currency: 'USD',
      notes: 'OP audit raw copy',
    })
    .select()
    .single();
  if (rawErr) abort(2, `raw insert: ${rawErr.message} (code=${rawErr.code})`);
  pass(2, `raw insert id=${rawRow.id} qty=${rawRow.quantity} condition=${rawRow.condition}`);

  // ── Step 3: insert graded holding on same printing ──────────────
  const { data: slabRow, error: slabErr } = await clientA
    .from(TABLE)
    .insert({
      user_id: uA.user.id,
      tcg_card_id: testCardId,
      tcg_printing_id: testPrinting.id,
      quantity: 1,
      is_graded: true,
      grader: 'psa',
      grade: '10',
      condition: null,
      purchase_price: 250.0,
      purchase_currency: 'USD',
      notes: 'OP audit PSA 10',
    })
    .select()
    .single();
  if (slabErr) abort(3, `graded insert: ${slabErr.message} (code=${slabErr.code})`);
  pass(3, `graded insert id=${slabRow.id} grader=${slabRow.grader} grade=${slabRow.grade}`);

  // ── Step 4: read back — assert coexistence ──────────────────────
  const { data: readback, error: readErr } = await clientA
    .from(TABLE)
    .select('id, is_graded, grader, grade, quantity, condition, purchase_price')
    .eq('tcg_printing_id', testPrinting.id);
  if (readErr) abort(4, `readback: ${readErr.message}`);
  if (!readback || readback.length !== 2) {
    abort(4, `expected 2 rows for printing, got ${readback?.length ?? 0}`);
  }
  const raw = readback.find((r) => !r.is_graded);
  const slab = readback.find((r) => r.is_graded && r.grader === 'psa' && r.grade === '10');
  if (!raw || !slab) abort(4, 'raw + PSA 10 do not coexist under one printing');
  pass(4, `raw + graded coexist for printing ${testPrinting.id}`);

  // ── Step 5: update raw — qty + purchase_price ───────────────────
  const { data: updRow, error: updErr } = await clientA
    .from(TABLE)
    .update({ quantity: 3, purchase_price: 6.5 })
    .eq('id', rawRow.id)
    .select()
    .single();
  if (updErr) abort(5, `update raw: ${updErr.message}`);
  if (updRow.quantity !== 3 || Number(updRow.purchase_price) !== 6.5) {
    abort(
      5,
      `update did not persist (qty=${updRow.quantity} price=${updRow.purchase_price})`,
    );
  }
  pass(5, `raw updated qty=${updRow.quantity} price=${updRow.purchase_price}`);

  // ── Step 6: RLS isolation — user B must see zero of A's rows ────
  const clientB = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: signBErr } = await clientB.auth.signInWithPassword({
    email: emailB,
    password,
  });
  if (signBErr) abort(6, `sign in B: ${signBErr.message}`);
  const { data: bSees, error: bReadErr } = await clientB
    .from(TABLE)
    .select('id')
    .eq('user_id', uA.user.id);
  if (bReadErr) abort(6, `user B read: ${bReadErr.message}`);
  if (bSees && bSees.length > 0) {
    abort(6, `RLS LEAK — user B saw ${bSees.length} of user A's rows`);
  }
  pass(6, `RLS isolated — user B sees 0 of user A's rows`);

  // ── Step 7: delete both rows as user A ──────────────────────────
  const { error: delRawErr } = await clientA.from(TABLE).delete().eq('id', rawRow.id);
  if (delRawErr) abort(7, `delete raw: ${delRawErr.message}`);
  const { error: delSlabErr } = await clientA.from(TABLE).delete().eq('id', slabRow.id);
  if (delSlabErr) abort(7, `delete graded: ${delSlabErr.message}`);
  const { data: postDel, error: postDelErr } = await clientA
    .from(TABLE)
    .select('id')
    .eq('tcg_printing_id', testPrinting.id);
  if (postDelErr) abort(7, `post-delete read: ${postDelErr.message}`);
  if (postDel && postDel.length > 0) {
    abort(7, `expected 0 rows after delete, got ${postDel.length}`);
  }
  pass(7, `both rows deleted; 0 remain for printing`);

  // ── Step 8: cleanup users (happens in finally too, but log
  //             the intent explicitly as the terminal step). ───────
  pass(8, `test-user cleanup will run in finally`);
} catch (e) {
  if (!/^abort at step/.test(e.message)) {
    console.error(`UNEXPECTED: ${e.message}`);
    stepOk = false;
  }
} finally {
  await cleanup();
  if (stepOk) {
    console.log('\nRESULT: PASS · OP Collection E2E clean.');
    process.exit(0);
  } else {
    console.error('\nRESULT: FAIL · see step output above.');
    process.exit(1);
  }
}

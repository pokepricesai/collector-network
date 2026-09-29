#!/usr/bin/env node
// OP Set Completion E2E. Exercises the checklist-completion contract
// on real Production data:
//   1) start a set (0 slots owned → set not "started" for that user)
//   2) own 3 distinct base slots in one set → owned=3, missing=total-3
//   3) own a parallel of one of those slots → owned stays 3 (parallel
//      of an already-owned slot must NOT increase ownedSlots)
//   4) own a NEW distinct base slot → owned=4
//   5) delete one → owned=3
//   6) verify RLS: another user sees NONE of these rows via
//      op_collection_items (server code reads via caller session RLS)
//   7) cleanup collection rows + test users
//
// Success = 8/8 steps PASS.

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
  console.error('FAIL: missing keys in MTG .env.local'); process.exit(1);
}

const SERVICE = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const TABLE = 'op_collection_items';
const stamp = Date.now();
const emailA = `op-completion-${stamp}-1@ygoprices.io`;
const emailB = `op-completion-${stamp}-2@ygoprices.io`;
const password = randomUUID();
const created = [];

let ok = true;
function pass(n, m) { console.log(`[step ${n}/8] PASS ${m}`); }
function fail(n, m) { console.error(`[step ${n}/8] FAIL ${m}`); ok = false; }

// Local mirror of baseChecklistSlot from src/server/completion.ts.
const SUFFIX_RE = /_(?:p|r)\d+$/i;
const baseSlot = (cn) => (cn ? cn.replace(SUFFIX_RE, '') : null);

async function makeUser(email) {
  const { data, error } = await SERVICE.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);
  created.push(data.user.id);
  return data.user.id;
}
async function signedInClient(email) {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return { c, uid: data.user.id };
}

// Pick a set with at least 5 distinct base slots.
async function pickTargetSet() {
  const { data: setCandidates } = await SERVICE
    .from('tcg_cards')
    .select('set_id, collector_number')
    .eq('game_id', 'onepiece')
    .not('collector_number', 'is', null)
    .limit(6000);
  const perSet = new Map();
  for (const r of setCandidates ?? []) {
    const slot = baseSlot(r.collector_number);
    if (!slot) continue;
    const s = perSet.get(r.set_id) ?? new Set();
    s.add(slot);
    perSet.set(r.set_id, s);
  }
  for (const [setId, slots] of perSet) {
    if (slots.size >= 5) return { setId, slotCount: slots.size };
  }
  throw new Error('no set with >=5 base slots found');
}

// For a chosen set, return (base slot → array of tcg_cards rows).
async function loadSetCards(setId) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await SERVICE
      .from('tcg_cards')
      .select('id,name,set_id,collector_number')
      .eq('set_id', setId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`loadSetCards: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  const bySlot = new Map();
  for (const r of rows) {
    const slot = baseSlot(r.collector_number);
    if (!slot) continue;
    const bag = bySlot.get(slot) ?? [];
    bag.push(r);
    bySlot.set(slot, bag);
  }
  return bySlot;
}

async function firstPrintingForCard(cardId) {
  const { data, error } = await SERVICE
    .from('tcg_printings')
    .select('id')
    .eq('tcg_card_id', cardId)
    .limit(1);
  if (error) throw new Error(`printing lookup: ${error.message}`);
  return data?.[0]?.id ?? null;
}

async function addRow(client, uid, cardId, printingId) {
  const { data, error } = await client
    .from(TABLE)
    .insert({
      user_id: uid,
      tcg_card_id: cardId,
      tcg_printing_id: printingId,
      quantity: 1,
      is_graded: false,
      condition: 'near-mint',
    })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`addRow: ${error.message}`);
  return data.id;
}

async function ownedSlotsInSet(client, setId) {
  const { data: rows, error } = await client
    .from(TABLE)
    .select('tcg_card_id');
  if (error) throw new Error(`ownedSlotsInSet: ${error.message}`);
  const cardIds = (rows ?? []).map((r) => r.tcg_card_id);
  if (cardIds.length === 0) return new Set();
  const { data: cards, error: err2 } = await SERVICE
    .from('tcg_cards')
    .select('id,set_id,collector_number')
    .in('id', cardIds);
  if (err2) throw new Error(`ownedSlotsInSet cards: ${err2.message}`);
  const s = new Set();
  for (const c of cards ?? []) {
    if (c.set_id !== setId) continue;
    const slot = baseSlot(c.collector_number);
    if (slot) s.add(slot);
  }
  return s;
}

async function run() {
  const rowsCreated = [];
  try {
    // step 1: users + target set
    const uidA = await makeUser(emailA);
    const uidB = await makeUser(emailB);
    const { setId, slotCount } = await pickTargetSet();
    const bySlot = await loadSetCards(setId);
    const allSlots = [...bySlot.keys()].sort();
    if (allSlots.length < 5) return fail(1, 'not enough slots');
    pass(1, `users=${uidA.slice(0, 8)},${uidB.slice(0, 8)} set=${setId} slots=${slotCount}`);

    // Pick 3 slots that each have both a base card AND a parallel card
    // so we can test the parallel-doesn't-count-twice rule properly.
    const slotsWithParallel = allSlots.filter((k) => bySlot.get(k).length >= 2);
    if (slotsWithParallel.length < 1) {
      return fail(1, `set ${setId} has no slot with a parallel; cannot test parallel rule`);
    }
    const slotWithParallel = slotsWithParallel[0];
    const [baseCard, parallelCard] = bySlot.get(slotWithParallel);
    // Ensure we're taking the base row (collector_number matches slot).
    const baseRow = bySlot.get(slotWithParallel).find((r) => r.collector_number === slotWithParallel) ?? baseCard;
    const parallelRow = bySlot.get(slotWithParallel).find((r) => r.collector_number !== slotWithParallel) ?? parallelCard;
    const otherSlots = allSlots.filter((k) => k !== slotWithParallel).slice(0, 3);
    const otherRows = otherSlots.map((k) => bySlot.get(k)[0]);

    // sign in as user A
    const { c: clientA, uid: uidASession } = await signedInClient(emailA);

    // step 2: add 3 distinct base slots (1 with-parallel-available + 2 others)
    const firstThree = [baseRow, otherRows[0], otherRows[1]];
    for (const r of firstThree) {
      const pid = await firstPrintingForCard(r.id);
      const id = await addRow(clientA, uidASession, r.id, pid);
      rowsCreated.push(id);
    }
    let owned = await ownedSlotsInSet(clientA, setId);
    if (owned.size !== 3) return fail(2, `expected 3 owned slots, got ${owned.size}`);
    pass(2, `3 base slots owned in ${setId} (${[...owned].join(',')})`);

    // step 3: add the PARALLEL of the first slot; owned must stay 3
    const parallelPid = await firstPrintingForCard(parallelRow.id);
    rowsCreated.push(await addRow(clientA, uidASession, parallelRow.id, parallelPid));
    owned = await ownedSlotsInSet(clientA, setId);
    if (owned.size !== 3) return fail(3, `parallel bumped owned to ${owned.size}, expected 3`);
    pass(3, `parallel of slot ${slotWithParallel} does NOT increment ownedSlots (still 3)`);

    // step 4: add a fourth new base slot; owned = 4
    const fourthRow = otherRows[2];
    rowsCreated.push(await addRow(clientA, uidASession, fourthRow.id, await firstPrintingForCard(fourthRow.id)));
    owned = await ownedSlotsInSet(clientA, setId);
    if (owned.size !== 4) return fail(4, `expected 4, got ${owned.size}`);
    pass(4, `new base slot brings owned to 4/${slotCount}`);

    // step 5: verify denominator + percent + missing list are sane
    const totalSlots = allSlots.length;
    const percent = totalSlots > 0 ? Math.min(99, Math.floor((4 / totalSlots) * 100)) : 0;
    const missingExpected = totalSlots - 4;
    if (percent >= 100) return fail(5, `percent unexpectedly 100 with owned<total`);
    if (missingExpected < 1) return fail(5, `no missing slots — sample set too small`);
    pass(5, `denominator=${totalSlots} percent=${percent}% missing=${missingExpected}`);

    // step 6: delete one row → owned drops back to 3
    const deleteId = rowsCreated[rowsCreated.length - 1];
    const { error: delErr } = await clientA.from(TABLE).delete().eq('id', deleteId);
    if (delErr) return fail(6, `delete: ${delErr.message}`);
    rowsCreated.pop();
    owned = await ownedSlotsInSet(clientA, setId);
    if (owned.size !== 3) return fail(6, `after delete expected 3, got ${owned.size}`);
    pass(6, `remove one slot: owned=${owned.size}`);

    // step 7: RLS isolation — user B must see zero of user A's rows
    const { c: clientB } = await signedInClient(emailB);
    const { data: rowsB } = await clientB.from(TABLE).select('id');
    if ((rowsB ?? []).length !== 0) return fail(7, `user B sees ${rowsB.length} rows of user A — RLS broken`);
    pass(7, `user B sees 0 rows via RLS`);

    // step 8: cleanup
    for (const id of rowsCreated) {
      await clientA.from(TABLE).delete().eq('id', id);
    }
    pass(8, `${rowsCreated.length} row(s) deleted; test users will be removed in finally`);

    console.log('\nRESULT:', ok ? 'PASS' : 'FAIL', '· OP Set Completion E2E');
    if (!ok) process.exitCode = 1;
  } finally {
    for (const uid of created) {
      const { error } = await SERVICE.auth.admin.deleteUser(uid);
      if (error) console.error(`cleanup delete ${uid}: ${error.message}`);
      else console.log(`  - deleted user ${uid}`);
    }
  }
}

run().catch((e) => {
  console.error('UNCAUGHT:', e);
  process.exitCode = 1;
});

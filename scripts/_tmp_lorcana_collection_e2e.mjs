// One-shot: authenticated end-to-end proof of the lorcana_collection_items
// flow. Creates a scoped test user via the CLI's linked DB, signs in via
// the anon endpoint (matching what the LorcanaPrices app does), performs
// list -> insert -> select -> update -> delete via PostgREST + user JWT,
// then removes the test user (which cascades any residual rows). No
// service-role usage. Nothing sensitive is echoed.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const env = {};
for (const line of fs.readFileSync(path.join('C:', 'Users', 'lukep', 'Documents', 'collector-network', 'apps', 'yugioh', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/^'|'$/g, '');
}
const BASE = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

// One-off test credentials.
const TEST_EMAIL = `e2e-lorcana-${Date.now()}@lorcanaprices-test.local`;
const TEST_PASSWORD = crypto.randomUUID() + '!Ab1';

function runSql(sql) {
  const cmd = `supabase db query --linked "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function log(...args) { console.log(...args); }

// ── STEP 1: create the test user via SQL (bypasses email confirmation).
log('▶ 1. creating test user via SQL');
const createUserSql = `
  insert into auth.users (
    id, aud, role, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    gen_random_uuid(), 'authenticated', 'authenticated',
    '00000000-0000-0000-0000-000000000000',
    '${TEST_EMAIL}',
    crypt('${TEST_PASSWORD}', gen_salt('bf')),
    now(), now(), now(),
    '{\\"provider\\": \\"email\\", \\"providers\\": [\\"email\\"]}',
    '{}',
    '', '', '', ''
  )
  returning id, email;
`;
const created = runSql(createUserSql);
log('   ok');

// ── STEP 2: sign in via /auth/v1/token (anon endpoint) to get the JWT.
log('▶ 2. signing in via /auth/v1/token');
const tokenRes = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
});
if (!tokenRes.ok) {
  const body = await tokenRes.text();
  throw new Error(`sign-in failed: ${tokenRes.status} ${body.slice(0, 200)}`);
}
const tokenBody = await tokenRes.json();
const jwt = tokenBody.access_token;
const userId = tokenBody.user?.id;
log(`   ok  userId=${userId.slice(0, 8)}…  jwt-len=${jwt.length}`);

const authHeaders = { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };

// ── STEP 3: pick a real Lorcana printing to work with (anon-readable via tcg_ tables).
log('▶ 3. resolving a real Lorcana card + printing');
const printingRes = await fetch(
  `${BASE}/rest/v1/tcg_printings?select=id,tcg_card_id,finish,collector_number&game_id=eq.lorcana&finish=eq.nonfoil&limit=1`,
  { headers: { apikey: ANON } },
);
const printings = await printingRes.json();
const printing = printings[0];
if (!printing) throw new Error('no lorcana printings found');
log(`   ok  printing.id=${printing.id.slice(-12)}…  card_id=${printing.tcg_card_id.slice(-12)}…  cn=${printing.collector_number}`);

// ── STEP 4: LIST — should be empty, but importantly no `schema-missing`.
log('▶ 4. GET /rest/v1/lorcana_collection_items (empty, no schema-missing)');
const listRes = await fetch(`${BASE}/rest/v1/lorcana_collection_items?select=*&order=created_at.desc`, { headers: authHeaders });
log(`   status=${listRes.status}  body=${(await listRes.text()).slice(0, 60)}`);
if (listRes.status !== 200) throw new Error('list should be 200');

// ── STEP 5: INSERT a raw nonfoil quantity-1 holding.
log('▶ 5. POST /rest/v1/lorcana_collection_items (raw, nonfoil, qty 1)');
const insertRes = await fetch(`${BASE}/rest/v1/lorcana_collection_items`, {
  method: 'POST',
  headers: { ...authHeaders, Prefer: 'return=representation' },
  body: JSON.stringify({
    user_id: userId,
    tcg_card_id: printing.tcg_card_id,
    tcg_printing_id: printing.id,
    quantity: 1,
    is_graded: false,
    condition: 'near-mint',
  }),
});
if (!insertRes.ok) throw new Error(`insert failed ${insertRes.status} ${await insertRes.text()}`);
const [inserted] = await insertRes.json();
log(`   ok  inserted.id=${inserted.id.slice(-12)}…`);

// ── STEP 6: LIST — should return exactly the inserted row.
log('▶ 6. GET /rest/v1/lorcana_collection_items (should return the row)');
const list2Res = await fetch(`${BASE}/rest/v1/lorcana_collection_items?select=*`, { headers: authHeaders });
const list2 = await list2Res.json();
log(`   status=${list2Res.status}  count=${list2.length}  qty=${list2[0]?.quantity}  is_graded=${list2[0]?.is_graded}`);
if (list2.length !== 1) throw new Error('expected exactly 1 row');

// ── STEP 7: UPDATE — bump quantity to 3, add notes.
log('▶ 7. PATCH quantity=3 + notes');
const patchRes = await fetch(`${BASE}/rest/v1/lorcana_collection_items?id=eq.${inserted.id}`, {
  method: 'PATCH',
  headers: { ...authHeaders, Prefer: 'return=representation' },
  body: JSON.stringify({ quantity: 3, notes: 'e2e-test-note' }),
});
if (!patchRes.ok) throw new Error(`patch failed ${patchRes.status} ${await patchRes.text()}`);
const [updated] = await patchRes.json();
log(`   ok  quantity=${updated.quantity}  notes="${updated.notes}"  updated_at advanced=${updated.updated_at > updated.created_at}`);

// ── STEP 8: DELETE.
log('▶ 8. DELETE the row');
const delRes = await fetch(`${BASE}/rest/v1/lorcana_collection_items?id=eq.${inserted.id}`, {
  method: 'DELETE', headers: authHeaders,
});
log(`   status=${delRes.status}`);
if (delRes.status < 200 || delRes.status >= 300) throw new Error('delete failed');

// ── STEP 9: LIST again — should be empty.
log('▶ 9. GET again (should be empty)');
const list3Res = await fetch(`${BASE}/rest/v1/lorcana_collection_items?select=*`, { headers: authHeaders });
const list3 = await list3Res.json();
log(`   status=${list3Res.status}  count=${list3.length}`);
if (list3.length !== 0) throw new Error('expected 0 rows after delete');

// ── STEP 10: also insert a graded holding to prove that shape works.
log('▶10. POST a graded holding (PSA 10)');
const gradedRes = await fetch(`${BASE}/rest/v1/lorcana_collection_items`, {
  method: 'POST',
  headers: { ...authHeaders, Prefer: 'return=representation' },
  body: JSON.stringify({
    user_id: userId,
    tcg_card_id: printing.tcg_card_id,
    tcg_printing_id: printing.id,
    quantity: 1,
    is_graded: true,
    grader: 'psa',
    grade: '10',
  }),
});
if (!gradedRes.ok) throw new Error(`graded insert failed ${gradedRes.status} ${await gradedRes.text()}`);
const [graded] = await gradedRes.json();
log(`   ok  graded.id=${graded.id.slice(-12)}…  grader=${graded.grader}  grade=${graded.grade}`);
// Clean it up so cascade delete has nothing to do.
await fetch(`${BASE}/rest/v1/lorcana_collection_items?id=eq.${graded.id}`, { method: 'DELETE', headers: authHeaders });

// ── STEP 11: verify a shape-violating insert is blocked (graded=true, missing grader).
log('▶11. POST a shape-violating row (graded=true, no grader) — should FAIL');
const badRes = await fetch(`${BASE}/rest/v1/lorcana_collection_items`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({
    user_id: userId, tcg_card_id: printing.tcg_card_id,
    tcg_printing_id: printing.id, quantity: 1, is_graded: true,
  }),
});
log(`   status=${badRes.status} (expected 4xx)`);
if (badRes.ok) throw new Error('shape violation should have been blocked');

// ── STEP 12: clean up test user.
log('▶12. deleting test user (cascade removes any residual holdings)');
runSql(`delete from auth.users where id = '${userId}';`);
log('   ok');

log('\n✅ Lorcana collection E2E: PASS');

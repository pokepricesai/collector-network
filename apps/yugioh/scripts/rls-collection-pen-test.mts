#!/usr/bin/env node
// Slice D — two-user RLS penetration test for ygo_collection_items.
//
// Proves that Row-Level Security prevents User B from reading,
// updating or deleting a holding created by User A, even with a
// valid Supabase session for User B.
//
// Usage:
//   node --env-file=.env.local --experimental-strip-types scripts/rls-collection-pen-test.mts
//
// Expects NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
// and that the migration in docs/yugioh/schema-request-slice-d.md
// has been applied against the shared Supabase project.
//
// Uses mail.tm disposable inboxes so email-confirmation can be
// completed programmatically. Both test accounts are torn down at
// the end via supabase.auth.signOut() — auth.users rows will remain
// but with no data attached (safe, and matches how the app works).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY');
  process.exit(1);
}

type Assert = { pass: boolean; label: string; detail?: string };
const results: Assert[] = [];
function check(pass: boolean, label: string, detail?: string) {
  results.push({ pass, label, detail });
  const badge = pass ? 'PASS' : 'FAIL';
  console.log(`  [${badge}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// ── mail.tm helpers ──────────────────────────────────────

interface MailBox {
  address: string;
  password: string;
  token: string;
}

async function createMailbox(): Promise<MailBox> {
  const domains = await fetch('https://api.mail.tm/domains').then((r) => r.json());
  const domain = domains['hydra:member'][0].domain;
  const address = `ygorls${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@${domain}`;
  const password = `Rls-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const createRes = await fetch('https://api.mail.tm/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });
  if (!createRes.ok) {
    throw new Error(`mail.tm account create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const tokenRes = await fetch('https://api.mail.tm/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });
  const { token } = await tokenRes.json();
  return { address, password, token };
}

async function pollForConfirmLink(box: MailBox, timeoutMs = 60_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = await fetch('https://api.mail.tm/messages', {
      headers: { authorization: `Bearer ${box.token}` },
    }).then((r) => r.json());
    const messages = list['hydra:member'] ?? [];
    for (const m of messages) {
      const detail = await fetch(`https://api.mail.tm/messages/${m.id}`, {
        headers: { authorization: `Bearer ${box.token}` },
      }).then((r) => r.json());
      const bodies = [detail.text, detail.html?.join?.(' ') ?? '', JSON.stringify(detail)].join(' ');
      const match = bodies.match(/https?:\/\/[^\s"'<>]+/g);
      if (match) {
        const confirm = match.find((u) => /confirm|verify|auth\/callback|token/i.test(u));
        if (confirm) return confirm.replace(/[),.]+$/, '');
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`No confirmation email arrived within ${timeoutMs}ms for ${box.address}`);
}

// ── Supabase user helpers ────────────────────────────────

async function signUpAndConfirm(box: MailBox): Promise<SupabaseClient> {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.auth.signUp({
    email: box.address,
    password: box.password,
    options: { emailRedirectTo: 'https://yugioh-web.vercel.app/auth/callback' },
  });
  if (error) throw new Error(`signUp: ${error.message}`);
  const link = await pollForConfirmLink(box);
  // Extract the code param and finish the token-exchange manually.
  const url = new URL(link);
  const token = url.searchParams.get('token') ?? url.searchParams.get('code');
  const type = (url.searchParams.get('type') ?? 'signup') as
    | 'signup'
    | 'email'
    | 'recovery'
    | 'invite';
  if (token) {
    await sb.auth.verifyOtp({ type, token_hash: token });
  } else {
    // Fall back to hitting the URL — it will set cookies but we don't
    // capture them, so try password sign-in as the confirmation path.
    await fetch(link, { redirect: 'manual' }).catch(() => {});
  }
  const { data, error: signInErr } = await sb.auth.signInWithPassword({
    email: box.address,
    password: box.password,
  });
  if (signInErr || !data.session) throw new Error(`signIn: ${signInErr?.message}`);
  return sb;
}

// ── Main ─────────────────────────────────────────────────

async function pickAnyPrinting(): Promise<{ tcg_card_id: string; tcg_printing_id: string }> {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await sb
    .from('tcg_printings')
    .select('id, tcg_card_id')
    .eq('game_id', 'ygo')
    .limit(1);
  if (error) throw new Error(`printing lookup: ${error.message}`);
  const row = (data ?? [])[0];
  if (!row) throw new Error('No YGO printings in DB — cannot run test');
  return { tcg_card_id: row.tcg_card_id, tcg_printing_id: row.id };
}

async function main() {
  console.log('── RLS penetration test · ygo_collection_items ──\n');

  console.log('Provisioning two disposable users...');
  const boxA = await createMailbox();
  const boxB = await createMailbox();
  console.log(`  A: ${boxA.address}`);
  console.log(`  B: ${boxB.address}`);

  const [sbA, sbB] = await Promise.all([
    signUpAndConfirm(boxA),
    signUpAndConfirm(boxB),
  ]);

  const { data: userA } = await sbA.auth.getUser();
  const { data: userB } = await sbB.auth.getUser();
  console.log(`  A.id: ${userA.user?.id}`);
  console.log(`  B.id: ${userB.user?.id}\n`);

  const picked = await pickAnyPrinting();
  console.log(`Chosen printing: ${picked.tcg_printing_id}\n`);

  console.log('Step 1: User A inserts a holding');
  const { data: inserted, error: insErr } = await sbA
    .from('ygo_collection_items')
    .insert({
      user_id: userA.user!.id,
      tcg_card_id: picked.tcg_card_id,
      tcg_printing_id: picked.tcg_printing_id,
      quantity: 1,
      is_graded: false,
      condition: 'near-mint',
    })
    .select('*')
    .single();
  check(!insErr && !!inserted, 'A can insert their own row', insErr?.message);
  if (!inserted) return;

  console.log('\nStep 2: User A can read their row');
  const { data: readAAOwn } = await sbA
    .from('ygo_collection_items')
    .select('*')
    .eq('id', inserted.id);
  check((readAAOwn ?? []).length === 1, 'A sees their own row');

  console.log("\nStep 3: User B SELECT — must see zero rows of A's");
  const { data: readB, error: readBErr } = await sbB
    .from('ygo_collection_items')
    .select('*')
    .eq('id', inserted.id);
  check(
    !readBErr && (readB ?? []).length === 0,
    "B cannot SELECT A's row",
    readBErr ? `err: ${readBErr.message}` : `rows: ${(readB ?? []).length}`,
  );

  console.log('\nStep 4: User B tries to UPDATE — must be denied / no-op');
  const { data: updB, error: updBErr } = await sbB
    .from('ygo_collection_items')
    .update({ quantity: 999, notes: 'pwned' })
    .eq('id', inserted.id)
    .select('*');
  check(
    !updBErr && (updB ?? []).length === 0,
    "B's UPDATE returns zero affected rows",
    updBErr ? `err: ${updBErr.message}` : `affected: ${(updB ?? []).length}`,
  );

  // Verify A's row is unchanged
  const { data: reReadA } = await sbA
    .from('ygo_collection_items')
    .select('quantity, notes')
    .eq('id', inserted.id)
    .single();
  check(
    reReadA?.quantity === 1 && reReadA?.notes !== 'pwned',
    "A's row is untouched by B's UPDATE",
    `quantity=${reReadA?.quantity} notes=${reReadA?.notes ?? 'null'}`,
  );

  console.log('\nStep 5: User B tries to DELETE — must be denied / no-op');
  const { data: delB, error: delBErr } = await sbB
    .from('ygo_collection_items')
    .delete()
    .eq('id', inserted.id)
    .select('*');
  check(
    !delBErr && (delB ?? []).length === 0,
    "B's DELETE returns zero affected rows",
    delBErr ? `err: ${delBErr.message}` : `affected: ${(delB ?? []).length}`,
  );

  // Verify row still exists
  const { data: stillThere } = await sbA
    .from('ygo_collection_items')
    .select('id')
    .eq('id', inserted.id);
  check(
    (stillThere ?? []).length === 1,
    "A's row survives B's DELETE attempt",
  );

  console.log("\nStep 6: User B tries to INSERT with A's user_id — must fail");
  const { data: insSpoof, error: insSpoofErr } = await sbB
    .from('ygo_collection_items')
    .insert({
      user_id: userA.user!.id,
      tcg_card_id: picked.tcg_card_id,
      tcg_printing_id: picked.tcg_printing_id,
      quantity: 42,
      is_graded: false,
    })
    .select('*');
  check(
    !!insSpoofErr || (insSpoof ?? []).length === 0,
    "B cannot spoof A's user_id on INSERT",
    insSpoofErr ? `err: ${insSpoofErr.code}` : `rows: ${(insSpoof ?? []).length}`,
  );

  console.log('\nStep 7: A deletes their own row (cleanup)');
  const { error: delAErr, data: delA } = await sbA
    .from('ygo_collection_items')
    .delete()
    .eq('id', inserted.id)
    .select('id');
  check(!delAErr && (delA ?? []).length === 1, 'A can delete their own row', delAErr?.message);

  await Promise.all([sbA.auth.signOut(), sbB.auth.signOut()]);

  // ── Summary ────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  console.log('\n── Summary ──────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

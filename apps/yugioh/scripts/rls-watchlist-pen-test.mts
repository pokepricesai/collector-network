#!/usr/bin/env node
// Slice E — two-user RLS penetration test for ygo_watchlist_items.
//
// Proves owner-only enforcement: User B cannot read, update or
// delete User A's watched printings.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY');
  process.exit(1);
}

interface MailBox { address: string; password: string; token: string; }

async function createMailbox(): Promise<MailBox> {
  const domains = await fetch('https://api.mail.tm/domains').then((r) => r.json());
  const list: string[] = (domains['hydra:member'] ?? []).map((d: { domain: string }) => d.domain);
  // Rotate over available domains; back off on 429 with exponential
  // wait since mail.tm keeps per-IP account-creation quota tight.
  let lastStatus = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const domain = list[attempt % list.length]!;
    const address = `ygowl${Date.now().toString(36)}${Math.floor(Math.random() * 1e5)}@${domain}`;
    const password = `Wl-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const c = await fetch('https://api.mail.tm/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, password }),
    });
    if (c.ok) {
      const t = await fetch('https://api.mail.tm/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, password }),
      }).then((r) => r.json());
      return { address, password, token: t.token };
    }
    lastStatus = c.status;
    if (c.status !== 429 && c.status !== 500 && c.status !== 502 && c.status !== 503) {
      throw new Error(`mailbox: ${c.status} ${await c.text()}`);
    }
    const backoff = 5_000 + attempt * 5_000;
    console.log(`  mail.tm ${c.status} — backing off ${backoff}ms (attempt ${attempt + 1})`);
    await new Promise((r) => setTimeout(r, backoff));
  }
  throw new Error(`mailbox: giving up after 12 attempts, last status=${lastStatus}`);
}
async function waitLink(box: MailBox, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = await fetch('https://api.mail.tm/messages', {
      headers: { authorization: `Bearer ${box.token}` },
    }).then((r) => r.json());
    for (const m of list['hydra:member'] ?? []) {
      const det = await fetch(`https://api.mail.tm/messages/${m.id}`, {
        headers: { authorization: `Bearer ${box.token}` },
      }).then((r) => r.json());
      const text = [det.text, (det.html ?? []).join(' ')].join(' ');
      const m2 = text.match(/https?:\/\/[^\s"'<>]+/g);
      if (m2) {
        const c = m2.find((u: string) => /confirm|verify|auth\/callback|token/i.test(u));
        if (c) return c.replace(/[),.]+$/, '');
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error('no confirm mail');
}
async function bootUser(): Promise<{ sb: SupabaseClient; userId: string }> {
  const box = await createMailbox();
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signUp({
    email: box.address,
    password: box.password,
    options: { emailRedirectTo: 'https://yugioh-web.vercel.app/auth/callback' },
  });
  const link = await waitLink(box);
  const u = new globalThis.URL(link);
  const token = u.searchParams.get('token') ?? u.searchParams.get('code');
  const type = (u.searchParams.get('type') ?? 'signup') as
    | 'signup' | 'email' | 'recovery' | 'invite';
  if (token) await sb.auth.verifyOtp({ type, token_hash: token });
  await sb.auth.signInWithPassword({ email: box.address, password: box.password });
  const { data } = await sb.auth.getUser();
  return { sb, userId: data.user!.id };
}

const results: { label: string; pass: boolean; detail?: string }[] = [];
function check(label: string, pass: boolean, detail?: string) {
  results.push({ label, pass, detail });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function pickTwoPrintings() {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await anon
    .from('tcg_printings')
    .select('id, tcg_card_id')
    .eq('game_id', 'ygo')
    .limit(2);
  return data as { id: string; tcg_card_id: string }[];
}

async function main() {
  console.log('── RLS penetration test · ygo_watchlist_items ──\n');
  console.log('provisioning two users…');
  // Serial (not parallel) to avoid mail.tm 429 rate-limit.
  const A = await bootUser();
  await new Promise((r) => setTimeout(r, 3_000));
  const B = await bootUser();
  console.log(`  A.id ${A.userId}\n  B.id ${B.userId}\n`);

  const printings = await pickTwoPrintings();
  const p1 = printings[0]!;
  const p2 = printings[1]!;
  console.log(`printings: ${p1.id}, ${p2.id}\n`);

  console.log('Step 1: A inserts a watch');
  const { data: insA, error: insErrA } = await A.sb
    .from('ygo_watchlist_items')
    .insert({
      user_id: A.userId,
      tcg_card_id: p1.tcg_card_id,
      tcg_printing_id: p1.id,
      target_price: 25,
      target_currency: 'USD',
    })
    .select('*').single();
  check('A inserts own row', !insErrA && !!insA, insErrA?.message);
  if (!insA) return;

  console.log('\nStep 2: A reads own row');
  const { data: rA } = await A.sb
    .from('ygo_watchlist_items').select('*').eq('id', insA.id);
  check('A sees own row', (rA ?? []).length === 1);

  console.log("\nStep 3: B SELECT of A's row must return zero rows");
  const { data: rB } = await B.sb
    .from('ygo_watchlist_items').select('*').eq('id', insA.id);
  check("B cannot SELECT A's row", (rB ?? []).length === 0, `rows: ${(rB ?? []).length}`);

  console.log("\nStep 4: B UPDATE of A's row must be a no-op");
  const { data: uB, error: uErrB } = await B.sb
    .from('ygo_watchlist_items')
    .update({ target_price: 999, note: 'pwned' })
    .eq('id', insA.id)
    .select('*');
  check("B's UPDATE returns 0 affected", !uErrB && (uB ?? []).length === 0,
    uErrB ? `err ${uErrB.code}` : `affected: ${(uB ?? []).length}`);
  const { data: reReadA } = await A.sb
    .from('ygo_watchlist_items')
    .select('target_price, note').eq('id', insA.id).single();
  check("A's row untouched", reReadA?.target_price === 25 && reReadA?.note == null,
    `target=${reReadA?.target_price} note=${reReadA?.note}`);

  console.log("\nStep 5: B DELETE of A's row must be a no-op");
  const { data: dB, error: dErrB } = await B.sb
    .from('ygo_watchlist_items').delete().eq('id', insA.id).select('*');
  check("B's DELETE returns 0 affected", !dErrB && (dB ?? []).length === 0,
    dErrB ? `err ${dErrB.code}` : `affected: ${(dB ?? []).length}`);
  const { data: stillThere } = await A.sb
    .from('ygo_watchlist_items').select('id').eq('id', insA.id);
  check("A's row survives", (stillThere ?? []).length === 1);

  console.log("\nStep 6: B INSERT spoofing A's user_id must fail");
  const { data: sp, error: spErr } = await B.sb
    .from('ygo_watchlist_items')
    .insert({
      user_id: A.userId,
      tcg_card_id: p2.tcg_card_id,
      tcg_printing_id: p2.id,
    }).select('*');
  check("B cannot spoof A's user_id", !!spErr || (sp ?? []).length === 0,
    spErr ? `err ${spErr.code}` : 'insert succeeded');

  console.log('\nStep 7: A UPDATE own row succeeds');
  const { data: uOwn, error: uOwnErr } = await A.sb
    .from('ygo_watchlist_items')
    .update({ target_price: 30, target_currency: 'USD' })
    .eq('id', insA.id).select('*').single();
  check("A can UPDATE own row", !uOwnErr && uOwn?.target_price === 30);

  console.log('\nStep 8: Duplicate watch by A rejected by unique constraint');
  const { error: dupErr } = await A.sb
    .from('ygo_watchlist_items')
    .insert({
      user_id: A.userId,
      tcg_card_id: p1.tcg_card_id,
      tcg_printing_id: p1.id,
    });
  check('unique(user_id, tcg_printing_id) rejects duplicate',
    !!dupErr && dupErr.code === '23505', dupErr?.code);

  console.log('\nStep 9: A DELETE own row');
  const { data: dOwn, error: dOwnErr } = await A.sb
    .from('ygo_watchlist_items').delete().eq('id', insA.id).select('id');
  check("A can DELETE own row", !dOwnErr && (dOwn ?? []).length === 1);

  await Promise.all([A.sb.auth.signOut(), B.sb.auth.signOut()]);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n── ${results.length - failed.length}/${results.length} passed ──`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.label} ${f.detail ?? ''}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });

#!/usr/bin/env node
// Slice F — two-user RLS penetration test for ygo_decks +
// ygo_deck_cards.
//
// Proves owner-only enforcement on both tables. deck_cards' policy
// is a subquery on ygo_decks; this test hammers both the direct and
// the child-of-someone-else's-deck paths.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY'); process.exit(1); }

interface MailBox { address: string; password: string; token: string; }

async function createMailbox(): Promise<MailBox> {
  const domains = await fetch('https://api.mail.tm/domains').then((r) => r.json());
  const list: string[] = (domains['hydra:member'] ?? []).map((d: { domain: string }) => d.domain);
  let lastStatus = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const domain = list[attempt % list.length]!;
    // Short lowercase username — some mail.tm domains reject long
    // or digit-heavy locals. 9 chars keeps every domain happy.
    const address = `ygo${Math.random().toString(36).slice(2, 9)}@${domain}`;
    const password = `Dk-${Math.random().toString(36).slice(2)}-${Date.now()}`;
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
    // 422 = domain rejected this address; rotate to the next domain
    // immediately. 429/5xx = rate-limit or transient; back off.
    if (c.status === 422) {
      console.log(`  mail.tm 422 on ${domain}, rotating`);
      continue;
    }
    if (c.status !== 429 && c.status !== 500 && c.status !== 502 && c.status !== 503) {
      throw new Error(`mailbox: ${c.status} ${await c.text()}`);
    }
    const backoff = 5_000 + attempt * 5_000;
    console.log(`  mail.tm ${c.status} — backing off ${backoff}ms (attempt ${attempt + 1})`);
    await new Promise((r) => setTimeout(r, backoff));
  }
  throw new Error(`mailbox: giving up after 12 attempts, last status=${lastStatus}`);
}
async function waitLink(box: MailBox, timeoutMs = 90_000) {
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
  const sb = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signUp({
    email: box.address,
    password: box.password,
    options: { emailRedirectTo: 'https://yugioh-web.vercel.app/auth/callback' },
  });
  const link = await waitLink(box);
  const parsed = new globalThis.URL(link);
  const token = parsed.searchParams.get('token') ?? parsed.searchParams.get('code');
  const type = (parsed.searchParams.get('type') ?? 'signup') as
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

async function main() {
  console.log('── RLS penetration test · ygo_decks + ygo_deck_cards ──\n');
  console.log('provisioning two users (serial to avoid mail.tm 429)…');
  const A = await bootUser();
  await new Promise((r) => setTimeout(r, 3_000));
  const B = await bootUser();
  console.log(`  A.id ${A.userId}\n  B.id ${B.userId}\n`);

  // ── ygo_decks ──────────────────────────────────────
  console.log('Step 1: A creates a deck');
  const { data: deckA, error: dAErr } = await A.sb
    .from('ygo_decks')
    .insert({ user_id: A.userId, name: 'A Deck' })
    .select('*').single();
  check('A creates own deck', !dAErr && !!deckA, dAErr?.message);
  if (!deckA) return;

  console.log('\nStep 2: A adds a deck card');
  const { data: cardA, error: cAErr } = await A.sb
    .from('ygo_deck_cards')
    .insert({
      deck_id: deckA.id,
      card_key: 'ash blossom & joyous spring',
      card_name: 'Ash Blossom & Joyous Spring',
      section: 'main',
      quantity: 1,
    })
    .select('*').single();
  check('A adds own deck card', !cAErr && !!cardA, cAErr?.message);

  console.log("\nStep 3: B SELECT of A's deck must return zero rows");
  const { data: rB } = await B.sb
    .from('ygo_decks').select('*').eq('id', deckA.id);
  check("B cannot SELECT A's deck", (rB ?? []).length === 0, `rows: ${(rB ?? []).length}`);

  console.log("\nStep 4: B SELECT of A's deck cards must return zero rows");
  const { data: rBC } = await B.sb
    .from('ygo_deck_cards').select('*').eq('deck_id', deckA.id);
  check("B cannot SELECT A's deck cards", (rBC ?? []).length === 0, `rows: ${(rBC ?? []).length}`);

  console.log("\nStep 5: B UPDATE of A's deck must be no-op");
  const { data: uB } = await B.sb
    .from('ygo_decks').update({ name: 'pwned' }).eq('id', deckA.id).select('*');
  check("B's UPDATE returns 0 affected", (uB ?? []).length === 0, `affected: ${(uB ?? []).length}`);
  const { data: reReadName } = await A.sb.from('ygo_decks').select('name').eq('id', deckA.id).single();
  check("A's deck name untouched", reReadName?.name === 'A Deck', reReadName?.name);

  console.log("\nStep 6: B UPDATE of A's deck cards must be no-op");
  const { data: uBC } = await B.sb
    .from('ygo_deck_cards').update({ quantity: 3 }).eq('deck_id', deckA.id).select('*');
  check("B's UPDATE of A's deck cards returns 0 affected", (uBC ?? []).length === 0, `affected: ${(uBC ?? []).length}`);

  console.log("\nStep 7: B DELETE of A's deck must be no-op");
  const { data: dB } = await B.sb
    .from('ygo_decks').delete().eq('id', deckA.id).select('*');
  check("B's DELETE of A's deck returns 0 affected", (dB ?? []).length === 0);
  const { data: stillDeck } = await A.sb.from('ygo_decks').select('id').eq('id', deckA.id);
  check("A's deck survives", (stillDeck ?? []).length === 1);

  console.log("\nStep 8: B DELETE of A's deck cards must be no-op");
  const { data: dBC } = await B.sb
    .from('ygo_deck_cards').delete().eq('deck_id', deckA.id).select('*');
  check("B's DELETE of A's deck cards returns 0 affected", (dBC ?? []).length === 0);
  const { data: stillCards } = await A.sb.from('ygo_deck_cards').select('id').eq('deck_id', deckA.id);
  check("A's deck cards survive", (stillCards ?? []).length === 1);

  console.log("\nStep 9: B INSERT into A's deck (using A's deck_id) must be rejected");
  const { data: bIns, error: bInsErr } = await B.sb
    .from('ygo_deck_cards')
    .insert({
      deck_id: deckA.id,
      card_key: 'monster reborn',
      card_name: 'Monster Reborn',
      section: 'main',
      quantity: 1,
    })
    .select('*');
  check(
    "B cannot INSERT into A's deck",
    !!bInsErr || (bIns ?? []).length === 0,
    bInsErr ? `err ${bInsErr.code}` : `inserted: ${(bIns ?? []).length}`,
  );

  console.log("\nStep 10: B INSERT with spoofed user_id must fail");
  const { data: sp, error: spErr } = await B.sb
    .from('ygo_decks')
    .insert({ user_id: A.userId, name: 'Spoofed' })
    .select('*');
  check(
    "B cannot spoof A's user_id on a deck",
    !!spErr || (sp ?? []).length === 0,
    spErr ? `err ${spErr.code}` : `inserted: ${(sp ?? []).length}`,
  );

  console.log('\nStep 11: A can update own deck card');
  const { data: uOwn } = await A.sb
    .from('ygo_deck_cards')
    .update({ quantity: 3 }).eq('id', cardA!.id).select('*').single();
  check("A can UPDATE own deck card", uOwn?.quantity === 3);

  console.log('\nStep 12: A can delete own deck (cascades cards)');
  const { data: dOwn } = await A.sb
    .from('ygo_decks').delete().eq('id', deckA.id).select('id');
  check('A can DELETE own deck', (dOwn ?? []).length === 1);
  const { data: cardsGone } = await A.sb
    .from('ygo_deck_cards').select('id').eq('deck_id', deckA.id);
  check('deck-cards cascade cleanly on deck delete', (cardsGone ?? []).length === 0);

  await Promise.all([A.sb.auth.signOut(), B.sb.auth.signOut()]);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n── ${results.length - failed.length}/${results.length} passed ──`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.label} ${f.detail ?? ''}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });

#!/usr/bin/env node
// Slice G — security probe for public + unlisted deck sharing.
//
// Proves the full access matrix without touching the app:
//
//   1. anon cannot read private deck
//   2. B cannot read A's private deck
//   3. B cannot modify A's public deck
//   4. anon cannot modify anything
//   5. anon CAN read a public deck
//   6. correct token can read an unlisted deck (via RPC)
//   7. wrong token cannot read an unlisted deck
//   8. unlisted decks CANNOT be enumerated through normal
//      anonymous table reads
//   9. revoked token stops working
//  10. public -> private makes the public route inaccessible
//
//  Also verifies Slice F guarantees still hold (owner-only writes).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY'); process.exit(1); }

// ── mail.tm helpers (rotated, backed-off) ───────────────

interface MailBox { address: string; password: string; token: string; }

async function createMailbox(): Promise<MailBox> {
  const domains = await fetch('https://api.mail.tm/domains').then((r) => r.json());
  const list: string[] = (domains['hydra:member'] ?? []).map((d: { domain: string }) => d.domain);
  for (let attempt = 0; attempt < 20; attempt++) {
    const domain = list[attempt % list.length]!;
    const address = `ygo${Math.random().toString(36).slice(2, 9)}@${domain}`;
    const password = `Sh-${Math.random().toString(36).slice(2)}-${Date.now()}`;
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
    if (c.status === 422) continue;
    if (![429, 500, 502, 503].includes(c.status)) {
      throw new Error(`mailbox: ${c.status} ${await c.text()}`);
    }
    await new Promise((r) => setTimeout(r, 5_000 + attempt * 5_000));
  }
  throw new Error('mailbox: giving up');
}

async function waitLink(box: MailBox, timeoutMs = 90_000): Promise<string> {
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

// Anon-only client (no session).
const anon = createClient(URL, KEY, { auth: { persistSession: false } });

const results: { label: string; pass: boolean; detail?: string }[] = [];
function check(label: string, pass: boolean, detail?: string) {
  results.push({ label, pass, detail });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('── Slice G security probe · public + unlisted decks ──\n');
  console.log('provisioning two users (serial to avoid mail.tm 429)…');
  const A = await bootUser();
  await new Promise((r) => setTimeout(r, 3_000));
  const B = await bootUser();
  console.log(`  A.id ${A.userId}\n  B.id ${B.userId}\n`);

  // ── A creates a private deck and adds a card ─────────
  const { data: deckA, error: dAErr } = await A.sb
    .from('ygo_decks')
    .insert({ user_id: A.userId, name: 'Alpha Private' })
    .select('*').single();
  if (dAErr || !deckA) throw new Error(`A insert failed: ${dAErr?.message}`);
  await A.sb.from('ygo_deck_cards').insert({
    deck_id: deckA.id,
    card_key: 'ash blossom & joyous spring',
    card_name: 'Ash Blossom & Joyous Spring',
    section: 'main',
    quantity: 3,
  });

  console.log('1) anon cannot SELECT private deck');
  const { data: anonPrivate } = await anon
    .from('ygo_decks').select('*').eq('id', deckA.id);
  check('anon SELECT of private deck returns 0 rows',
    (anonPrivate ?? []).length === 0, `rows: ${(anonPrivate ?? []).length}`);

  console.log('\n2) B cannot SELECT A\'s private deck');
  const { data: bPrivate } = await B.sb
    .from('ygo_decks').select('*').eq('id', deckA.id);
  check("B SELECT of A's private deck returns 0 rows",
    (bPrivate ?? []).length === 0, `rows: ${(bPrivate ?? []).length}`);

  // ── A publishes as unlisted ──────────────────────────
  console.log('\n(publishing A as unlisted)');
  const token1 = Array.from({ length: 32 }, () =>
    'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(Math.random() * 32)],
  ).join('');
  await A.sb.from('ygo_decks')
    .update({ visibility: 'unlisted', share_token: token1 })
    .eq('id', deckA.id);

  console.log('\n6) correct token can read unlisted deck via RPC');
  const { data: okDeck, error: okErr } = await anon.rpc('get_shared_deck_by_token', { p_token: token1 });
  check('anon RPC with correct token returns 1 row',
    !okErr && (okDeck as unknown[] | null)?.length === 1,
    okErr ? `err ${okErr.code}` : `rows: ${(okDeck as unknown[] | null)?.length}`);
  const { data: okCards } = await anon.rpc('get_shared_deck_cards_by_token', { p_token: token1 });
  check('anon RPC with correct token returns cards',
    (okCards as unknown[] | null)?.length === 1,
    `rows: ${(okCards as unknown[] | null)?.length}`);
  // Confirm the RPC does NOT expose user_id or share_token in its
  // returned columns.
  if ((okDeck as Record<string, unknown>[] | null)?.[0]) {
    const cols = Object.keys((okDeck as Record<string, unknown>[])[0]!);
    check('RPC does not expose user_id',
      !cols.includes('user_id'), `columns: ${cols.join(',')}`);
    check('RPC does not expose share_token',
      !cols.includes('share_token'), `columns: ${cols.join(',')}`);
  }

  console.log('\n7) wrong token returns nothing');
  const bogus = 'a'.repeat(32);
  const { data: wrongDeck } = await anon.rpc('get_shared_deck_by_token', { p_token: bogus });
  check('anon RPC with wrong token returns 0 rows',
    (wrongDeck as unknown[] | null)?.length === 0, `rows: ${(wrongDeck as unknown[] | null)?.length}`);

  console.log('\n(short-token guard)');
  const { data: shortRes } = await anon.rpc('get_shared_deck_by_token', { p_token: 'abc' });
  check('anon RPC with short token returns 0 rows (24-char floor)',
    (shortRes as unknown[] | null)?.length === 0);
  const { data: nullRes } = await anon.rpc('get_shared_deck_by_token', { p_token: null });
  check('anon RPC with null token returns 0 rows',
    (nullRes as unknown[] | null)?.length === 0);

  console.log('\n8) anon cannot enumerate unlisted decks via table SELECT');
  const { data: enumUnlisted } = await anon
    .from('ygo_decks').select('*').eq('visibility', 'unlisted');
  check('anon SELECT ...WHERE visibility=unlisted returns 0 rows',
    (enumUnlisted ?? []).length === 0, `rows: ${(enumUnlisted ?? []).length}`);
  // Also make sure the unlisted deck's cards aren't leaked by
  // enumeration.
  const { data: enumCards } = await anon
    .from('ygo_deck_cards').select('*').eq('deck_id', deckA.id);
  check("anon SELECT of unlisted deck cards returns 0 rows",
    (enumCards ?? []).length === 0, `rows: ${(enumCards ?? []).length}`);

  console.log('\n9) revoked (regenerated) token stops working');
  const token2 = Array.from({ length: 32 }, () =>
    'abcdefghijklmnopqrstuvwxyz234567'[Math.floor(Math.random() * 32)],
  ).join('');
  await A.sb.from('ygo_decks')
    .update({ share_token: token2 }).eq('id', deckA.id);
  const { data: oldTokenRes } = await anon.rpc('get_shared_deck_by_token', { p_token: token1 });
  check('old token no longer returns rows',
    (oldTokenRes as unknown[] | null)?.length === 0, `rows: ${(oldTokenRes as unknown[] | null)?.length}`);
  const { data: newTokenRes } = await anon.rpc('get_shared_deck_by_token', { p_token: token2 });
  check('new token returns the deck',
    (newTokenRes as unknown[] | null)?.length === 1);

  // ── A publishes as public ────────────────────────────
  console.log('\n(publishing A as public)');
  await A.sb.from('ygo_decks')
    .update({ visibility: 'public', public_slug: 'alpha-private-testabcd' })
    .eq('id', deckA.id);

  console.log('\n5) anon can SELECT a public deck');
  const { data: anonPublic } = await anon
    .from('ygo_decks').select('id, name, visibility, public_slug').eq('id', deckA.id);
  check('anon SELECT of public deck returns 1 row',
    (anonPublic ?? []).length === 1);
  const { data: anonPublicCards } = await anon
    .from('ygo_deck_cards').select('*').eq('deck_id', deckA.id);
  check('anon SELECT of public deck cards returns 1 row',
    (anonPublicCards ?? []).length === 1);

  console.log('\n3) B cannot UPDATE / DELETE A\'s public deck');
  const { data: bUpd } = await B.sb
    .from('ygo_decks').update({ name: 'pwned' }).eq('id', deckA.id).select('*');
  check("B UPDATE of A's public deck returns 0 affected",
    (bUpd ?? []).length === 0, `affected: ${(bUpd ?? []).length}`);
  const { data: bDel } = await B.sb
    .from('ygo_decks').delete().eq('id', deckA.id).select('*');
  check("B DELETE of A's public deck returns 0 affected",
    (bDel ?? []).length === 0);
  const { data: bIns } = await B.sb
    .from('ygo_deck_cards').insert({
      deck_id: deckA.id,
      card_key: 'monster reborn',
      card_name: 'Monster Reborn',
      section: 'main',
      quantity: 1,
    }).select('*');
  check("B INSERT into A's public deck rejected",
    (bIns ?? []).length === 0);

  console.log('\n4) anon cannot mutate anything');
  const { data: anonUpd } = await anon
    .from('ygo_decks').update({ name: 'anon-pwn' }).eq('id', deckA.id).select('*');
  check('anon UPDATE returns 0 affected', (anonUpd ?? []).length === 0);
  const { data: anonDel } = await anon
    .from('ygo_decks').delete().eq('id', deckA.id).select('*');
  check('anon DELETE returns 0 affected', (anonDel ?? []).length === 0);
  const { data: anonInsDeck } = await anon
    .from('ygo_decks').insert({ user_id: A.userId, name: 'anon spoof' }).select('*');
  check('anon INSERT into ygo_decks rejected',
    (anonInsDeck ?? []).length === 0);
  const { data: anonInsCards } = await anon
    .from('ygo_deck_cards').insert({
      deck_id: deckA.id,
      card_key: 'x', card_name: 'X', section: 'main', quantity: 1,
    }).select('*');
  check('anon INSERT into ygo_deck_cards rejected',
    (anonInsCards ?? []).length === 0);

  console.log('\n10) public -> private makes the public route inaccessible');
  await A.sb.from('ygo_decks')
    .update({ visibility: 'private' }).eq('id', deckA.id);
  const { data: anonAfterUnpublish } = await anon
    .from('ygo_decks').select('*').eq('id', deckA.id);
  check('anon SELECT of the now-private deck returns 0 rows',
    (anonAfterUnpublish ?? []).length === 0);
  const { data: cardsAfterUnpublish } = await anon
    .from('ygo_deck_cards').select('*').eq('deck_id', deckA.id);
  check("anon SELECT of the now-private deck's cards returns 0 rows",
    (cardsAfterUnpublish ?? []).length === 0);

  // Cleanup + summary
  await A.sb.from('ygo_decks').delete().eq('id', deckA.id);
  await Promise.all([A.sb.auth.signOut(), B.sb.auth.signOut()]);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n── ${results.length - failed.length}/${results.length} passed ──`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });

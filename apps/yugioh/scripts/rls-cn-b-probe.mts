#!/usr/bin/env node
// Slice CN-B - integrity pen test for the immutable signup
// snapshot + tri-state marketing consent model.
//
// Proves against live preflightluke Supabase:
//
//   • Signup snapshot captured by AFTER INSERT trigger.
//   • updateUser() after signup does NOT change origin or
//     signup consent (attack outlined in CN-A/CN-B hardening).
//   • Ordinary user cannot INSERT/UPDATE/DELETE
//     collector_signup_context.
//   • record_origin_from_signup() reads from snapshot only.
//   • apply_signup_marketing_consent() is replay-safe.
//   • Ordinary consent RPCs reject signup/admin/migration/
//     brevo_webhook sources.
//   • Tri-state A: neither checkbox → zero preference rows.
//   • Tri-state B: site only → 1 site row, 0 network row.
//   • Tri-state C: network only → 0 site, 1 network.
//   • Tri-state D: both → 2 rows.
//   • Tri-state E: after (B), Settings opt-out flips site row
//     to opted_out with new event.
//   • Legacy user (no metadata) → snapshot has null origin +
//     nulls for both intents; RPCs no-op.
//   • Active-site enforcement: record_site_authentication with
//     an inactive code raises.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY');
  process.exit(1);
}

interface MailBox { address: string; password: string; token: string; }

async function createMailbox(): Promise<MailBox> {
  const domains = await fetch('https://api.mail.tm/domains').then((r) => r.json());
  const list: string[] = (domains['hydra:member'] ?? []).map((d: { domain: string }) => d.domain);
  for (let attempt = 0; attempt < 20; attempt++) {
    const domain = list[attempt % list.length]!;
    const address = `cnb${Math.random().toString(36).slice(2, 9)}@${domain}`;
    const password = `Cn-${Math.random().toString(36).slice(2)}-${Date.now()}`;
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
    if (![429, 500, 502, 503].includes(c.status)) throw new Error(`mailbox: ${c.status}`);
    await new Promise((r) => setTimeout(r, 5_000 + attempt * 5_000));
  }
  throw new Error('mailbox: giving up');
}

async function waitLink(box: MailBox, timeoutMs = 120_000): Promise<string> {
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

// Boot a user with a specific signup metadata payload. Passing an
// empty object represents a legacy signup that did not carry
// CN-B metadata at all.
async function bootUser(
  signupData: Record<string, unknown>,
): Promise<{ sb: SupabaseClient; userId: string; email: string; password: string }> {
  const box = await createMailbox();
  const sb = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signUp({
    email: box.address,
    password: box.password,
    options: {
      emailRedirectTo: 'https://ygoprices.io/auth/callback',
      data: Object.keys(signupData).length ? signupData : undefined,
    },
  });
  const link = await waitLink(box);
  const parsed = new globalThis.URL(link);
  const token = parsed.searchParams.get('token') ?? parsed.searchParams.get('code');
  const type = (parsed.searchParams.get('type') ?? 'signup') as
    | 'signup' | 'email' | 'recovery' | 'invite';
  if (token) await sb.auth.verifyOtp({ type, token_hash: token });
  await sb.auth.signInWithPassword({ email: box.address, password: box.password });
  const { data } = await sb.auth.getUser();
  return { sb, userId: data.user!.id, email: box.address, password: box.password };
}

const results: { label: string; pass: boolean; detail?: string }[] = [];
function check(label: string, pass: boolean, detail?: string) {
  results.push({ label, pass, detail });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('── CN-B RLS + integrity probe · immutable snapshot + tri-state ──\n');
  console.log('provisioning users serially to respect mail.tm rate limits…');

  // ── The critical attack scenario ────────────────────
  console.log('\nAttack: signup as ygo with site=true; then updateUser to mtg/false/true');
  const A = await bootUser({
    collector_origin_site: 'ygo',
    collector_site_marketing_opt_in: true,
    collector_network_marketing_opt_in: false,
  });
  console.log(`  A.id ${A.userId}`);
  // Immediately after auth, snapshot is written by the trigger.
  const snapA0 = await A.sb.from('collector_signup_context').select('*').maybeSingle();
  check('snapshot captured for A after signup',
    !!snapA0.data,
    snapA0.data ? `origin=${snapA0.data.origin_site_code} site=${snapA0.data.site_marketing_intent} net=${snapA0.data.network_marketing_intent}` : 'no row');
  check('snapshot origin = ygo',
    (snapA0.data as { origin_site_code: string })?.origin_site_code === 'ygo');
  check('snapshot site_marketing_intent = true',
    (snapA0.data as { site_marketing_intent: boolean })?.site_marketing_intent === true);
  check('snapshot network_marketing_intent = false',
    (snapA0.data as { network_marketing_intent: boolean })?.network_marketing_intent === false);
  check('snapshot has consent_text_version',
    typeof (snapA0.data as { consent_text_version: string })?.consent_text_version === 'string');

  // Attempt the attack.
  await new Promise((r) => setTimeout(r, 500));
  const { error: updErr } = await A.sb.auth.updateUser({
    data: {
      collector_origin_site: 'mtg',
      collector_site_marketing_opt_in: false,
      collector_network_marketing_opt_in: true,
    },
  });
  check('updateUser call itself succeeds', !updErr, updErr?.message);
  // Verify snapshot did NOT change.
  const snapA1 = await A.sb.from('collector_signup_context').select('*').single();
  check('snapshot ORIGIN unchanged after updateUser',
    (snapA1.data as { origin_site_code: string }).origin_site_code === 'ygo');
  check('snapshot SITE intent unchanged after updateUser',
    (snapA1.data as { site_marketing_intent: boolean }).site_marketing_intent === true);
  check('snapshot NETWORK intent unchanged after updateUser',
    (snapA1.data as { network_marketing_intent: boolean }).network_marketing_intent === false);

  // Fire origin + consent RPCs. They read from snapshot, so
  // origin becomes ygo (not mtg) and site=true / net=false is
  // applied (not the tampered values).
  const { error: oErr } = await A.sb.rpc('record_origin_from_signup');
  check('record_origin_from_signup succeeds', !oErr, oErr?.message);
  const { error: cErr } = await A.sb.rpc('apply_signup_marketing_consent');
  check('apply_signup_marketing_consent succeeds', !cErr, cErr?.message);
  const { data: mems } = await A.sb.from('collector_user_sites').select('*');
  const origin = (mems ?? []).find((m: { originated_here: boolean }) => m.originated_here);
  check('origin row is ygo (attack fails)',
    (origin as { site_code: string })?.site_code === 'ygo',
    (origin as { site_code: string })?.site_code);
  const { data: prefs } = await A.sb.from('collector_marketing_preferences').select('*');
  const sitePref = (prefs ?? []).find((p: { scope: string; site_code: string }) => p.scope === 'site');
  const netPref = (prefs ?? []).find((p: { scope: string }) => p.scope === 'network');
  check('site preference recorded from SNAPSHOT (opt-in=true)',
    sitePref && (sitePref as { site_code: string; email_opt_in: boolean }).site_code === 'ygo'
      && (sitePref as { email_opt_in: boolean }).email_opt_in === true);
  check('network preference recorded from SNAPSHOT (opt-in=false)',
    netPref && (netPref as { email_opt_in: boolean }).email_opt_in === false);
  check('site preference source = signup',
    sitePref && (sitePref as { consent_source: string }).consent_source === 'signup');
  check('network preference source = signup',
    netPref && (netPref as { consent_source: string }).consent_source === 'signup');

  // Replay-safe.
  const { error: replayErr } = await A.sb.rpc('apply_signup_marketing_consent');
  check('re-invoking apply_signup_marketing_consent succeeds', !replayErr);
  const { data: prefs2 } = await A.sb.from('collector_marketing_preferences').select('*');
  check('replay does not create extra rows', (prefs2 ?? []).length === (prefs ?? []).length);
  const { data: eventsAfter } = await A.sb.from('collector_marketing_consent_events').select('*');
  check('replay does not append extra events', (eventsAfter ?? []).length === 2);

  // Cannot INSERT/UPDATE/DELETE snapshot.
  const { data: badIns, error: insErr } = await A.sb.from('collector_signup_context')
    .insert({ user_id: A.userId, origin_site_code: 'mtg', consent_text_version: 'x' })
    .select('*');
  check('user cannot INSERT into collector_signup_context',
    !!insErr || (badIns ?? []).length === 0,
    insErr ? `err ${insErr.code}` : `rows: ${(badIns ?? []).length}`);
  const { data: badUpd } = await A.sb.from('collector_signup_context')
    .update({ origin_site_code: 'mtg' }).eq('user_id', A.userId).select('*');
  check('user cannot UPDATE collector_signup_context',
    (badUpd ?? []).length === 0);
  const { data: badDel } = await A.sb.from('collector_signup_context')
    .delete().eq('user_id', A.userId).select('*');
  check('user cannot DELETE collector_signup_context',
    (badDel ?? []).length === 0);

  // Ordinary RPC rejects signup/admin/migration/brevo_webhook.
  await new Promise((r) => setTimeout(r, 500));
  for (const bad of ['signup', 'admin', 'migration', 'brevo_webhook']) {
    const { error } = await A.sb.rpc('set_site_marketing_preference', {
      p_site_code: 'ygo',
      p_opt_in: true,
      p_source: bad,
    });
    check(`site RPC rejects source='${bad}'`, !!error);
  }

  // Active-site enforcement.
  const { error: inactiveErr } = await A.sb.rpc('record_site_authentication', {
    p_site_code: 'onepiece',
  });
  check("record_site_authentication rejects inactive site 'onepiece'",
    !!inactiveErr, inactiveErr?.message);

  // ── Tri-state A: neither box checked ─────────────────
  console.log('\nTri-state A: signup with NO opt-in keys → zero pref rows');
  await new Promise((r) => setTimeout(r, 3_000));
  const A2 = await bootUser({ collector_origin_site: 'ygo' });
  await A2.sb.rpc('apply_signup_marketing_consent');
  const { data: prefsA2 } = await A2.sb.from('collector_marketing_preferences').select('*');
  const { data: eventsA2 } = await A2.sb.from('collector_marketing_consent_events').select('*');
  check('A (neither): 0 preference rows', (prefsA2 ?? []).length === 0);
  check('A (neither): 0 consent events', (eventsA2 ?? []).length === 0);

  // ── Tri-state B: site only ────────────────────────────
  console.log('\nTri-state B: site checked only');
  await new Promise((r) => setTimeout(r, 3_000));
  const B = await bootUser({
    collector_origin_site: 'ygo',
    collector_site_marketing_opt_in: true,
  });
  await B.sb.rpc('apply_signup_marketing_consent');
  const { data: prefsB } = await B.sb.from('collector_marketing_preferences').select('*');
  check('B (site only): 1 preference row',
    (prefsB ?? []).length === 1, `rows: ${(prefsB ?? []).length}`);
  check('B (site only): row is site scope + opted in',
    (prefsB ?? [])[0] &&
    (prefsB![0] as { scope: string; email_opt_in: boolean }).scope === 'site' &&
    (prefsB![0] as { email_opt_in: boolean }).email_opt_in === true);

  // ── Tri-state E: existing user Settings opt-out ──────
  console.log('\nTri-state E: B does Settings opt-out on site preference');
  const { error: eErr } = await B.sb.rpc('set_site_marketing_preference', {
    p_site_code: 'ygo',
    p_opt_in: false,
    p_source: 'settings',
  });
  check('settings opt-out succeeds', !eErr, eErr?.message);
  const { data: prefsBAfter } = await B.sb.from('collector_marketing_preferences').select('*');
  const siteAfter = (prefsBAfter ?? []).find((p: { scope: string }) => p.scope === 'site');
  check('site preference now opted out',
    siteAfter && (siteAfter as { email_opt_in: boolean }).email_opt_in === false);
  check('site preference source now settings',
    siteAfter && (siteAfter as { consent_source: string }).consent_source === 'settings');
  const { data: eventsBAfter } = await B.sb.from('collector_marketing_consent_events').select('*').order('occurred_at', { ascending: true });
  check('consent history has 2 events (signup opt_in + settings opt_out)',
    (eventsBAfter ?? []).length === 2);
  check('event 1: signup opt_in',
    (eventsBAfter ?? [])[0] &&
    (eventsBAfter![0] as { source: string; action: string }).source === 'signup' &&
    (eventsBAfter![0] as { action: string }).action === 'opt_in');
  check('event 2: settings opt_out',
    (eventsBAfter ?? [])[1] &&
    (eventsBAfter![1] as { source: string; action: string }).source === 'settings' &&
    (eventsBAfter![1] as { action: string }).action === 'opt_out');

  // ── Tri-state C: network only ─────────────────────────
  console.log('\nTri-state C: network checked only');
  await new Promise((r) => setTimeout(r, 3_000));
  const C = await bootUser({
    collector_origin_site: 'ygo',
    collector_network_marketing_opt_in: true,
  });
  await C.sb.rpc('apply_signup_marketing_consent');
  const { data: prefsC } = await C.sb.from('collector_marketing_preferences').select('*');
  check('C (network only): 1 preference row', (prefsC ?? []).length === 1);
  check('C (network only): row is network scope + opted in',
    (prefsC ?? [])[0] &&
    (prefsC![0] as { scope: string; email_opt_in: boolean }).scope === 'network' &&
    (prefsC![0] as { email_opt_in: boolean }).email_opt_in === true);

  // ── Tri-state D: both ─────────────────────────────────
  console.log('\nTri-state D: both checked');
  await new Promise((r) => setTimeout(r, 3_000));
  const D = await bootUser({
    collector_origin_site: 'ygo',
    collector_site_marketing_opt_in: true,
    collector_network_marketing_opt_in: true,
  });
  await D.sb.rpc('apply_signup_marketing_consent');
  const { data: prefsD } = await D.sb.from('collector_marketing_preferences').select('*');
  check('D (both): 2 preference rows',
    (prefsD ?? []).length === 2, `rows: ${(prefsD ?? []).length}`);
  const sD = (prefsD ?? []).find((p: { scope: string }) => p.scope === 'site');
  const nD = (prefsD ?? []).find((p: { scope: string }) => p.scope === 'network');
  check('D: site + network both opted in',
    sD && (sD as { email_opt_in: boolean }).email_opt_in === true &&
    nD && (nD as { email_opt_in: boolean }).email_opt_in === true);

  // ── Legacy user (no metadata) ────────────────────────
  console.log('\nLegacy user: signup with NO metadata → snapshot has null origin + null intents');
  await new Promise((r) => setTimeout(r, 3_000));
  const L = await bootUser({});
  const snapL = await L.sb.from('collector_signup_context').select('*').maybeSingle();
  check('legacy snapshot exists',
    !!snapL.data,
    snapL.data ? `origin=${snapL.data.origin_site_code} site=${snapL.data.site_marketing_intent} net=${snapL.data.network_marketing_intent}` : 'no row');
  check('legacy snapshot origin is null',
    (snapL.data as { origin_site_code: string | null })?.origin_site_code === null);
  check('legacy snapshot site_intent is null',
    (snapL.data as { site_marketing_intent: boolean | null })?.site_marketing_intent === null);
  check('legacy snapshot network_intent is null',
    (snapL.data as { network_marketing_intent: boolean | null })?.network_marketing_intent === null);
  await L.sb.rpc('record_origin_from_signup');
  await L.sb.rpc('apply_signup_marketing_consent');
  const { data: memsL } = await L.sb.from('collector_user_sites').select('*');
  check('legacy user: no origin row created',
    !(memsL ?? []).some((m: { originated_here: boolean }) => m.originated_here));
  const { data: prefsL } = await L.sb.from('collector_marketing_preferences').select('*');
  check('legacy user: no preference rows created', (prefsL ?? []).length === 0);

  await Promise.all([A.sb.auth.signOut(), A2.sb.auth.signOut(), B.sb.auth.signOut(), C.sb.auth.signOut(), D.sb.auth.signOut(), L.sb.auth.signOut()]);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n── ${results.length - failed.length}/${results.length} passed ──`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });

#!/usr/bin/env node
// Slice CN-A - two-user RLS + integrity penetration test for the
// shared customer/membership/consent layer.
//
// Proves against live preflightluke Supabase:
//
//   • A can read own membership / preferences / consent events.
//   • B cannot read A's membership / preferences / consent events.
//   • Direct INSERT / UPDATE / DELETE on the three user-scoped
//     tables is blocked from an authenticated session (no
//     mutation policies exist; all writes go through RPCs).
//   • B cannot spoof A via any table write.
//   • Origin is immutable once assigned.
//   • Unknown / missing origin metadata safely leaves origin
//     null (record_origin_from_signup no-ops).
//   • Browser RPC rejects source='admin'.
//   • Browser RPC rejects source='migration'.
//   • Browser RPC rejects source='brevo_webhook'.
//   • Blank consent_text_version is rejected.
//   • Site and network consent remain independent.

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
    const address = `ygo${Math.random().toString(36).slice(2, 9)}@${domain}`;
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

// Boot a user with signup metadata carrying collector_origin_site.
// Pass `null` for the metadata value to represent a "legacy" user
// signing up without the CN-A key (used to prove origin stays null).
async function bootUser(originSite: 'ygo' | null): Promise<{ sb: SupabaseClient; userId: string }> {
  const box = await createMailbox();
  const sb = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const data: Record<string, string> = {};
  if (originSite) data['collector_origin_site'] = originSite;
  await sb.auth.signUp({
    email: box.address,
    password: box.password,
    options: {
      emailRedirectTo: 'https://ygoprices.io/auth/callback',
      data: Object.keys(data).length ? data : undefined,
    },
  });
  const link = await waitLink(box);
  const parsed = new globalThis.URL(link);
  const token = parsed.searchParams.get('token') ?? parsed.searchParams.get('code');
  const type = (parsed.searchParams.get('type') ?? 'signup') as
    | 'signup' | 'email' | 'recovery' | 'invite';
  if (token) await sb.auth.verifyOtp({ type, token_hash: token });
  await sb.auth.signInWithPassword({ email: box.address, password: box.password });
  const { data: userData } = await sb.auth.getUser();
  return { sb, userId: userData.user!.id };
}

const results: { label: string; pass: boolean; detail?: string }[] = [];
function check(label: string, pass: boolean, detail?: string) {
  results.push({ label, pass, detail });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('── CN-A RLS + integrity probe · shared customer layer ──\n');
  console.log('provisioning three users (serial, mail.tm rate-limit)…');
  const A = await bootUser('ygo');
  await new Promise((r) => setTimeout(r, 3_000));
  const B = await bootUser('ygo');
  await new Promise((r) => setTimeout(r, 3_000));
  const L = await bootUser(null); // "legacy" - no signup metadata
  console.log(`  A.id ${A.userId} (origin metadata = ygo)`);
  console.log(`  B.id ${B.userId} (origin metadata = ygo)`);
  console.log(`  L.id ${L.userId} (no origin metadata)\n`);

  // ── A + B fire the CN-A RPCs the way the auth callback would ──
  console.log('Step 0 — simulate the YGO auth-callback RPC calls');
  {
    const { error: aOrigin } = await A.sb.rpc('record_origin_from_signup');
    check('A record_origin_from_signup succeeds', !aOrigin, aOrigin?.message);
    const { error: aAuth } = await A.sb.rpc('record_site_authentication', { p_site_code: 'ygo' });
    check('A record_site_authentication succeeds', !aAuth, aAuth?.message);

    const { error: bOrigin } = await B.sb.rpc('record_origin_from_signup');
    check('B record_origin_from_signup succeeds', !bOrigin, bOrigin?.message);
    const { error: bAuth } = await B.sb.rpc('record_site_authentication', { p_site_code: 'ygo' });
    check('B record_site_authentication succeeds', !bAuth, bAuth?.message);

    const { error: lOrigin } = await L.sb.rpc('record_origin_from_signup');
    check('L record_origin_from_signup no-ops (no metadata)', !lOrigin, lOrigin?.message);
    const { error: lAuth } = await L.sb.rpc('record_site_authentication', { p_site_code: 'ygo' });
    check('L record_site_authentication succeeds', !lAuth, lAuth?.message);
  }

  // ── Owner reads ──────────────────────────────────────
  console.log('\nStep 1 — A reads own membership + preferences + events');
  {
    const mems = await A.sb.from('collector_user_sites').select('*');
    check('A sees own membership row (ygo)',
      (mems.data ?? []).some((m: { site_code: string }) => m.site_code === 'ygo'),
      `rows: ${(mems.data ?? []).length}`);
    check('A membership has originated_here=true (metadata was ygo)',
      (mems.data ?? []).some((m: { site_code: string; originated_here: boolean }) => m.site_code === 'ygo' && m.originated_here));

    const prefs = await A.sb.from('collector_marketing_preferences').select('*');
    check('A preferences initially empty (no consent yet)', (prefs.data ?? []).length === 0);
    const events = await A.sb.from('collector_marketing_consent_events').select('*');
    check('A consent events initially empty', (events.data ?? []).length === 0);
  }

  console.log('\nStep 1b — L (legacy signup) origin remains null');
  {
    const mems = await L.sb.from('collector_user_sites').select('*');
    const ygoRow = (mems.data ?? []).find((m: { site_code: string }) => m.site_code === 'ygo');
    check('L has ygo membership (from record_site_authentication)', !!ygoRow);
    check("L's ygo membership has originated_here=false (no signup metadata)",
      ygoRow ? (ygoRow as { originated_here: boolean }).originated_here === false : false);
    const anyOrigin = (mems.data ?? []).some((m: { originated_here: boolean }) => m.originated_here);
    check("L has NO origin row anywhere (metadata missing)", !anyOrigin);
  }

  // ── B cannot read A's data ────────────────────────────
  console.log("\nStep 2 — B cannot SELECT any of A's rows");
  {
    const mems = await B.sb.from('collector_user_sites').select('*').eq('user_id', A.userId);
    check("B SELECT of A's memberships returns 0", (mems.data ?? []).length === 0, `rows: ${(mems.data ?? []).length}`);
    const prefs = await B.sb.from('collector_marketing_preferences').select('*').eq('user_id', A.userId);
    check("B SELECT of A's preferences returns 0", (prefs.data ?? []).length === 0);
    const events = await B.sb.from('collector_marketing_consent_events').select('*').eq('user_id', A.userId);
    check("B SELECT of A's consent events returns 0", (events.data ?? []).length === 0);
  }

  // ── Direct table mutation blocked ────────────────────
  console.log('\nStep 3 — direct table mutation blocked (no INSERT/UPDATE/DELETE policies)');
  {
    // A tries to INSERT own membership row directly.
    const { data: ownIns, error: ownInsErr } = await A.sb
      .from('collector_user_sites')
      .insert({ user_id: A.userId, site_code: 'mtg', originated_here: false })
      .select('*');
    check('direct INSERT into collector_user_sites blocked',
      !!ownInsErr || (ownIns ?? []).length === 0,
      ownInsErr ? `err ${ownInsErr.code}` : `rows: ${(ownIns ?? []).length}`);

    // A tries to UPDATE own membership.
    const { data: ownUpd, error: ownUpdErr } = await A.sb
      .from('collector_user_sites')
      .update({ originated_here: false })
      .eq('user_id', A.userId)
      .select('*');
    check('direct UPDATE of collector_user_sites blocked',
      !!ownUpdErr || (ownUpd ?? []).length === 0,
      ownUpdErr ? `err ${ownUpdErr.code}` : `rows: ${(ownUpd ?? []).length}`);

    // A tries to DELETE own membership.
    const { data: ownDel, error: ownDelErr } = await A.sb
      .from('collector_user_sites')
      .delete()
      .eq('user_id', A.userId)
      .select('*');
    check('direct DELETE of collector_user_sites blocked',
      !!ownDelErr || (ownDel ?? []).length === 0,
      ownDelErr ? `err ${ownDelErr.code}` : `rows: ${(ownDel ?? []).length}`);

    // A tries to INSERT a marketing preference directly.
    const { data: prefIns, error: prefInsErr } = await A.sb
      .from('collector_marketing_preferences')
      .insert({
        user_id: A.userId,
        scope: 'site',
        site_code: 'ygo',
        email_opt_in: true,
        consent_source: 'signup',
      })
      .select('*');
    check('direct INSERT into collector_marketing_preferences blocked',
      !!prefInsErr || (prefIns ?? []).length === 0);

    // A tries to INSERT a consent event directly.
    const { data: evtIns, error: evtInsErr } = await A.sb
      .from('collector_marketing_consent_events')
      .insert({
        user_id: A.userId,
        scope: 'site',
        site_code: 'ygo',
        action: 'opt_in',
        source: 'signup',
      })
      .select('*');
    check('direct INSERT into collector_marketing_consent_events blocked',
      !!evtInsErr || (evtIns ?? []).length === 0);
  }

  // ── B cannot spoof A via table INSERT with A's user_id ─
  console.log("\nStep 4 — B cannot spoof A via direct table INSERT");
  {
    const { data: sp, error: spErr } = await B.sb
      .from('collector_user_sites')
      .insert({ user_id: A.userId, site_code: 'mtg', originated_here: false })
      .select('*');
    check("B cannot INSERT membership with A's user_id",
      !!spErr || (sp ?? []).length === 0,
      spErr ? `err ${spErr.code}` : `rows: ${(sp ?? []).length}`);
    const { data: sp2, error: sp2Err } = await B.sb
      .from('collector_marketing_preferences')
      .insert({
        user_id: A.userId,
        scope: 'network',
        site_code: null,
        email_opt_in: true,
        consent_source: 'signup',
      })
      .select('*');
    check("B cannot INSERT preference with A's user_id",
      !!sp2Err || (sp2 ?? []).length === 0);
  }

  // ── Origin immutability ──────────────────────────────
  console.log('\nStep 5 — origin is immutable once assigned');
  {
    // A re-fires record_origin_from_signup. Should no-op silently.
    const { error: reOrigin } = await A.sb.rpc('record_origin_from_signup');
    check('A re-invoking record_origin_from_signup succeeds (idempotent)', !reOrigin);
    const mems = await A.sb.from('collector_user_sites').select('*');
    const originRows = (mems.data ?? []).filter((m: { originated_here: boolean }) => m.originated_here);
    check("A still has exactly one origin row after re-fire", originRows.length === 1);
    check("that origin row is still site_code='ygo'",
      originRows.length === 1 && (originRows[0] as { site_code: string }).site_code === 'ygo');
  }

  // ── RPC boundary: reject admin/migration/brevo_webhook ─
  console.log('\nStep 6 — user-facing consent RPC rejects trusted-only sources');
  // CN-B tightened: 'signup' is also rejected because signup consent
  // now flows through the dedicated apply_signup_marketing_consent
  // RPC. 'admin' / 'migration' / 'brevo_webhook' remain valid at the
  // table CHECK for future trusted callers but are rejected here.
  for (const bad of ['signup', 'admin', 'migration', 'brevo_webhook']) {
    const { error } = await A.sb.rpc('set_site_marketing_preference', {
      p_site_code: 'ygo',
      p_opt_in: true,
      p_source: bad,
    });
    check(`source='${bad}' rejected on site preference`, !!error, error?.message ?? '(no error)');
    const { error: ne } = await A.sb.rpc('set_network_marketing_preference', {
      p_opt_in: true,
      p_source: bad,
    });
    check(`source='${bad}' rejected on network preference`, !!ne, ne?.message ?? '(no error)');
  }

  // Step 7 (blank text_version) removed - CN-B RPCs no longer
  // accept a caller-supplied consent version. The version is
  // sourced from collector_consent_versions inside the RPC.

  // ── Site and network consent independent ─────────────
  console.log('\nStep 8 — site and network consent stay independent');
  {
    // A opts in to YGO site preference only.
    const { error: siteOpt } = await A.sb.rpc('set_site_marketing_preference', {
      p_site_code: 'ygo',
      p_opt_in: true,
      p_source: 'settings',
    });
    check('A site opt-in succeeds', !siteOpt, siteOpt?.message);

    const { data: prefs1 } = await A.sb.from('collector_marketing_preferences').select('*');
    const netRow1 = (prefs1 ?? []).find((p: { scope: string }) => p.scope === 'network');
    const siteRow1 = (prefs1 ?? []).find((p: { scope: string; site_code: string }) => p.scope === 'site' && p.site_code === 'ygo');
    check('site preference row present', !!siteRow1);
    check('network preference row NOT created by site opt-in', !netRow1);
    check("site row email_opt_in=true", siteRow1 && (siteRow1 as { email_opt_in: boolean }).email_opt_in === true);

    // A opts in to network. Now BOTH rows should exist.
    const { error: netOpt } = await A.sb.rpc('set_network_marketing_preference', {
      p_opt_in: true,
      p_source: 'settings',
    });
    check('A network opt-in succeeds', !netOpt, netOpt?.message);

    const { data: prefs2 } = await A.sb.from('collector_marketing_preferences').select('*');
    const netRow2 = (prefs2 ?? []).find((p: { scope: string }) => p.scope === 'network');
    const siteRow2 = (prefs2 ?? []).find((p: { scope: string; site_code: string }) => p.scope === 'site' && p.site_code === 'ygo');
    check('after network opt-in both site + network rows exist', !!netRow2 && !!siteRow2);
    check('site preference still opted in (unchanged by network op)',
      siteRow2 && (siteRow2 as { email_opt_in: boolean }).email_opt_in === true);

    // A opts OUT of site while staying opted in to network. Rows independent.
    const { error: siteOut } = await A.sb.rpc('set_site_marketing_preference', {
      p_site_code: 'ygo',
      p_opt_in: false,
      p_source: 'preference_center',
    });
    check('A site opt-out succeeds', !siteOut, siteOut?.message);

    const { data: prefs3 } = await A.sb.from('collector_marketing_preferences').select('*');
    const netRow3 = (prefs3 ?? []).find((p: { scope: string }) => p.scope === 'network');
    const siteRow3 = (prefs3 ?? []).find((p: { scope: string; site_code: string }) => p.scope === 'site' && p.site_code === 'ygo');
    check('site preference now opted out', siteRow3 && (siteRow3 as { email_opt_in: boolean }).email_opt_in === false);
    check('network preference untouched by site opt-out',
      netRow3 && (netRow3 as { email_opt_in: boolean }).email_opt_in === true);

    // Consent history should carry all three events (site_in, net_in, site_out).
    const { data: events } = await A.sb.from('collector_marketing_consent_events').select('*').order('occurred_at', { ascending: true });
    check('consent history has 3 events', (events ?? []).length === 3, `count: ${(events ?? []).length}`);
    check('event 1: site opt_in',
      (events ?? [])[0] && (events![0] as { scope: string; action: string }).scope === 'site' && (events![0] as { action: string }).action === 'opt_in');
    check('event 2: network opt_in',
      (events ?? [])[1] && (events![1] as { scope: string; action: string }).scope === 'network' && (events![1] as { action: string }).action === 'opt_in');
    check('event 3: site opt_out',
      (events ?? [])[2] && (events![2] as { scope: string; action: string }).scope === 'site' && (events![2] as { action: string }).action === 'opt_out');
  }

  // ── B still cannot see A's preferences/events after A opted in ─
  console.log("\nStep 9 — B still cannot see A's preferences/events after A opted in");
  {
    const prefs = await B.sb.from('collector_marketing_preferences').select('*').eq('user_id', A.userId);
    check("B SELECT of A's preferences returns 0 rows",
      (prefs.data ?? []).length === 0);
    const events = await B.sb.from('collector_marketing_consent_events').select('*').eq('user_id', A.userId);
    check("B SELECT of A's consent events returns 0 rows",
      (events.data ?? []).length === 0);
  }

  await Promise.all([A.sb.auth.signOut(), B.sb.auth.signOut(), L.sb.auth.signOut()]);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n── ${results.length - failed.length}/${results.length} passed ──`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });

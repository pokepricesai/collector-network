import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResponse, handleHookRequest, planSends } from './handle-request.ts';
import type { FetchLike } from './resend-transport.ts';
import type { HookPayload, RuntimeEnv } from './types.ts';

// A test-only integration harness: signs a payload with a known
// secret, feeds it into handleHookRequest, and captures every
// mock-Resend call for assertion. Never sends real email.

const RAW_SECRET_BYTES = new Uint8Array([
  9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
]);
const SECRET_STRING = (() => {
  let bin = '';
  for (let i = 0; i < RAW_SECRET_BYTES.length; i++) bin += String.fromCharCode(RAW_SECRET_BYTES[i]!);
  return `v1,whsec_${btoa(bin)}`;
})();
const NOW = 1_700_000_000;

async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    RAW_SECRET_BYTES,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  let bin = '';
  const arr = new Uint8Array(sig);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]!);
  return 'v1,' + btoa(bin);
}

const ENV: RuntimeEnv = {
  RESEND_API_KEY: 're_secret_not_real_XXXXXX',
  AUTH_EMAIL_FROM_ADDRESS: 'accounts@send.collector.network',
  SEND_EMAIL_HOOK_SECRET: SECRET_STRING,
};

interface MockCall {
  url: string;
  headers: Record<string, string>;
  parsed: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
    tags: Array<{ name: string; value: string }>;
  };
}

function makeMockFetch(
  responder: (call: MockCall) => { status: number } = () => ({ status: 200 }),
): { fetch: FetchLike; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const parsed = JSON.parse(String(init.body));
    const headers = init.headers as Record<string, string>;
    const c: MockCall = { url, headers, parsed };
    calls.push(c);
    const { status } = responder(c);
    return new Response('{}', { status });
  };
  return { fetch, calls };
}

async function signedPost(body: string): Promise<{
  rawBody: string;
  headers: { id: string; timestamp: string; signature: string };
}> {
  const id = `evt_${Math.random().toString(36).slice(2, 10)}`;
  const timestamp = String(NOW);
  const signature = await sign(id, timestamp, body);
  return { rawBody: body, headers: { id, timestamp, signature } };
}

const SITE_URL = 'https://egidpsrkqvymvioidatc.supabase.co';

function payload(overrides: Partial<HookPayload> & { email_action_type?: string } = {}): HookPayload {
  const action = (overrides.email_action_type ?? 'signup') as HookPayload['email_data']['email_action_type'];
  return {
    user: { id: 'user-1', email: 'alice@example.com' },
    email_data: {
      email_action_type: action,
      redirect_to: 'https://ygoprices.io/auth/callback',
      site_url: SITE_URL,
      token: 'plain-token',
      token_hash: 'HASH_MAIN',
    },
    ...overrides,
  } as HookPayload;
}

// -- signature gate ------------------------------------------------

test('rejects unsigned request (401) before parsing body', async () => {
  const { fetch, calls } = makeMockFetch();
  const out = await handleHookRequest({
    rawBody: JSON.stringify(payload()),
    headers: { id: null, timestamp: null, signature: null },
    env: ENV,
    doFetch: fetch,
    nowSeconds: () => NOW,
  });
  assert.equal(out.status, 401);
  assert.equal(out.errorTag, 'verify:missing-header');
  assert.equal(calls.length, 0);
});

test('rejects tampered body (401), no email sent', async () => {
  const original = JSON.stringify(payload());
  const { rawBody, headers } = await signedPost(original);
  const { fetch, calls } = makeMockFetch();
  const out = await handleHookRequest({
    rawBody: rawBody + ' ',
    headers,
    env: ENV,
    doFetch: fetch,
    nowSeconds: () => NOW,
  });
  assert.equal(out.status, 401);
  assert.equal(calls.length, 0);
});

test('rejects unparseable body after signature passes (400)', async () => {
  const bad = 'not-json{{';
  const { rawBody, headers } = await signedPost(bad);
  const { fetch, calls } = makeMockFetch();
  const out = await handleHookRequest({
    rawBody,
    headers,
    env: ENV,
    doFetch: fetch,
    nowSeconds: () => NOW,
  });
  assert.equal(out.status, 400);
  assert.equal(out.errorTag, 'parse-json');
  assert.equal(calls.length, 0);
});

// -- brand detection ----------------------------------------------

test('YGO hostname → YGO branding', async () => {
  const p = payload({ email_action_type: 'signup' as never });
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  const out = await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.equal(out.status, 204);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.parsed.from, /^YGOPrices </);
  assert.equal(calls[0]!.parsed.subject, 'Confirm your YGOPrices account');
  assert.deepEqual(calls[0]!.parsed.tags, [
    { name: 'category', value: 'auth' },
    { name: 'brand', value: 'ygo' },
    { name: 'action', value: 'signup' },
  ]);
  // First-party CTA URL shape: brand-origin /auth/confirm, with
  // token_hash + type=email (signup mapping) + safe next.
  assert.ok(calls[0]!.parsed.html.includes('https://ygoprices.io/auth/confirm?'));
  assert.ok(calls[0]!.parsed.html.includes('token_hash=HASH_MAIN'));
  assert.ok(calls[0]!.parsed.html.includes('type=email'));
  assert.ok(calls[0]!.parsed.html.includes('next=%2Faccount'));
});

test('signup CTA never emits the legacy /auth/v1/verify pattern', async () => {
  const p = payload({ email_action_type: 'signup' as never });
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  const bag = calls[0]!.parsed.html + '\n' + calls[0]!.parsed.text;
  assert.equal(bag.includes('/auth/v1/verify'), false);
  assert.equal(bag.includes('apikey'), false);
});

test('signup CTA type maps to "email" (per Supabase SSR guidance)', async () => {
  const p = payload({ email_action_type: 'signup' as never });
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  // Not type=signup — that would rely on GoTrue's legacy verify
  // endpoint semantics. type=email is the current SDK-supported
  // EmailOtpType for confirmation-link verification.
  assert.ok(calls[0]!.parsed.html.includes('type=email'));
  assert.equal(calls[0]!.parsed.html.includes('type=signup'), false);
});

test('AuthForm-supplied ?returnTo=<safe path> flows through to next', async () => {
  const p = payload({ email_action_type: 'signup' as never });
  p.email_data.redirect_to = 'https://ygoprices.io/auth/callback?returnTo=%2Fwatchlist';
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.ok(calls[0]!.parsed.html.includes('next=%2Fwatchlist'));
});

test('hostile ?returnTo=<absolute URL> is rejected → falls back to default next', async () => {
  const p = payload({ email_action_type: 'signup' as never });
  p.email_data.redirect_to = 'https://ygoprices.io/auth/callback?returnTo=https%3A%2F%2Fevil.example%2Fsteal';
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  const bag = calls[0]!.parsed.html;
  assert.equal(bag.includes('evil.example'), false);
  assert.ok(bag.includes('next=%2Faccount')); // default
});

test('hostile ?returnTo=//attacker (protocol-relative) is rejected', async () => {
  const p = payload({ email_action_type: 'signup' as never });
  p.email_data.redirect_to = 'https://ygoprices.io/auth/callback?returnTo=%2F%2Fattacker.example';
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.equal(calls[0]!.parsed.html.includes('attacker.example'), false);
  assert.ok(calls[0]!.parsed.html.includes('next=%2Faccount'));
});

test('recovery routes to /account/reset-password by default', async () => {
  const p = payload({ email_action_type: 'recovery' as never });
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.ok(calls[0]!.parsed.html.includes('type=recovery'));
  assert.ok(calls[0]!.parsed.html.includes('next=%2Faccount%2Freset-password'));
  assert.equal(calls[0]!.parsed.html.includes('/auth/v1/verify'), false);
});

test('magiclink / invite / email_change / reauthentication types pass through unchanged', async () => {
  for (const [action, expectedType] of [
    ['magiclink', 'magiclink'],
    ['invite', 'invite'],
    ['email_change', 'email_change'],
    ['reauthentication', 'reauthentication'],
  ] as const) {
    const p = payload({ email_action_type: action as never });
    const { rawBody, headers } = await signedPost(JSON.stringify(p));
    const { fetch, calls } = makeMockFetch();
    await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
    assert.ok(
      calls[0]!.parsed.html.includes(`type=${expectedType}`),
      `${action} should map to type=${expectedType}`,
    );
  }
});

test('MTG hostname → MTG branding on a recovery flow', async () => {
  const p = payload({
    email_action_type: 'recovery' as never,
  });
  p.email_data.redirect_to = 'https://mtgprices.io/auth/callback';
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.match(calls[0]!.parsed.from, /^MTGPrices </);
  assert.equal(calls[0]!.parsed.subject, 'Reset your MTGPrices password');
  assert.deepEqual(calls[0]!.parsed.tags, [
    { name: 'category', value: 'auth' },
    { name: 'brand', value: 'mtg' },
    { name: 'action', value: 'recovery' },
  ]);
});

test('PokePrices hostname → Pokemon branding', async () => {
  const p = payload();
  p.email_data.redirect_to = 'https://pokeprices.io/auth/callback';
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.match(calls[0]!.parsed.from, /^PokePrices </);
  assert.equal(calls[0]!.parsed.tags[1]!.value, 'pokemon');
});

test('unknown hostname → neutral Collector Network fallback', async () => {
  const p = payload();
  p.email_data.redirect_to = 'https://random-attacker.example/steal';
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  const out = await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.equal(out.status, 204);
  assert.match(calls[0]!.parsed.from, /^Collector Network </);
  assert.equal(calls[0]!.parsed.tags[1]!.value, 'network');
  // The action URL must NOT redirect back to the attacker's host.
  assert.equal(calls[0]!.parsed.html.includes('random-attacker.example'), false);
  // Instead it falls back to the brand supportUrl.
  assert.ok(calls[0]!.parsed.html.includes('ygoprices.io')); // NEUTRAL_BRAND.supportUrl
});

test('invalid protocol in redirect_to falls back to neutral', async () => {
  const p = payload();
  // eslint-disable-next-line no-script-url
  p.email_data.redirect_to = 'javascript:alert(1)';
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.match(calls[0]!.parsed.from, /^Collector Network </);
  assert.equal(calls[0]!.parsed.html.includes('javascript:'), false);
});

test('brand-hint injection via payload does NOT override hostname branding', async () => {
  // A hostile caller cannot smuggle a brand identifier into the
  // payload; brand is chosen from redirect_to hostname only.
  const p = payload();
  p.email_data.redirect_to = 'https://mtgprices.io/auth/callback';
  // Injected fields that must NOT be used by the handler:
  (p as unknown as Record<string, unknown>).brand = 'ygo';
  (p as unknown as Record<string, unknown>).site = 'ygoprices.io';
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.match(calls[0]!.parsed.from, /^MTGPrices </);
});

// -- planSends: Secure Email Change dual-email dispatch ------------

test('planSends: signup issues one email to user.email using token_hash', () => {
  const sends = planSends(payload());
  assert.deepEqual(sends, [{ toEmail: 'alice@example.com', hash: 'HASH_MAIN', variant: 'default' }]);
});

test('planSends: email_change WITH Secure Email Change → two emails, correct token pairing', () => {
  // Supabase-specific: token_hash_new goes to the CURRENT inbox,
  // token_hash goes to the NEW inbox. The naming is Supabase's
  // backwards-compatibility artefact and MUST be preserved.
  const p: HookPayload = {
    user: { id: 'u', email: 'old@example.com', new_email: 'new@example.com' },
    email_data: {
      email_action_type: 'email_change',
      redirect_to: 'https://ygoprices.io/auth/callback',
      site_url: SITE_URL,
      token: 't_new',
      token_hash: 'HASH_NEW_INBOX',
      token_new: 't_current',
      token_hash_new: 'HASH_CURRENT_INBOX',
    },
  };
  const sends = planSends(p);
  assert.equal(sends.length, 2);
  const current = sends.find((s) => s.variant === 'to_current')!;
  const next = sends.find((s) => s.variant === 'to_new')!;
  assert.equal(current.toEmail, 'old@example.com');
  assert.equal(current.hash, 'HASH_CURRENT_INBOX');
  assert.equal(next.toEmail, 'new@example.com');
  assert.equal(next.hash, 'HASH_NEW_INBOX');
});

test('planSends: email_change WITHOUT Secure Email Change → one email fallback', () => {
  const p: HookPayload = {
    user: { id: 'u', email: 'alice@example.com' },
    email_data: {
      email_action_type: 'email_change',
      redirect_to: 'https://ygoprices.io/auth/callback',
      site_url: SITE_URL,
      token: 't',
      token_hash: 'HASH_ONLY',
    },
  };
  const sends = planSends(p);
  assert.deepEqual(sends, [{ toEmail: 'alice@example.com', hash: 'HASH_ONLY', variant: 'default' }]);
});

test('email_change end-to-end sends TWO branded emails with distinct action URLs', async () => {
  const p: HookPayload = {
    user: { id: 'u', email: 'old@ygoprices.io', new_email: 'new@ygoprices.io' },
    email_data: {
      email_action_type: 'email_change',
      redirect_to: 'https://ygoprices.io/auth/callback',
      site_url: SITE_URL,
      token: 't1',
      token_hash: 'H_NEW_TARGET',
      token_new: 't2',
      token_hash_new: 'H_CURRENT_TARGET',
    },
  };
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  const out = await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.equal(out.status, 204);
  assert.equal(calls.length, 2);
  const bodies = calls.map((c) => c.parsed);
  // Recipient 1 must be current inbox with token_hash_new.
  const toCurrent = bodies.find((b) => b.to[0] === 'old@ygoprices.io')!;
  const toNew = bodies.find((b) => b.to[0] === 'new@ygoprices.io')!;
  assert.match(toCurrent.subject, /Confirm your YGOPrices email change/);
  assert.match(toNew.subject, /Confirm your new YGOPrices email/);
  // Secure Email Change token pairing preserved through the URL:
  //   current inbox link carries token_hash_new
  //   new inbox link     carries token_hash
  assert.ok(toCurrent.html.includes('token_hash=H_CURRENT_TARGET'));
  assert.ok(toNew.html.includes('token_hash=H_NEW_TARGET'));
  // Both links point at the brand's own /auth/confirm route,
  // NOT Supabase's admin /auth/v1/verify.
  assert.ok(toCurrent.html.includes('https://ygoprices.io/auth/confirm?'));
  assert.ok(toNew.html.includes('https://ygoprices.io/auth/confirm?'));
  // email_change maps to type=email_change.
  assert.ok(toCurrent.html.includes('type=email_change'));
  assert.ok(toNew.html.includes('type=email_change'));
  // Idempotency keys are (webhook-id, variant), so the two sends
  // for one Supabase event carry distinct provider-side keys.
  const idempCurrent = calls.find((c) => c.parsed.to[0] === 'old@ygoprices.io')!.headers['Idempotency-Key']!;
  const idempNew = calls.find((c) => c.parsed.to[0] === 'new@ygoprices.io')!.headers['Idempotency-Key']!;
  assert.match(idempCurrent, /:to_current$/);
  assert.match(idempNew, /:to_new$/);
  assert.notEqual(idempCurrent, idempNew);
});

// -- Resend error propagation --------------------------------------

test('502 on first Resend failure; second email not attempted', async () => {
  const p: HookPayload = {
    user: { id: 'u', email: 'old@ygoprices.io', new_email: 'new@ygoprices.io' },
    email_data: {
      email_action_type: 'email_change',
      redirect_to: 'https://ygoprices.io/auth/callback',
      site_url: SITE_URL,
      token: 't1',
      token_hash: 'H_NEW',
      token_new: 't2',
      token_hash_new: 'H_CUR',
    },
  };
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch(() => ({ status: 500 }));
  const out = await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.equal(out.status, 502); // Supabase will retry
  assert.equal(out.errorTag, 'resend-500');
  assert.equal(calls.length, 1);
});

// -- no-leak invariants -------------------------------------------

test('no tokens, hashes or api-key appear in response body or observability summary', async () => {
  const p = payload({ email_action_type: 'signup' as never });
  p.email_data.token = 'PLAIN_TOKEN_SECRET';
  p.email_data.token_hash = 'HASH_TOKEN_SECRET';
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch } = makeMockFetch();
  const out = await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  const observable = JSON.stringify(out.sent) + '\n' + out.body + '\n' + (out.errorTag ?? '');
  for (const secret of [
    'PLAIN_TOKEN_SECRET',
    'HASH_TOKEN_SECRET',
    're_secret_not_real_XXXXXX', // Resend API key
    SECRET_STRING,               // Webhook secret
  ]) {
    assert.equal(observable.includes(secret), false, `leaked secret: ${secret}`);
  }
  // But `sent` DOES carry a domain-only recipient tag for ops:
  assert.equal(out.sent[0]!.toDomain, 'example.com');
});

// -- buildResponse: null-body statuses ----------------------------
//
// Regression: the first live CN-C deploy landed emails through
// Resend, then crashed on the return path with
// `TypeError: Response with null body status cannot have body`
// because 204 is a null-body status per the Fetch spec and we
// were passing an empty string. These tests fence off that path.

test('buildResponse: 204 success carries null body (no TypeError)', () => {
  const res = buildResponse({
    status: 204,
    body: '', // handler still returns empty string; entry MUST NOT forward it
    sent: [{ brand: 'ygo', action: 'signup', variant: 'default', toDomain: 'me.com' }],
  });
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
});

test('buildResponse: 205 / 304 also null-bodied', () => {
  for (const status of [205, 304]) {
    const res = buildResponse({ status, body: 'anything', sent: [] });
    assert.equal(res.body, null);
    assert.equal(res.status, status);
  }
});

test('buildResponse: 401 signature failure keeps diagnostic body', async () => {
  const res = buildResponse({
    status: 401,
    body: 'invalid signature',
    sent: [],
    errorTag: 'verify:signature-mismatch',
  });
  assert.equal(res.status, 401);
  assert.equal(await res.text(), 'invalid signature');
  assert.equal(res.headers.get('content-type'), 'text/plain');
});

test('buildResponse: 400 parse failure keeps diagnostic body', async () => {
  const res = buildResponse({ status: 400, body: 'bad json', sent: [], errorTag: 'parse-json' });
  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'bad json');
});

test('buildResponse: 502 Resend failure keeps diagnostic body (Supabase retries)', async () => {
  const res = buildResponse({
    status: 502,
    body: 'delivery failed',
    sent: [],
    errorTag: 'resend-500',
  });
  assert.equal(res.status, 502);
  assert.equal(await res.text(), 'delivery failed');
});

test('end-to-end: successful signup returns 204 + null body + exactly one Resend send', async () => {
  const p = payload({ email_action_type: 'signup' as never });
  const { rawBody, headers } = await signedPost(JSON.stringify(p));
  const { fetch, calls } = makeMockFetch();
  const out = await handleHookRequest({ rawBody, headers, env: ENV, doFetch: fetch, nowSeconds: () => NOW });
  assert.equal(out.status, 204);
  assert.equal(out.body, '');
  assert.equal(calls.length, 1); // exactly-once dispatch
  // And the entry-layer Response is null-bodied:
  const res = buildResponse(out);
  assert.equal(res.status, 204);
  assert.equal(res.body, null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandForHostname, NEUTRAL_BRAND } from './brand-registry.ts';
import { RESEND_ENDPOINT, sendViaResend, type FetchLike } from './resend-transport.ts';

const ygo = brandForHostname('ygoprices.io');

// Mock fetch: records every call so tests can assert on URL,
// headers, and JSON body. Never touches the network. This is the
// "no burn credits during unit tests" harness the CN-C spec
// (section 14) requires.
function makeMockFetch(
  responder: (url: string, init: RequestInit) => { status: number; body?: string },
): { fetch: FetchLike; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = responder(url, init);
    return new Response(r.body ?? '{}', {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls };
}

const baseInput = {
  brand: ygo,
  action: 'signup' as const,
  variant: 'default' as const,
  toEmail: 'alice@example.com',
  fromEmail: 'accounts@send.collector.network',
  subject: 'Confirm your YGOPrices account',
  html: '<p>hi</p>',
  text: 'hi',
};

test('POSTs to the Resend emails endpoint', async () => {
  const { fetch, calls } = makeMockFetch(() => ({ status: 200, body: '{"id":"re_x"}' }));
  const r = await sendViaResend('re_secret_apikey_XXXXXX', baseInput, fetch);
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, RESEND_ENDPOINT);
  assert.equal(calls[0]!.url, 'https://api.resend.com/emails');
  assert.equal(calls[0]!.init.method, 'POST');
});

test('uses Bearer auth from RESEND_API_KEY', async () => {
  const { fetch, calls } = makeMockFetch(() => ({ status: 200 }));
  await sendViaResend('re_secret_apikey_XXXXXX', baseInput, fetch);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer re_secret_apikey_XXXXXX');
  assert.equal(headers['content-type'], 'application/json');
});

test('body carries trusted From header format: "<Brand> <email>"', async () => {
  let captured = '';
  const { fetch } = makeMockFetch((_url, init) => {
    captured = String(init.body ?? '');
    return { status: 200 };
  });
  await sendViaResend('key', baseInput, fetch);
  const parsed = JSON.parse(captured);
  assert.equal(parsed.from, 'YGOPrices <accounts@send.collector.network>');
});

test('quotes brand display name containing spaces or punctuation', async () => {
  let captured = '';
  const { fetch } = makeMockFetch((_url, init) => {
    captured = String(init.body ?? '');
    return { status: 200 };
  });
  await sendViaResend('key', { ...baseInput, brand: NEUTRAL_BRAND }, fetch);
  const parsed = JSON.parse(captured);
  // NEUTRAL_BRAND.senderName is "Collector Network" (has a space
  // but no punctuation - unquoted is RFC-valid); if you change
  // this brand to have punctuation, quoting kicks in.
  assert.equal(parsed.from, 'Collector Network <accounts@send.collector.network>');
});

test('recipient, subject, html and text are forwarded verbatim', async () => {
  let captured = '';
  const { fetch } = makeMockFetch((_url, init) => {
    captured = String(init.body ?? '');
    return { status: 200 };
  });
  await sendViaResend('key', baseInput, fetch);
  const parsed = JSON.parse(captured);
  assert.deepEqual(parsed.to, ['alice@example.com']);
  assert.equal(parsed.subject, 'Confirm your YGOPrices account');
  assert.equal(parsed.html, '<p>hi</p>');
  assert.equal(parsed.text, 'hi');
});

test('tags use fixed vocabulary — category, brand, action', async () => {
  let captured = '';
  const { fetch } = makeMockFetch((_url, init) => {
    captured = String(init.body ?? '');
    return { status: 200 };
  });
  await sendViaResend('key', baseInput, fetch);
  const parsed = JSON.parse(captured);
  assert.deepEqual(parsed.tags, [
    { name: 'category', value: 'auth' },
    { name: 'brand', value: 'ygo' },
    { name: 'action', value: 'signup' },
  ]);
});

test('tags never contain recipient email, tokens, or user ids', async () => {
  let captured = '';
  const { fetch } = makeMockFetch((_url, init) => {
    captured = String(init.body ?? '');
    return { status: 200 };
  });
  await sendViaResend('key', baseInput, fetch);
  const parsed = JSON.parse(captured);
  const bag = JSON.stringify(parsed.tags);
  assert.equal(bag.includes('alice@example.com'), false);
  assert.equal(bag.includes('example.com'), false);
});

test('Idempotency-Key header sent when caller provides one', async () => {
  const { fetch, calls } = makeMockFetch(() => ({ status: 200 }));
  await sendViaResend('key', { ...baseInput, idempotencyKey: 'evt_abc:to_current' }, fetch);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers['Idempotency-Key'], 'evt_abc:to_current');
});

test('Idempotency-Key header omitted when caller does not provide one', async () => {
  const { fetch, calls } = makeMockFetch(() => ({ status: 200 }));
  await sendViaResend('key', baseInput, fetch);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers['Idempotency-Key'], undefined);
});

test('non-2xx propagates as resend-<status> failure', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 422, body: '{"message":"bad from"}' }));
  const r = await sendViaResend('key', baseInput, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.errorTag, 'resend-422');
});

test('429 → resend-429 (so Supabase can retry)', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 429 }));
  const r = await sendViaResend('key', baseInput, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'resend-429');
});

test('500 → resend-500', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 500 }));
  const r = await sendViaResend('key', baseInput, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'resend-500');
});

test('provider response body is never surfaced in SendResult', async () => {
  const secretBleed = 'internal-secret-do-not-leak';
  const { fetch } = makeMockFetch(() => ({
    status: 400,
    body: `{"message":"${secretBleed}","request_id":"${secretBleed}"}`,
  }));
  const r = await sendViaResend('key', baseInput, fetch);
  const observable = JSON.stringify(r);
  assert.equal(observable.includes(secretBleed), false);
});

test('network error yields network:<name> tag, not the raw error', async () => {
  const badFetch: FetchLike = async () => {
    throw new TypeError('fetch failed');
  };
  const r = await sendViaResend('key', baseInput, badFetch);
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.equal(r.errorTag, 'network:TypeError');
});

test('missing api key short-circuits before any network call', async () => {
  let called = false;
  const fetch: FetchLike = async () => {
    called = true;
    return new Response('', { status: 200 });
  };
  const r = await sendViaResend('', baseInput, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'missing-api-key');
  assert.equal(called, false);
});

test('missing from email short-circuits', async () => {
  const { fetch, calls } = makeMockFetch(() => ({ status: 200 }));
  const r = await sendViaResend('key', { ...baseInput, fromEmail: '' }, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'missing-from-email');
  assert.equal(calls.length, 0);
});

test('implausible recipient rejected without hitting network', async () => {
  let called = false;
  const fetch: FetchLike = async () => {
    called = true;
    return new Response('', { status: 200 });
  };
  const r = await sendViaResend('key', { ...baseInput, toEmail: 'nope' }, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'invalid-recipient');
  assert.equal(called, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createContact,
  getContactTopics,
  patchContactEmail,
  patchContactTopics,
  RESEND_CONTACTS_ENDPOINT,
  type FetchLike,
} from './resend-contacts.ts';

// Mock fetch: records every call so tests can assert on URL,
// method, headers, body. Never touches the network.
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

// -- createContact ------------------------------------------------

test('createContact POSTs to /contacts with Bearer + segments + topics', async () => {
  let captured = '';
  const { fetch, calls } = makeMockFetch((_u, init) => {
    captured = String(init.body ?? '');
    return { status: 201, body: '{"id":"contact-abc"}' };
  });
  const r = await createContact(
    're_secret_apikey_XXXXXX',
    {
      email: 'alice@example.com',
      segmentId: 'seg-1',
      topics: [{ id: 't-ygo', subscription: 'opt_in' }],
    },
    fetch,
  );
  assert.equal(r.ok, true);
  assert.equal(r.contactId, 'contact-abc');
  assert.equal(calls[0]!.url, RESEND_CONTACTS_ENDPOINT);
  assert.equal(calls[0]!.url, 'https://api.resend.com/contacts');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer re_secret_apikey_XXXXXX');
  const parsed = JSON.parse(captured);
  assert.deepEqual(parsed.segments, ['seg-1']);
  assert.deepEqual(parsed.topics, [{ id: 't-ygo', subscription: 'opt_in' }]);
  assert.equal(parsed.unsubscribed, undefined, 'unsubscribed must NEVER be in the body');
});

test('createContact returns no-contact-id when Resend response has no id', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 200, body: '{}' }));
  const r = await createContact('key', {
    email: 'a@b.com', segmentId: 's', topics: [],
  }, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'no-contact-id');
});

test('createContact 429 → resend-429 (rate-limit propagation)', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 429 }));
  const r = await createContact('key', {
    email: 'a@b.com', segmentId: 's', topics: [],
  }, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'resend-429');
});

test('createContact 5xx propagates as resend-<status>', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 502 }));
  const r = await createContact('key', {
    email: 'a@b.com', segmentId: 's', topics: [],
  }, fetch);
  assert.equal(r.errorTag, 'resend-502');
});

test('createContact network error yields network:<name>', async () => {
  const badFetch: FetchLike = async () => { throw new TypeError('fetch failed'); };
  const r = await createContact('key', {
    email: 'a@b.com', segmentId: 's', topics: [],
  }, badFetch);
  assert.equal(r.errorTag, 'network:TypeError');
});

test('createContact missing api key short-circuits without a fetch call', async () => {
  let called = false;
  const fetch: FetchLike = async () => { called = true; return new Response('', { status: 200 }); };
  const r = await createContact('', {
    email: 'a@b.com', segmentId: 's', topics: [],
  }, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'missing-api-key');
  assert.equal(called, false);
});

test('createContact never surfaces the provider response body in the result', async () => {
  const secretBleed = 'internal-resend-message-do-not-leak';
  const { fetch } = makeMockFetch(() => ({
    status: 422,
    body: `{"message":"${secretBleed}"}`,
  }));
  const r = await createContact('key', {
    email: 'a@b.com', segmentId: 's', topics: [],
  }, fetch);
  const observable = JSON.stringify(r);
  assert.equal(observable.includes(secretBleed), false);
});

// -- patchContactEmail (drift) ------------------------------------

test('patchContactEmail PATCHes /contacts/{id} with email + segments only', async () => {
  let captured = '';
  const { fetch, calls } = makeMockFetch((_u, init) => {
    captured = String(init.body ?? '');
    return { status: 200 };
  });
  await patchContactEmail('key', {
    contactId: 'c-1',
    email: 'new@example.com',
    segmentId: 'seg-1',
  }, fetch);
  assert.equal(calls[0]!.url, 'https://api.resend.com/contacts/c-1');
  assert.equal(calls[0]!.init.method, 'PATCH');
  const parsed = JSON.parse(captured);
  assert.equal(parsed.email, 'new@example.com');
  assert.deepEqual(parsed.segments, ['seg-1']);
  assert.equal(parsed.topics, undefined, 'topics must NOT be in the email-drift body');
  assert.equal(parsed.unsubscribed, undefined, 'unsubscribed must NEVER be in the body');
});

test('patchContactEmail 404 propagates so the worker can recreate', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 404 }));
  const r = await patchContactEmail('key', {
    contactId: 'gone', email: 'a@b.com', segmentId: 's',
  }, fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'resend-404');
});

test('patchContactEmail encodes contactId for URL safety', async () => {
  const { fetch, calls } = makeMockFetch(() => ({ status: 200 }));
  await patchContactEmail('key', {
    contactId: 'weird/id with space',
    email: 'a@b.com',
    segmentId: 's',
  }, fetch);
  // Encoded form present, raw form absent.
  assert.ok(calls[0]!.url.includes('weird%2Fid%20with%20space'));
});

// -- getContactTopics ---------------------------------------------

test('getContactTopics GETs /contacts/{id}/topics and parses subscription list', async () => {
  const body = JSON.stringify({
    object: 'list',
    has_more: false,
    data: [
      { id: 't-ygo', name: 'site:ygo', description: '', subscription: 'opt_in' },
      { id: 't-net', name: 'network', description: '', subscription: 'opt_out' },
    ],
  });
  const { fetch, calls } = makeMockFetch(() => ({ status: 200, body }));
  const r = await getContactTopics('key', 'c-1', fetch);
  assert.equal(calls[0]!.url, 'https://api.resend.com/contacts/c-1/topics');
  assert.equal(calls[0]!.init.method, 'GET');
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, [
    { id: 't-ygo', subscription: 'opt_in' },
    { id: 't-net', subscription: 'opt_out' },
  ]);
});

test('getContactTopics filters out rows with invalid subscription values', async () => {
  const body = JSON.stringify({
    data: [
      { id: 't-1', subscription: 'opt_in' },
      { id: 't-2', subscription: 'confused' },
      { id: 't-3' /* missing subscription */ },
    ],
  });
  const { fetch } = makeMockFetch(() => ({ status: 200, body }));
  const r = await getContactTopics('key', 'c-1', fetch);
  assert.deepEqual(r.data, [{ id: 't-1', subscription: 'opt_in' }]);
});

test('getContactTopics 404 → resend-404, empty data', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 404 }));
  const r = await getContactTopics('key', 'gone', fetch);
  assert.equal(r.ok, false);
  assert.equal(r.errorTag, 'resend-404');
  assert.deepEqual(r.data, []);
});

// -- patchContactTopics (the smallest corrective diff) ------------

test('patchContactTopics PATCHes /contacts/{id}/topics with a bare array body', async () => {
  let captured = '';
  const { fetch, calls } = makeMockFetch((_u, init) => {
    captured = String(init.body ?? '');
    return { status: 200 };
  });
  await patchContactTopics(
    'key',
    'c-1',
    [
      { id: 't-ygo', subscription: 'opt_in' },
      { id: 't-net', subscription: 'opt_out' },
    ],
    fetch,
  );
  assert.equal(calls[0]!.url, 'https://api.resend.com/contacts/c-1/topics');
  assert.equal(calls[0]!.init.method, 'PATCH');
  // Body is a bare array, NOT wrapped in { topics: [...] }.
  const parsed = JSON.parse(captured);
  assert.ok(Array.isArray(parsed));
  assert.deepEqual(parsed, [
    { id: 't-ygo', subscription: 'opt_in' },
    { id: 't-net', subscription: 'opt_out' },
  ]);
});

test('patchContactTopics with an empty diff is a no-op (no fetch call)', async () => {
  let called = false;
  const fetch: FetchLike = async () => { called = true; return new Response('', { status: 200 }); };
  const r = await patchContactTopics('key', 'c-1', [], fetch);
  assert.equal(r.ok, true);
  assert.equal(called, false);
});

test('patchContactTopics 429 propagates as resend-429', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 429 }));
  const r = await patchContactTopics('key', 'c-1', [
    { id: 't', subscription: 'opt_in' },
  ], fetch);
  assert.equal(r.errorTag, 'resend-429');
});

test('patchContactTopics 5xx propagates as resend-<status>', async () => {
  const { fetch } = makeMockFetch(() => ({ status: 503 }));
  const r = await patchContactTopics('key', 'c-1', [
    { id: 't', subscription: 'opt_in' },
  ], fetch);
  assert.equal(r.errorTag, 'resend-503');
});

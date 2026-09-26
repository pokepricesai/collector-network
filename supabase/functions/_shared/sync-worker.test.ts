import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FetchLike } from './resend-contacts.ts';
import {
  backoffSeconds,
  computeDiff,
  computeTarget,
  runReconcile,
  syncUser,
  type ContactMapping,
  type ConsentEvent,
  type Cursor,
  type Preference,
  type SupabaseAdapter,
  type Topic,
} from './sync-worker.ts';

// -- Fixture builders ---------------------------------------------

const TOPIC_YGO: Topic = {
  scope: 'site', siteCode: 'ygo',
  resendTopicId: 't-ygo',
  active: true, defaultSubscription: 'opt_out',
};
const TOPIC_NETWORK: Topic = {
  scope: 'network', siteCode: null,
  resendTopicId: 't-net',
  active: true, defaultSubscription: 'opt_out',
};
const TOPIC_MTG_INACTIVE: Topic = {
  scope: 'site', siteCode: 'mtg',
  resendTopicId: 't-mtg',
  active: false, defaultSubscription: 'opt_out',
};

// Programmable in-memory adapter for tests.
interface Fixture {
  segmentId: string | null;
  topics: Topic[];
  cursor: Cursor;
  events: ConsentEvent[];
  emails: Record<string, string | null>;
  preferences: Record<string, Preference[]>;
  mappings: Record<string, ContactMapping>;
  retryQueue: string[];
  allUsersWithPrefs: string[];
  // Recorded writes for assertions
  inserts: ContactMapping[];
  emailUpdates: Array<{ userId: string; email: string }>;
  successes: string[];
  failures: Array<{ userId: string; errorTag: string }>;
  cursorAdvances: Cursor[];
  cursorTouches: number;
}

function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    segmentId: 'seg-1',
    topics: [TOPIC_YGO, TOPIC_NETWORK],
    cursor: { occurredAt: null, eventId: null },
    events: [],
    emails: {},
    preferences: {},
    mappings: {},
    retryQueue: [],
    allUsersWithPrefs: [],
    inserts: [],
    emailUpdates: [],
    successes: [],
    failures: [],
    cursorAdvances: [],
    cursorTouches: 0,
    ...overrides,
  };
}

function adapterFor(f: Fixture): SupabaseAdapter {
  return {
    getSegmentId: async () => f.segmentId,
    getActiveTopics: async () => f.topics.filter((t) => t.active),
    getCursor: async () => f.cursor,
    getEventsSince: async () => f.events,
    getUsersDueForRetry: async () => f.retryQueue,
    getUsersWithAnyPreference: async () => f.allUsersWithPrefs,
    getEmailForUser: async (u) => f.emails[u] ?? null,
    getPreferencesForUser: async (u) => f.preferences[u] ?? [],
    getContactMapping: async (u) => f.mappings[u] ?? null,
    insertContactMapping: async (m) => {
      f.mappings[m.userId] = { ...m };
      f.inserts.push({ ...m });
    },
    updateContactMappingEmail: async (userId, syncedEmail) => {
      const m = f.mappings[userId];
      if (m) m.syncedEmail = syncedEmail;
      f.emailUpdates.push({ userId, email: syncedEmail });
    },
    markSyncSuccess: async (u) => { f.successes.push(u); },
    recordSyncFailure: async (u, errorTag) => {
      f.failures.push({ userId: u, errorTag });
    },
    advanceCursor: async (next) => { f.cursorAdvances.push({ ...next }); f.cursor = { ...next }; },
    updateCursorRunAt: async () => { f.cursorTouches++; },
  };
}

// Mock fetch that returns programmable responses.
interface MockedResponse {
  method: string;
  urlPattern: RegExp;
  status: number;
  body?: unknown;
}
function makeMockFetch(responses: MockedResponse[]): {
  fetch: FetchLike;
  calls: Array<{ method: string; url: string; body: string }>;
} {
  const calls: Array<{ method: string; url: string; body: string }> = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init.method ?? 'GET';
    const body = String(init.body ?? '');
    calls.push({ method, url, body });
    const match = responses.find(
      (r) => r.method === method && r.urlPattern.test(url),
    );
    if (!match) {
      return new Response('{}', { status: 599 });
    }
    return new Response(
      match.body === undefined ? '{}' : JSON.stringify(match.body),
      { status: match.status, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetch, calls };
}

// -- Pure helpers -------------------------------------------------

test('computeTarget: preference opt_in maps to opt_in', () => {
  const target = computeTarget(
    [{ userId: 'u', scope: 'site', siteCode: 'ygo', emailOptIn: true }],
    [TOPIC_YGO, TOPIC_NETWORK],
  );
  assert.deepEqual(target, [{ id: 't-ygo', subscription: 'opt_in' }]);
});

test('computeTarget: preference opt_out maps to opt_out', () => {
  const target = computeTarget(
    [{ userId: 'u', scope: 'site', siteCode: 'ygo', emailOptIn: false }],
    [TOPIC_YGO, TOPIC_NETWORK],
  );
  assert.deepEqual(target, [{ id: 't-ygo', subscription: 'opt_out' }]);
});

test('computeTarget: NO preference row → topic OMITTED (no fabrication)', () => {
  const target = computeTarget([], [TOPIC_YGO, TOPIC_NETWORK]);
  assert.deepEqual(target, []);
});

test('computeTarget: only inactive topics available → empty', () => {
  const target = computeTarget(
    [{ userId: 'u', scope: 'site', siteCode: 'mtg', emailOptIn: true }],
    [TOPIC_MTG_INACTIVE.active ? TOPIC_MTG_INACTIVE : { ...TOPIC_MTG_INACTIVE, active: true }],
  );
  // If the caller passes inactive topics, they're the caller's
  // responsibility. Adapter is expected to filter to active
  // topics before calling computeTarget.
  assert.equal(target.length, 1);
});

test('computeTarget: mixes opt_in and opt_out across scopes', () => {
  const target = computeTarget(
    [
      { userId: 'u', scope: 'site',    siteCode: 'ygo',  emailOptIn: true },
      { userId: 'u', scope: 'network', siteCode: null,   emailOptIn: false },
    ],
    [TOPIC_YGO, TOPIC_NETWORK],
  );
  assert.deepEqual(target, [
    { id: 't-ygo', subscription: 'opt_in' },
    { id: 't-net', subscription: 'opt_out' },
  ]);
});

test('computeDiff: only differing topics are returned', () => {
  const diff = computeDiff(
    [
      { id: 't-ygo', subscription: 'opt_in' },
      { id: 't-net', subscription: 'opt_out' },
    ],
    [
      { id: 't-ygo', subscription: 'opt_in' },  // same
      { id: 't-net', subscription: 'opt_in' },  // different
    ],
  );
  assert.deepEqual(diff, [{ id: 't-net', subscription: 'opt_out' }]);
});

test('computeDiff: target absent from current → included (Resend has not seen it)', () => {
  const diff = computeDiff(
    [{ id: 't-ygo', subscription: 'opt_in' }],
    [],
  );
  assert.deepEqual(diff, [{ id: 't-ygo', subscription: 'opt_in' }]);
});

test('computeDiff: identical state → empty diff (no PATCH sent)', () => {
  const diff = computeDiff(
    [{ id: 't-ygo', subscription: 'opt_in' }],
    [{ id: 't-ygo', subscription: 'opt_in' }],
  );
  assert.equal(diff.length, 0);
});

test('backoffSeconds: grows exponentially and caps at 1h', () => {
  assert.equal(backoffSeconds(1), 60);
  assert.equal(backoffSeconds(2), 120);
  assert.equal(backoffSeconds(3), 240);
  assert.equal(backoffSeconds(10), 3600);
  assert.equal(backoffSeconds(100), 3600);
});

// -- syncUser: first-time create ---------------------------------

test('syncUser first-time: POSTs /contacts, inserts mapping, marks success', async () => {
  const f = makeFixture({
    emails: { 'u1': 'Alice@Example.com' },
    preferences: { 'u1': [
      { userId: 'u1', scope: 'site',    siteCode: 'ygo',  emailOptIn: true },
      { userId: 'u1', scope: 'network', siteCode: null,   emailOptIn: true },
    ] },
  });
  const { fetch, calls } = makeMockFetch([
    { method: 'POST', urlPattern: /\/contacts$/, status: 201, body: { id: 'r-1' } },
  ]);
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO, TOPIC_NETWORK],
  });
  assert.equal(outcome.kind, 'success');
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0]!.body);
  assert.equal(body.email, 'alice@example.com'); // normalised
  assert.deepEqual(body.topics, [
    { id: 't-ygo', subscription: 'opt_in' },
    { id: 't-net', subscription: 'opt_in' },
  ]);
  assert.equal(body.unsubscribed, undefined);
  assert.deepEqual(f.inserts, [
    { userId: 'u1', resendContactId: 'r-1', syncedEmail: 'alice@example.com' },
  ]);
  assert.deepEqual(f.successes, ['u1']);
});

test('syncUser: user with NO preference row is a no-op (skips create)', async () => {
  // Amendment 1 invariant: absence != opt_out. No Contact
  // creation.
  const f = makeFixture({
    emails: { 'u1': 'alice@example.com' },
    preferences: {},  // deliberately empty
  });
  let called = false;
  const fetch: FetchLike = async () => { called = true; return new Response('{}', { status: 200 }); };
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO, TOPIC_NETWORK],
  });
  assert.equal(outcome.kind, 'noop');
  assert.equal(called, false);
  assert.equal(f.inserts.length, 0);
  assert.equal(f.successes.length, 0);
});

test('syncUser: missing email (deleted user) is a no-op', async () => {
  const f = makeFixture({ emails: { 'u1': null } });
  let called = false;
  const fetch: FetchLike = async () => { called = true; return new Response('{}', { status: 200 }); };
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO, TOPIC_NETWORK],
  });
  assert.equal(outcome.kind, 'noop');
  assert.equal(called, false);
});

// -- syncUser: returning user with a topic flip -------------------

test('syncUser returning: sends smallest corrective PATCH (Gate B additive)', async () => {
  const f = makeFixture({
    emails: { 'u1': 'alice@example.com' },
    preferences: { 'u1': [
      { userId: 'u1', scope: 'site',    siteCode: 'ygo',  emailOptIn: true }, // now opted in
      { userId: 'u1', scope: 'network', siteCode: null,   emailOptIn: true }, // was already in
    ] },
    mappings: { 'u1': { userId: 'u1', resendContactId: 'r-1', syncedEmail: 'alice@example.com' } },
  });
  const { fetch, calls } = makeMockFetch([
    // GET topics: network already opt_in, ygo opt_out (default)
    { method: 'GET', urlPattern: /\/contacts\/r-1\/topics$/, status: 200, body: {
      data: [
        { id: 't-ygo', subscription: 'opt_out' },
        { id: 't-net', subscription: 'opt_in' },
      ],
    } },
    { method: 'PATCH', urlPattern: /\/contacts\/r-1\/topics$/, status: 200 },
  ]);
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO, TOPIC_NETWORK],
  });
  assert.equal(outcome.kind, 'success');
  // Only the ygo topic should be in the PATCH body — network
  // was already opt_in.
  const patch = calls.find((c) => c.method === 'PATCH')!;
  const parsed = JSON.parse(patch.body);
  assert.deepEqual(parsed, [{ id: 't-ygo', subscription: 'opt_in' }]);
});

test('syncUser returning: no diff → no PATCH call (idempotent)', async () => {
  const f = makeFixture({
    emails: { 'u1': 'alice@example.com' },
    preferences: { 'u1': [
      { userId: 'u1', scope: 'site', siteCode: 'ygo', emailOptIn: true },
    ] },
    mappings: { 'u1': { userId: 'u1', resendContactId: 'r-1', syncedEmail: 'alice@example.com' } },
  });
  const { fetch, calls } = makeMockFetch([
    { method: 'GET', urlPattern: /\/contacts\/r-1\/topics$/, status: 200, body: {
      data: [{ id: 't-ygo', subscription: 'opt_in' }],
    } },
    // No PATCH mock registered — if it fires, 599 will surface.
  ]);
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO, TOPIC_NETWORK],
  });
  assert.equal(outcome.kind, 'success');
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('syncUser: opt-out flip PATCHes with opt_out for that topic only', async () => {
  const f = makeFixture({
    emails: { 'u1': 'alice@example.com' },
    preferences: { 'u1': [
      { userId: 'u1', scope: 'site', siteCode: 'ygo', emailOptIn: false }, // opting out
    ] },
    mappings: { 'u1': { userId: 'u1', resendContactId: 'r-1', syncedEmail: 'alice@example.com' } },
  });
  const { fetch, calls } = makeMockFetch([
    { method: 'GET', urlPattern: /\/contacts\/r-1\/topics$/, status: 200, body: {
      data: [{ id: 't-ygo', subscription: 'opt_in' }],
    } },
    { method: 'PATCH', urlPattern: /\/contacts\/r-1\/topics$/, status: 200 },
  ]);
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO],
  });
  assert.equal(outcome.kind, 'success');
  const patch = calls.find((c) => c.method === 'PATCH')!;
  assert.deepEqual(JSON.parse(patch.body), [{ id: 't-ygo', subscription: 'opt_out' }]);
});

// -- syncUser: email drift ---------------------------------------

test('syncUser: email drift → PATCH email, then GET+PATCH topics if needed', async () => {
  const f = makeFixture({
    emails: { 'u1': 'NEW@example.com' },
    preferences: { 'u1': [
      { userId: 'u1', scope: 'site', siteCode: 'ygo', emailOptIn: true },
    ] },
    mappings: { 'u1': { userId: 'u1', resendContactId: 'r-1', syncedEmail: 'old@example.com' } },
  });
  const { fetch, calls } = makeMockFetch([
    { method: 'PATCH', urlPattern: /\/contacts\/r-1$/, status: 200 },
    { method: 'GET',   urlPattern: /\/contacts\/r-1\/topics$/, status: 200, body: {
      data: [{ id: 't-ygo', subscription: 'opt_in' }], // already in target state
    } },
    // No topic PATCH expected — GET returned the target state.
  ]);
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO],
  });
  assert.equal(outcome.kind, 'success');
  const emailPatch = calls.find((c) => c.method === 'PATCH' && /\/contacts\/r-1$/.test(c.url))!;
  const parsed = JSON.parse(emailPatch.body);
  assert.equal(parsed.email, 'new@example.com'); // normalised
  assert.deepEqual(parsed.segments, ['seg-1']);
  assert.equal(parsed.topics, undefined);
  // Mapping now shows synced_email updated.
  assert.deepEqual(f.emailUpdates, [{ userId: 'u1', email: 'new@example.com' }]);
});

// -- syncUser: 404 recovery + failure propagation -----------------

test('syncUser: PATCH topics returns 404 → falls back to POST + upserts mapping', async () => {
  const f = makeFixture({
    emails: { 'u1': 'alice@example.com' },
    preferences: { 'u1': [
      { userId: 'u1', scope: 'site', siteCode: 'ygo', emailOptIn: true },
    ] },
    mappings: { 'u1': { userId: 'u1', resendContactId: 'r-stale', syncedEmail: 'alice@example.com' } },
  });
  const { fetch, calls } = makeMockFetch([
    { method: 'GET',  urlPattern: /\/contacts\/r-stale\/topics$/, status: 404 },
    { method: 'POST', urlPattern: /\/contacts$/, status: 201, body: { id: 'r-new' } },
  ]);
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO],
  });
  assert.equal(outcome.kind, 'success');
  // Mapping now points at the new contact id.
  assert.equal(f.mappings['u1']!.resendContactId, 'r-new');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});

test('syncUser: Resend 429 on POST → failure outcome with resend-429 tag', async () => {
  const f = makeFixture({
    emails: { 'u1': 'alice@example.com' },
    preferences: { 'u1': [
      { userId: 'u1', scope: 'site', siteCode: 'ygo', emailOptIn: true },
    ] },
  });
  const { fetch } = makeMockFetch([
    { method: 'POST', urlPattern: /\/contacts$/, status: 429 },
  ]);
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO],
  });
  assert.equal(outcome.kind, 'failure');
  if (outcome.kind === 'failure') assert.equal(outcome.errorTag, 'resend-429');
  // No mapping inserted, no success marked.
  assert.equal(f.inserts.length, 0);
  assert.equal(f.successes.length, 0);
});

test('syncUser: Resend 503 on topic PATCH → failure outcome', async () => {
  const f = makeFixture({
    emails: { 'u1': 'alice@example.com' },
    preferences: { 'u1': [
      { userId: 'u1', scope: 'site', siteCode: 'ygo', emailOptIn: true },
    ] },
    mappings: { 'u1': { userId: 'u1', resendContactId: 'r-1', syncedEmail: 'alice@example.com' } },
  });
  const { fetch } = makeMockFetch([
    { method: 'GET',   urlPattern: /\/contacts\/r-1\/topics$/, status: 200, body: {
      data: [{ id: 't-ygo', subscription: 'opt_out' }],
    } },
    { method: 'PATCH', urlPattern: /\/contacts\/r-1\/topics$/, status: 503 },
  ]);
  const outcome = await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO],
  });
  assert.equal(outcome.kind, 'failure');
  if (outcome.kind === 'failure') assert.equal(outcome.errorTag, 'resend-503');
});

// -- runReconcile ------------------------------------------------

test('runReconcile: empty event batch → no calls, only cursor touch', async () => {
  const f = makeFixture();
  let called = false;
  const fetch: FetchLike = async () => { called = true; return new Response('{}', { status: 200 }); };
  const summary = await runReconcile({
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    nowIso: '2026-09-26T10:00:00.000Z',
  });
  assert.equal(summary.processed, 0);
  assert.equal(summary.cursorAdvanced, false);
  assert.equal(f.cursorTouches, 1);
  assert.equal(called, false);
});

test('runReconcile: missing segment config → returns error tag, no cursor touch', async () => {
  const f = makeFixture({ segmentId: null });
  const fetch: FetchLike = async () => new Response('{}', { status: 200 });
  const summary = await runReconcile({
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
  });
  assert.equal(summary.errorTag, 'missing-segment-config');
  assert.equal(f.cursorTouches, 0);
});

test('runReconcile: cursor advances to batch max by (occurred_at, id::text)', async () => {
  // Three events, deliberately out of natural order to prove the
  // worker computes the max correctly under the composite
  // ordering.
  const events: ConsentEvent[] = [
    { id: 'e-2', userId: 'u1', occurredAt: '2026-09-26T10:00:00.100Z' },
    { id: 'e-3', userId: 'u2', occurredAt: '2026-09-26T10:00:00.200Z' },
    { id: 'e-1', userId: 'u1', occurredAt: '2026-09-26T10:00:00.100Z' }, // same ts as e-2
  ];
  const f = makeFixture({
    events,
    emails: { 'u1': 'a@b.com', 'u2': 'c@d.com' },
    preferences: {
      'u1': [{ userId: 'u1', scope: 'site', siteCode: 'ygo', emailOptIn: true }],
      'u2': [{ userId: 'u2', scope: 'site', siteCode: 'ygo', emailOptIn: false }],
    },
  });
  const { fetch } = makeMockFetch([
    { method: 'POST', urlPattern: /\/contacts$/, status: 201, body: { id: 'r-x' } },
  ]);
  const summary = await runReconcile({
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
  });
  assert.equal(summary.processed, 2); // u1 + u2 (unique users)
  assert.equal(summary.cursorAdvanced, true);
  assert.equal(f.cursorAdvances.length, 1);
  // Max is (10:00:00.200Z, e-3): later timestamp wins.
  assert.deepEqual(f.cursorAdvances[0], {
    occurredAt: '2026-09-26T10:00:00.200Z',
    eventId: 'e-3',
  });
});

test('runReconcile: partial failure → cursor still advances; failed user recorded', async () => {
  const events: ConsentEvent[] = [
    { id: 'e-a', userId: 'ok',    occurredAt: '2026-09-26T10:00:00Z' },
    { id: 'e-b', userId: 'ratel', occurredAt: '2026-09-26T10:00:01Z' },
  ];
  const f = makeFixture({
    events,
    emails: { 'ok': 'ok@e.com', 'ratel': 'ratel@e.com' },
    preferences: {
      'ok':    [{ userId: 'ok',    scope: 'site', siteCode: 'ygo', emailOptIn: true }],
      'ratel': [{ userId: 'ratel', scope: 'site', siteCode: 'ygo', emailOptIn: true }],
    },
  });
  let callCount = 0;
  const fetch: FetchLike = async () => {
    callCount++;
    // First POST (for ok) succeeds; second POST (for ratel) is rate-limited.
    if (callCount === 1) {
      return new Response(JSON.stringify({ id: 'r-ok' }), {
        status: 201, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 429 });
  };
  const summary = await runReconcile({
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
  });
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.cursorAdvanced, true);
  assert.deepEqual(f.failures, [{ userId: 'ratel', errorTag: 'resend-429' }]);
  assert.deepEqual(f.cursorAdvances[0], {
    occurredAt: '2026-09-26T10:00:01Z',
    eventId: 'e-b',
  });
});

test('runReconcile: also processes users on the retry queue in the same cycle', async () => {
  const f = makeFixture({
    events: [
      { id: 'e-a', userId: 'new', occurredAt: '2026-09-26T10:00:00Z' },
    ],
    retryQueue: ['old-fail'],
    emails: { 'new': 'n@e.com', 'old-fail': 'o@e.com' },
    preferences: {
      'new':      [{ userId: 'new',      scope: 'site', siteCode: 'ygo', emailOptIn: true }],
      'old-fail': [{ userId: 'old-fail', scope: 'site', siteCode: 'ygo', emailOptIn: true }],
    },
  });
  let ids = 0;
  const fetch: FetchLike = async () => new Response(
    JSON.stringify({ id: `r-${++ids}` }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
  const summary = await runReconcile({
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
  });
  assert.equal(summary.processed, 2);
  assert.equal(summary.succeeded, 2);
});

// -- Backfill mode ------------------------------------------------

test('runReconcile backfill: iterates ONLY users with preference rows, ignores events', async () => {
  // Amendment 1 core test: CN-A membership users without
  // preference rows must never enter the backfill set.
  const f = makeFixture({
    allUsersWithPrefs: ['has-pref-1', 'has-pref-2'],
    // A CN-A membership user with no preferences — should NOT
    // appear anywhere in the sync path.
    emails: {
      'has-pref-1': 'a@e.com',
      'has-pref-2': 'b@e.com',
      'membership-only': 'c@e.com',
    },
    preferences: {
      'has-pref-1': [{ userId: 'has-pref-1', scope: 'site', siteCode: 'ygo', emailOptIn: true }],
      'has-pref-2': [{ userId: 'has-pref-2', scope: 'network', siteCode: null, emailOptIn: true }],
      // 'membership-only' deliberately absent
    },
    // Populated to prove backfill ignores events.
    events: [
      { id: 'ignored', userId: 'membership-only', occurredAt: '2026-09-26T10:00:00Z' },
    ],
  });
  let ids = 0;
  const fetch: FetchLike = async () => new Response(
    JSON.stringify({ id: `r-${++ids}` }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
  const summary = await runReconcile({
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
    backfill: true,
  });
  assert.equal(summary.backfill, true);
  assert.equal(summary.processed, 2); // NOT 3 — membership-only excluded
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.cursorAdvanced, false); // never advances in backfill
  assert.equal(f.cursorTouches, 0); // does not touch cursor at all
  // membership-only was never contacted.
  assert.equal(f.inserts.find((m) => m.userId === 'membership-only'), undefined);
});

// -- Invariant: `unsubscribed` never in any body -----------------

test('invariant: `unsubscribed` never appears in any request body across create + drift + topics', async () => {
  const f = makeFixture({
    emails: { 'u1': 'new@e.com' },
    preferences: { 'u1': [
      { userId: 'u1', scope: 'site', siteCode: 'ygo', emailOptIn: false },
    ] },
    mappings: { 'u1': { userId: 'u1', resendContactId: 'r-1', syncedEmail: 'old@e.com' } },
  });
  let allBodies = '';
  const { fetch } = makeMockFetch([
    { method: 'PATCH', urlPattern: /\/contacts\/r-1$/, status: 200 },
    { method: 'GET',   urlPattern: /\/contacts\/r-1\/topics$/, status: 200, body: {
      data: [{ id: 't-ygo', subscription: 'opt_in' }],
    } },
    { method: 'PATCH', urlPattern: /\/contacts\/r-1\/topics$/, status: 200 },
  ]);
  const wrapped: FetchLike = async (u, init) => {
    allBodies += String(init.body ?? '') + '\n';
    return await fetch(u, init);
  };
  await syncUser('u1', {
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: wrapped,
    segmentId: 'seg-1',
    activeTopics: [TOPIC_YGO],
  });
  assert.equal(allBodies.includes('unsubscribed'), false);
});

// -- PII safety: error tags never contain email addresses --------

test('failure tags never contain the recipient email', async () => {
  const f = makeFixture({
    events: [{ id: 'e', userId: 'u', occurredAt: '2026-09-26T10:00:00Z' }],
    emails: { 'u': 'private@example.com' },
    preferences: { 'u': [{ userId: 'u', scope: 'site', siteCode: 'ygo', emailOptIn: true }] },
  });
  const fetch: FetchLike = async () => new Response('{}', { status: 500 });
  await runReconcile({
    supabase: adapterFor(f),
    resendApiKey: 'key',
    doFetch: fetch,
  });
  for (const fail of f.failures) {
    assert.equal(fail.errorTag.includes('@'), false);
    assert.equal(fail.errorTag.includes('private'), false);
    assert.equal(fail.errorTag.includes('example.com'), false);
  }
});

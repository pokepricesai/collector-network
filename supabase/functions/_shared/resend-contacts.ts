// Resend Contacts / Topics REST transport for CN-D1 forward
// sync.
//
// Uses the segments + topics model verified during Gate B
// (2026-09-26). Audiences are deprecated in Resend; the module
// only touches /contacts and /contacts/{id}/topics.
//
// Injectable `fetch` for tests. Never logs API key, request
// body, tokens, or provider response bodies.

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface TopicSubscription {
  id: string;
  subscription: 'opt_in' | 'opt_out';
}

export interface CreateContactInput {
  email: string;
  segmentId: string;
  topics: TopicSubscription[];
}

export interface CreateContactResult {
  ok: boolean;
  status: number;
  contactId?: string;
  errorTag?: string;
}

export interface PatchContactEmailInput {
  contactId: string;
  email: string;
}

export interface SegmentMembership {
  segmentId: string;
}

export interface SegmentsResult {
  ok: boolean;
  status: number;
  data: SegmentMembership[];
  errorTag?: string;
}

export interface SimpleResult {
  ok: boolean;
  status: number;
  errorTag?: string;
}

export interface TopicsResult {
  ok: boolean;
  status: number;
  data: TopicSubscription[]; // subscription copied verbatim per topic row
  errorTag?: string;
}

const BASE = 'https://api.resend.com';

function authHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

// Create a new Resend contact and set its initial topic
// subscriptions in one call. Called on first sync for a user.
export async function createContact(
  apiKey: string,
  input: CreateContactInput,
  doFetch: FetchLike = fetch,
): Promise<CreateContactResult> {
  if (!apiKey) return { ok: false, status: 0, errorTag: 'missing-api-key' };
  const body = {
    email: input.email,
    segments: [input.segmentId],
    topics: input.topics,
  };
  let res: Response;
  try {
    res = await doFetch(`${BASE}/contacts`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorTag: err instanceof Error ? `network:${err.name}` : 'network',
    };
  }
  if (res.status >= 200 && res.status < 300) {
    let parsed: { id?: string } = {};
    try { parsed = (await res.json()) as { id?: string }; } catch { /* swallow */ }
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
      return { ok: false, status: res.status, errorTag: 'no-contact-id' };
    }
    return { ok: true, status: res.status, contactId: parsed.id };
  }
  // Never surface the response body; only a status-tagged
  // error. Rate-limit awareness lives at the worker layer.
  try { await res.text(); } catch { /* swallow */ }
  return { ok: false, status: res.status, errorTag: `resend-${res.status}` };
}

// Update a contact's email (email drift). NEVER writes topics
// (that goes through the dedicated /topics sub-resource) and
// NEVER writes `unsubscribed`. Also does NOT write `segments` —
// PATCH /contacts/{id} does not document segments as a writable
// field, and segment membership is managed via the dedicated
// /contacts/{id}/segments/{segment_id} sub-resource instead.
export async function patchContactEmail(
  apiKey: string,
  input: PatchContactEmailInput,
  doFetch: FetchLike = fetch,
): Promise<SimpleResult> {
  if (!apiKey) return { ok: false, status: 0, errorTag: 'missing-api-key' };
  const body = {
    email: input.email,
  };
  let res: Response;
  try {
    res = await doFetch(`${BASE}/contacts/${encodeURIComponent(input.contactId)}`, {
      method: 'PATCH',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorTag: err instanceof Error ? `network:${err.name}` : 'network',
    };
  }
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status };
  }
  try { await res.text(); } catch { /* swallow */ }
  return { ok: false, status: res.status, errorTag: `resend-${res.status}` };
}

// Read a contact's current per-topic subscription state.
// Response shape (per Resend docs verified 2026-09-26):
//   { object: 'list', has_more: false,
//     data: [{id, name, description, subscription}, ...] }
export async function getContactTopics(
  apiKey: string,
  contactId: string,
  doFetch: FetchLike = fetch,
): Promise<TopicsResult> {
  if (!apiKey) return { ok: false, status: 0, data: [], errorTag: 'missing-api-key' };
  let res: Response;
  try {
    res = await doFetch(`${BASE}/contacts/${encodeURIComponent(contactId)}/topics`, {
      method: 'GET',
      headers: authHeaders(apiKey),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: [],
      errorTag: err instanceof Error ? `network:${err.name}` : 'network',
    };
  }
  if (res.status >= 200 && res.status < 300) {
    let parsed: { data?: Array<{ id?: string; subscription?: string }> } = {};
    try { parsed = (await res.json()) as typeof parsed; } catch { /* swallow */ }
    const data: TopicSubscription[] = [];
    for (const row of parsed.data ?? []) {
      if (
        typeof row.id === 'string' &&
        (row.subscription === 'opt_in' || row.subscription === 'opt_out')
      ) {
        data.push({ id: row.id, subscription: row.subscription });
      }
    }
    return { ok: true, status: res.status, data };
  }
  try { await res.text(); } catch { /* swallow */ }
  return { ok: false, status: res.status, data: [], errorTag: `resend-${res.status}` };
}

// Send the smallest corrective diff. Per Gate B, PATCH
// /contacts/{id}/topics is additive/merge: topics omitted from
// the body keep whatever subscription they had before, so we
// only include entries whose target subscription differs from
// current.
export async function patchContactTopics(
  apiKey: string,
  contactId: string,
  diff: TopicSubscription[],
  doFetch: FetchLike = fetch,
): Promise<SimpleResult> {
  if (!apiKey) return { ok: false, status: 0, errorTag: 'missing-api-key' };
  if (diff.length === 0) return { ok: true, status: 204 }; // no-op
  let res: Response;
  try {
    res = await doFetch(`${BASE}/contacts/${encodeURIComponent(contactId)}/topics`, {
      method: 'PATCH',
      headers: authHeaders(apiKey),
      body: JSON.stringify(diff),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorTag: err instanceof Error ? `network:${err.name}` : 'network',
    };
  }
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status };
  }
  try { await res.text(); } catch { /* swallow */ }
  return { ok: false, status: res.status, errorTag: `resend-${res.status}` };
}

// Read a contact's current segment memberships. Used to detect
// whether we need to add the contact to the Collector Network
// Contacts segment (idempotent add via the sub-resource below).
// Response shape (Resend docs verified 2026-09-26):
//   { object: 'list', has_more: boolean,
//     data: [{id, name, created_at}, ...] }
// We only care about the ids; other columns are dropped.
export async function getContactSegments(
  apiKey: string,
  contactId: string,
  doFetch: FetchLike = fetch,
): Promise<SegmentsResult> {
  if (!apiKey) return { ok: false, status: 0, data: [], errorTag: 'missing-api-key' };
  let res: Response;
  try {
    res = await doFetch(`${BASE}/contacts/${encodeURIComponent(contactId)}/segments`, {
      method: 'GET',
      headers: authHeaders(apiKey),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: [],
      errorTag: err instanceof Error ? `network:${err.name}` : 'network',
    };
  }
  if (res.status >= 200 && res.status < 300) {
    let parsed: { data?: Array<{ id?: string }> } = {};
    try { parsed = (await res.json()) as typeof parsed; } catch { /* swallow */ }
    const data: SegmentMembership[] = [];
    for (const row of parsed.data ?? []) {
      if (typeof row.id === 'string' && row.id.length > 0) {
        data.push({ segmentId: row.id });
      }
    }
    return { ok: true, status: res.status, data };
  }
  try { await res.text(); } catch { /* swallow */ }
  return { ok: false, status: res.status, data: [], errorTag: `resend-${res.status}` };
}

// Add a contact to a segment via the dedicated sub-resource.
// This is ADDITIVE: it never removes the contact from any other
// segment it already belongs to. That's exactly what we need to
// coexist with PokePrices' existing `General` segment membership.
// If the contact is already a member, Resend returns success.
export async function addContactToSegment(
  apiKey: string,
  contactId: string,
  segmentId: string,
  doFetch: FetchLike = fetch,
): Promise<SimpleResult> {
  if (!apiKey) return { ok: false, status: 0, errorTag: 'missing-api-key' };
  let res: Response;
  try {
    res = await doFetch(
      `${BASE}/contacts/${encodeURIComponent(contactId)}/segments/${encodeURIComponent(segmentId)}`,
      {
        method: 'POST',
        headers: authHeaders(apiKey),
      },
    );
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorTag: err instanceof Error ? `network:${err.name}` : 'network',
    };
  }
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status };
  }
  try { await res.text(); } catch { /* swallow */ }
  return { ok: false, status: res.status, errorTag: `resend-${res.status}` };
}

export const RESEND_CONTACTS_ENDPOINT = `${BASE}/contacts`;

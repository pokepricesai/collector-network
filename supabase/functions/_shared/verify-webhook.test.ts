import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSecret, verifyStandardWebhook } from './verify-webhook.ts';

const RAW_SECRET_BYTES = new Uint8Array([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
]);

// Encode the raw bytes back into the Supabase secret format.
function toSecretString(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return `v1,whsec_${btoa(bin)}`;
}

async function makeSignature(
  bytes: Uint8Array,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
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
  return btoa(bin);
}

const NOW = 1_700_000_000;

test('decodeSecret handles v1,whsec_ prefix', () => {
  const bytes = decodeSecret(toSecretString(RAW_SECRET_BYTES));
  assert.ok(bytes);
  assert.equal(bytes!.length, RAW_SECRET_BYTES.length);
});

test('decodeSecret rejects garbage', () => {
  assert.equal(decodeSecret('not-a-secret'), null);
  assert.equal(decodeSecret(''), null);
});

test('valid signature accepted', async () => {
  const body = '{"user":{"id":"u1"}}';
  const id = 'evt_123';
  const ts = String(NOW);
  const sig = 'v1,' + (await makeSignature(RAW_SECRET_BYTES, id, ts, body));
  const r = await verifyStandardWebhook(
    body,
    { id, timestamp: ts, signature: sig },
    toSecretString(RAW_SECRET_BYTES),
    { nowSeconds: () => NOW },
  );
  assert.equal(r.ok, true);
});

test('rotating: multiple space-separated signatures — any match wins', async () => {
  const body = '{"x":1}';
  const id = 'evt_rot';
  const ts = String(NOW);
  const good = 'v1,' + (await makeSignature(RAW_SECRET_BYTES, id, ts, body));
  const bad = 'v1,' + 'A'.repeat(44);
  const combined = `${bad} ${good}`;
  const r = await verifyStandardWebhook(
    body,
    { id, timestamp: ts, signature: combined },
    toSecretString(RAW_SECRET_BYTES),
    { nowSeconds: () => NOW },
  );
  assert.equal(r.ok, true);
});

test('signature mismatch rejected', async () => {
  const body = '{"x":1}';
  const id = 'evt_bad';
  const ts = String(NOW);
  const bad = 'v1,' + 'A'.repeat(44);
  const r = await verifyStandardWebhook(
    body,
    { id, timestamp: ts, signature: bad },
    toSecretString(RAW_SECRET_BYTES),
    { nowSeconds: () => NOW },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'signature-mismatch');
});

test('tampered body rejected (any byte flip)', async () => {
  const body = '{"x":1}';
  const id = 'evt_tamper';
  const ts = String(NOW);
  const sig = 'v1,' + (await makeSignature(RAW_SECRET_BYTES, id, ts, body));
  const r = await verifyStandardWebhook(
    body + ' ', // 1 byte added
    { id, timestamp: ts, signature: sig },
    toSecretString(RAW_SECRET_BYTES),
    { nowSeconds: () => NOW },
  );
  assert.equal(r.ok, false);
});

test('timestamp out of tolerance rejected (replay)', async () => {
  const body = '{"x":1}';
  const id = 'evt_replay';
  const oldTs = String(NOW - 10 * 60); // 10 minutes ago
  const sig = 'v1,' + (await makeSignature(RAW_SECRET_BYTES, id, oldTs, body));
  const r = await verifyStandardWebhook(
    body,
    { id, timestamp: oldTs, signature: sig },
    toSecretString(RAW_SECRET_BYTES),
    { nowSeconds: () => NOW },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'timestamp-out-of-range');
});

test('missing headers rejected', async () => {
  const r = await verifyStandardWebhook(
    '{"x":1}',
    { id: null, timestamp: null, signature: null },
    toSecretString(RAW_SECRET_BYTES),
    { nowSeconds: () => NOW },
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'missing-header');
});

test('malformed secret rejected', async () => {
  const r = await verifyStandardWebhook(
    '{"x":1}',
    { id: 'x', timestamp: String(NOW), signature: 'v1,abc' },
    'not-a-real-secret',
    { nowSeconds: () => NOW },
  );
  assert.equal(r.ok, false);
});

test('unknown signature version ignored (no partial match)', async () => {
  const body = '{"x":1}';
  const id = 'x';
  const ts = String(NOW);
  const good = await makeSignature(RAW_SECRET_BYTES, id, ts, body);
  // Attacker crafts an unknown version. Legit v1 sig is absent.
  const r = await verifyStandardWebhook(
    body,
    { id, timestamp: ts, signature: `v9,${good}` },
    toSecretString(RAW_SECRET_BYTES),
    { nowSeconds: () => NOW },
  );
  assert.equal(r.ok, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_OTP_TYPES,
  parseConfirmSearchParams,
  safeConfirmNext,
} from './confirm-params';

function q(input: Record<string, string>): URLSearchParams {
  return new URLSearchParams(input);
}

test('valid signup params parse cleanly', () => {
  const r = parseConfirmSearchParams(q({ token_hash: 'H_ABC', type: 'email', next: '/account' }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.tokenHash, 'H_ABC');
    assert.equal(r.type, 'email');
    assert.equal(r.next, '/account');
  }
});

test('missing token_hash rejected', () => {
  const r = parseConfirmSearchParams(q({ type: 'email', next: '/account' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'missing-token');
});

test('empty token_hash rejected', () => {
  const r = parseConfirmSearchParams(q({ token_hash: '', type: 'email', next: '/account' }));
  assert.equal(r.ok, false);
});

test('rejects type=signup (SDK-legal but not in our confirm allowlist)', () => {
  // Our edge function maps signup -> type=email, so type=signup
  // arriving here means someone (adversarial or misconfigured)
  // crafted the URL by hand. Reject.
  const r = parseConfirmSearchParams(q({ token_hash: 'H', type: 'signup', next: '/account' }));
  assert.equal(r.ok, false);
});

test('rejects unknown type', () => {
  const r = parseConfirmSearchParams(q({ token_hash: 'H', type: 'not-a-real-type', next: '/account' }));
  assert.equal(r.ok, false);
});

test('every mapped type accepted', () => {
  for (const t of ALLOWED_OTP_TYPES) {
    const r = parseConfirmSearchParams(q({ token_hash: 'H', type: t }));
    assert.equal(r.ok, true, `type=${t} should parse`);
  }
});

test('recovery routes to /account/reset-password when next supplied', () => {
  const r = parseConfirmSearchParams(q({
    token_hash: 'H',
    type: 'recovery',
    next: '/account/reset-password',
  }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.next, '/account/reset-password');
});

test('safeConfirmNext: protocol-relative // rejected', () => {
  assert.equal(safeConfirmNext('//evil.example/steal'), '/account');
});

test('safeConfirmNext: absolute URL rejected', () => {
  assert.equal(safeConfirmNext('https://evil.example/steal'), '/account');
});

test('safeConfirmNext: /auth/* prefix rejected', () => {
  assert.equal(safeConfirmNext('/auth/confirm?token_hash=x&type=recovery'), '/account');
  assert.equal(safeConfirmNext('/auth/callback'), '/account');
  assert.equal(safeConfirmNext('/auth/sign-out'), '/account');
});

test('safeConfirmNext: same-origin path passes through', () => {
  assert.equal(safeConfirmNext('/watchlist'), '/watchlist');
  assert.equal(safeConfirmNext('/decks/42'), '/decks/42');
});

test('safeConfirmNext: null/undefined → /account default', () => {
  assert.equal(safeConfirmNext(null), '/account');
  assert.equal(safeConfirmNext(undefined), '/account');
  assert.equal(safeConfirmNext(''), '/account');
});

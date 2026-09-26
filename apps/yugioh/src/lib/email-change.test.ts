import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayedAccountEmail,
  normaliseEmail,
  successMessageFor,
  validateNewEmail,
  validationErrorMessage,
  type ChangeEmailStatus,
} from './email-change';

// -- normaliseEmail -----------------------------------------------

test('normaliseEmail trims + lowercases', () => {
  assert.equal(normaliseEmail('  User@Example.COM  '), 'user@example.com');
  assert.equal(normaliseEmail(''), '');
  assert.equal(normaliseEmail(null), '');
  assert.equal(normaliseEmail(undefined), '');
});

// -- validateNewEmail: same-email rejection -----------------------

test('rejects exact same email as current', () => {
  const r = validateNewEmail('user@example.com', 'user@example.com');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'same-as-current');
});

test('rejects same-with-different-casing (case-insensitive match)', () => {
  const r = validateNewEmail('USER@EXAMPLE.COM', 'user@example.com');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'same-as-current');
});

test('rejects same-with-whitespace (trim before compare)', () => {
  const r = validateNewEmail('  user@example.com  ', 'user@example.com');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'same-as-current');
});

// -- validateNewEmail: invalid email ------------------------------

test('rejects empty input', () => {
  const r = validateNewEmail('', 'user@example.com');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'empty');
});

test('rejects whitespace-only input as empty', () => {
  const r = validateNewEmail('   ', 'user@example.com');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'empty');
});

test('rejects string with no @', () => {
  const r = validateNewEmail('notanemail', 'user@example.com');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid');
});

test('rejects missing TLD', () => {
  const r = validateNewEmail('user@localhost', 'user@example.com');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid');
});

test('rejects embedded whitespace', () => {
  const r = validateNewEmail('u ser@example.com', 'user@example.com');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid');
});

// -- validateNewEmail: success paths ------------------------------

test('accepts a well-formed new address', () => {
  const r = validateNewEmail('new@example.com', 'old@example.com');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.normalised, 'new@example.com');
});

test('returns normalised (trim + lowercase) form', () => {
  const r = validateNewEmail('  NEW@Example.com  ', 'old@example.com');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.normalised, 'new@example.com');
});

test('accepts a valid address when the user has no current email', () => {
  const r = validateNewEmail('new@example.com', null);
  assert.equal(r.ok, true);
});

// -- validationErrorMessage ---------------------------------------

test('error messages are user-friendly and non-sensitive', () => {
  assert.match(validationErrorMessage('empty'), /new email/i);
  assert.match(validationErrorMessage('invalid'), /valid email/i);
  assert.match(validationErrorMessage('same-as-current'), /already your account email/i);
});

// -- successMessageFor --------------------------------------------

test('success message names BOTH inboxes and asks for confirmation', () => {
  const msg = successMessageFor('old@example.com', 'new@example.com');
  assert.match(msg, /old@example\.com/);
  assert.match(msg, /new@example\.com/);
  assert.match(msg, /confirm/i);
});

test('success message never claims the email HAS changed', () => {
  const msg = successMessageFor('old@example.com', 'new@example.com');
  // Reject wording that would mislead the user into thinking the
  // account email flipped without confirmation.
  for (const bad of [
    /email\s+(has|is|was)\s+changed/i,
    /account.*updated/i,
    /you\s+are\s+now\s+/i,
  ]) {
    assert.equal(bad.test(msg), false, `success copy must not contain ${bad}`);
  }
});

test('success message normalises casing on both addresses', () => {
  const msg = successMessageFor(' OLD@ex.com ', ' NEW@ex.com ');
  assert.match(msg, /old@ex\.com/);
  assert.match(msg, /new@ex\.com/);
  assert.equal(msg.includes('OLD@ex.com'), false);
});

// -- displayedAccountEmail ----------------------------------------
//
// The account's real email must remain the ORIGINAL value across
// every status of the Secure Email Change flow — including after
// Supabase enqueues the confirmation emails. It only flips when
// both confirmations complete and Next.js re-renders /settings
// against a fresh `auth.getUser()`.

test('displayed email is the original in idle status', () => {
  const status: ChangeEmailStatus = { kind: 'idle' };
  assert.equal(displayedAccountEmail('user@example.com', status), 'user@example.com');
});

test('displayed email is the original while submitting', () => {
  const status: ChangeEmailStatus = { kind: 'submitting', pendingNewEmail: 'new@example.com' };
  assert.equal(displayedAccountEmail('user@example.com', status), 'user@example.com');
});

test('displayed email is STILL the original after Supabase accepts the request (success status)', () => {
  const status: ChangeEmailStatus = { kind: 'success', pendingNewEmail: 'new@example.com' };
  // Critical UX: Supabase accepting !== email changed. Both
  // inboxes must confirm first.
  assert.equal(displayedAccountEmail('user@example.com', status), 'user@example.com');
});

test('displayed email is the original after an error', () => {
  const status: ChangeEmailStatus = { kind: 'error', message: 'anything' };
  assert.equal(displayedAccountEmail('user@example.com', status), 'user@example.com');
});

test('displayed email handles missing original gracefully', () => {
  const status: ChangeEmailStatus = { kind: 'idle' };
  assert.equal(displayedAccountEmail(null, status), '');
  assert.equal(displayedAccountEmail(undefined, status), '');
});

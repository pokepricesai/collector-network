// Pure helpers for the "Change email" flow on /settings.
//
// Kept out of the client component so validation, normalisation,
// the success message and the displayed-current-email selector
// are all unit-testable without a React runtime.
//
// Behaviour lands on Supabase's Secure Email Change: a request
// enqueues confirmation emails to BOTH the current inbox and the
// new inbox. The account's real email does not change until both
// confirmations complete. This module makes that visible in the
// UI by keeping `originalEmail` as the source of truth for what
// we display, even after `supabase.auth.updateUser({email})`
// returns success.

export type EmailValidationResult =
  | { ok: true; normalised: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'same-as-current' };

// Very permissive shape check. Local part / domain / TLD each
// non-empty and free of whitespace + `@`. Server-side (Supabase)
// does the definitive check; this just catches obvious typos
// before the round-trip.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Trim + lowercase for comparison and for sending. Supabase
// normalises emails to lowercase on the server anyway, so lowering
// on the client keeps display/state consistent with what Supabase
// will store.
export function normaliseEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

export function validateNewEmail(
  input: string,
  currentEmail: string | null | undefined,
): EmailValidationResult {
  const normalised = normaliseEmail(input);
  if (normalised.length === 0) return { ok: false, reason: 'empty' };
  if (!EMAIL_SHAPE.test(normalised)) return { ok: false, reason: 'invalid' };
  if (normalised === normaliseEmail(currentEmail)) {
    return { ok: false, reason: 'same-as-current' };
  }
  return { ok: true, normalised };
}

// The state the form advances through. `success` deliberately
// carries `pendingNewEmail` (not "newEmail") — Supabase has only
// enqueued the confirmation emails; the account email has NOT
// changed yet. UX must reflect that.
export type ChangeEmailStatus =
  | { kind: 'idle' }
  | { kind: 'submitting'; pendingNewEmail: string }
  | { kind: 'success'; pendingNewEmail: string }
  | { kind: 'error'; message: string };

// Which email string to display as the account's current email.
// The account email never flips to the pending value until both
// Secure Email Change confirmations complete server-side; until
// then we keep showing the original.
export function displayedAccountEmail(
  originalEmail: string | null | undefined,
  _status: ChangeEmailStatus,
): string {
  return originalEmail ?? '';
}

// Copy for the success banner. Names both addresses so the user
// knows which two inboxes to check. Does NOT claim the change
// completed.
export function successMessageFor(
  currentEmail: string | null | undefined,
  pendingNewEmail: string,
): string {
  const current = normaliseEmail(currentEmail);
  const next = normaliseEmail(pendingNewEmail);
  return [
    `Check ${current} and ${next} to confirm the change.`,
    'Both inboxes need to confirm before your account email switches over.',
  ].join(' ');
}

// Translate a validation reason to a short accessible error
// message. Kept free of raw Supabase error text.
export function validationErrorMessage(
  reason: 'empty' | 'invalid' | 'same-as-current',
): string {
  switch (reason) {
    case 'empty':
      return 'Enter a new email address.';
    case 'invalid':
      return 'Enter a valid email address.';
    case 'same-as-current':
      return 'That is already your account email.';
  }
}

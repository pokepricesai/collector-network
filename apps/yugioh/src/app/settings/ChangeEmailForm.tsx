'use client';

// Change-email section for /settings.
//
// Uses the standard browser Supabase client — never the service
// role. Supabase's Secure Email Change is enabled on the shared
// project, so a successful `updateUser({ email })` enqueues two
// confirmation emails (current inbox + new inbox) via the CN-C
// hook. The account email does not change until both inboxes
// confirm; UX must reflect that.

import { useId, useMemo, useRef, useState } from 'react';
import { createBrowserSupabase } from '@collector-network/auth';
import {
  displayedAccountEmail,
  successMessageFor,
  validateNewEmail,
  validationErrorMessage,
  type ChangeEmailStatus,
} from '../../lib/email-change';
import styles from '../account/Account.module.css';

interface Props {
  // The user's current account email, read from the server-side
  // Supabase session and passed in by the /settings server
  // component. Kept read-only in this form.
  currentEmail: string | null;
}

export function ChangeEmailForm({ currentEmail }: Props) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<ChangeEmailStatus>({ kind: 'idle' });
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const inputId = useId();
  const statusId = useId();

  // Precomputed on every render so the button knows if the
  // current input is submittable. Not the same call we make on
  // submit — that one runs once, in the handler.
  const preflight = useMemo(
    () => validateNewEmail(input, currentEmail),
    [input, currentEmail],
  );

  // Text shown BELOW the input:
  //   - success message when Supabase has accepted the request
  //   - error message when Supabase or validation rejected
  //   - the disabled-reason (e.g. "already your account email")
  //     when the user's current input isn't submittable
  //   - nothing when idle + empty
  const statusMessage: { text: string; tone: 'notice' | 'error' } | null =
    status.kind === 'success'
      ? { text: successMessageFor(currentEmail, status.pendingNewEmail), tone: 'notice' }
      : status.kind === 'error'
      ? { text: status.message, tone: 'error' }
      : !preflight.ok && input.length > 0
      ? { text: validationErrorMessage(preflight.reason), tone: 'error' }
      : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === 'submitting') return; // guard duplicate submit
    const check = validateNewEmail(input, currentEmail);
    if (!check.ok) {
      // Reflect validation error inline and stop.
      setStatus({ kind: 'error', message: validationErrorMessage(check.reason) });
      return;
    }
    setStatus({ kind: 'submitting', pendingNewEmail: check.normalised });
    try {
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.updateUser({ email: check.normalised });
      if (error) throw error;
      setStatus({ kind: 'success', pendingNewEmail: check.normalised });
      // Move focus back to the submit button so the aria-live
      // status message is read after the button label change.
      submitRef.current?.focus();
      setInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message });
    }
  }

  const shownCurrent = displayedAccountEmail(currentEmail, status);
  const submitDisabled = status.kind === 'submitting' || !preflight.ok;
  const buttonLabel =
    status.kind === 'submitting'
      ? 'Requesting…'
      : status.kind === 'success'
      ? 'Confirmation emails sent'
      : 'Change email';

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <div className={styles.field}>
        <span className={styles.label}>Current email</span>
        <span
          style={{
            fontFamily: 'var(--ygo-font-mono)',
            fontSize: 13,
            color: 'var(--ygo-text-muted)',
            overflowWrap: 'anywhere',
          }}
        >
          {shownCurrent || '(no email on file)'}
        </span>
      </div>

      <p className={styles.sectionCaption} style={{ margin: 0 }}>
        This is the email used for your shared Collector Network
        account across our card sites. Changing it does not affect
        your marketing preferences.
      </p>

      <label className={styles.field} htmlFor={inputId}>
        <span className={styles.label}>New email</span>
        <input
          id={inputId}
          type="email"
          name="new-email"
          autoComplete="email"
          inputMode="email"
          required
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // Clear a prior success/error the moment the user
            // types again, so the button reflects the fresh input.
            if (status.kind === 'success' || status.kind === 'error') {
              setStatus({ kind: 'idle' });
            }
          }}
          aria-describedby={statusMessage ? statusId : undefined}
          aria-invalid={status.kind === 'error' || (!preflight.ok && input.length > 0)}
          className={styles.input}
        />
      </label>

      {statusMessage && (
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          className={statusMessage.tone === 'notice' ? styles.notice : styles.error}
        >
          {statusMessage.text}
        </p>
      )}

      <button
        ref={submitRef}
        type="submit"
        className={styles.submit}
        disabled={submitDisabled}
      >
        {buttonLabel}
      </button>
    </form>
  );
}

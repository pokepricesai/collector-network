import 'server-only';

function sanitize(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/^﻿/, '').replace(/^"|"$/g, '').trim();
}

export function getResendApiKey(): string {
  const v = sanitize(process.env['RESEND_API_KEY']);
  if (!v) throw new Error('[cn/emails] RESEND_API_KEY missing');
  return v;
}

export function getUnsubscribeSecret(): string {
  // Fall back to SUPABASE_SERVICE_ROLE_KEY so we don't require a
  // separate env var; the secret just needs to be stable and
  // non-public. We hash it into the token signature, never ship it.
  const explicit = sanitize(process.env['EMAIL_UNSUBSCRIBE_SECRET']);
  if (explicit) return explicit;
  const srk = sanitize(process.env['SUPABASE_SERVICE_ROLE_KEY']);
  if (!srk) throw new Error('[cn/emails] EMAIL_UNSUBSCRIBE_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set');
  return srk;
}

export function getPublicHubUrl(): string {
  return sanitize(process.env['NEXT_PUBLIC_HUB_URL']) || 'https://hub.collectornetwork.io';
}

// Hard safety switches so new flows do not auto-send to real users
// on first deploy. Each cron reads its own flag and no-ops when the
// flag is not literally 'true'. This preserves the spec's
// "Preserve currently working production email jobs throughout".
export function isScheduleOnboardingEnabled(): boolean {
  return sanitize(process.env['CN03_SCHEDULE_ONBOARDING_ENABLED']) === 'true';
}

export function isSendPendingEnabled(): boolean {
  return sanitize(process.env['CN03_SEND_PENDING_ENABLED']) === 'true';
}

export function isWeeklyDigestEnabled(): boolean {
  return sanitize(process.env['CN03_WEEKLY_DIGEST_ENABLED']) === 'true';
}

// When set, outbound sends are redirected to this address regardless
// of the recipient on the queue row. Used for staging / verification
// before enabling CN03_SEND_PENDING_ENABLED=true.
export function getEmailTestRedirect(): string | null {
  const v = sanitize(process.env['CN03_EMAIL_TEST_REDIRECT']);
  return v || null;
}

// Max rows per cron invocation. Keeps function duration bounded.
export const CRON_BATCH_LIMIT = Number(sanitize(process.env['CN03_CRON_BATCH_LIMIT']) || '50');
export const SEND_BATCH_LIMIT = Number(sanitize(process.env['CN03_SEND_BATCH_LIMIT']) || '25');

import 'server-only';
import { NextResponse } from 'next/server';
import {
  isScheduleOnboardingEnabled,
  isSendPendingEnabled,
  isWeeklyDigestEnabled,
} from '@/server/emails/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// CN-03 diagnostic. Returns ONLY booleans + length hints — never values.
// No auth needed; this leaks nothing sensitive. Deliberately shallow:
// reports what the deployed build thinks of the five flags so a config
// mismatch is immediately visible.

function sanitize(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/^﻿/, '').replace(/^"|"$/g, '').trim();
}

export async function GET() {
  const rawEnv = process.env['CN03_ONBOARDING_ELIGIBLE_AFTER'] ?? '';
  const cutoffRaw = sanitize(rawEnv);
  const parsedCutoff = cutoffRaw ? new Date(cutoffRaw) : null;
  const cutoffParses = !!(parsedCutoff && !isNaN(parsedCutoff.getTime()));
  const hubUrlRaw = sanitize(process.env['NEXT_PUBLIC_HUB_URL']);
  const rawHex = Buffer.from(rawEnv, 'utf8').subarray(0, 48).toString('hex');
  return NextResponse.json({
    ok: true,
    build: 'cn03-diag-2',
    schedule_onboarding_enabled: isScheduleOnboardingEnabled(),
    send_pending_enabled: isSendPendingEnabled(),
    weekly_digest_enabled: isWeeklyDigestEnabled(),
    cutoff_env_raw_length: rawEnv.length,
    cutoff_env_raw_hex: rawHex,
    cutoff_env_raw_echo: rawEnv.slice(0, 64),
    cutoff_sanitized: cutoffRaw.slice(0, 64),
    cutoff_sanitized_length: cutoffRaw.length,
    cutoff_parses: cutoffParses,
    cutoff_iso: cutoffParses ? parsedCutoff!.toISOString() : null,
    hub_url_present: hubUrlRaw.length > 0,
    hub_url_prefix: hubUrlRaw.slice(0, 32),
    node_env: process.env['NODE_ENV'] ?? null,
    vercel_env: process.env['VERCEL_ENV'] ?? null,
    vercel_git_commit_sha: (process.env['VERCEL_GIT_COMMIT_SHA'] ?? '').slice(0, 10) || null,
  });
}

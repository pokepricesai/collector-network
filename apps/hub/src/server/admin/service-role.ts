import 'server-only';

// Service-role Supabase client. Reserved for cron / background jobs
// that must bypass RLS (e.g. GSC + GA4 sync writes). NEVER expose
// this client to the browser; never ship the service-role key as a
// NEXT_PUBLIC_* variable.
//
// Routes using this helper MUST independently verify the caller is
// authorised — see `assertCronCaller()`.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function sanitize(v: string | undefined): string {
  if (!v) return '';
  // Vercel env imports via PowerShell can smuggle a UTF-8 BOM.
  return v.replace(/^﻿/, '').replace(/^"|"$/g, '').trim();
}

export function createServiceRoleSupabase(): SupabaseClient {
  const url = sanitize(process.env['NEXT_PUBLIC_SUPABASE_URL']);
  const key = sanitize(process.env['SUPABASE_SERVICE_ROLE_KEY']);
  if (!url) throw new Error('[cn/service-role] NEXT_PUBLIC_SUPABASE_URL missing');
  if (!key) throw new Error('[cn/service-role] SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-cn-caller': 'service-role' } },
  });
}

/** Verifies the caller holds the shared CRON_SECRET, either as a
 *  bearer token (Vercel Cron format) or `?secret=…`. Fails closed. */
export function assertCronCaller(req: Request): void {
  const expected = sanitize(process.env['CRON_SECRET']);
  if (!expected) {
    throw new Error('[cn/service-role] CRON_SECRET not configured');
  }
  const h = req.headers.get('authorization') ?? '';
  const bearer = h.toLowerCase().startsWith('bearer ')
    ? h.slice(7).trim()
    : '';
  const url = new URL(req.url);
  const q = url.searchParams.get('secret') ?? '';
  if (bearer !== expected && q !== expected) {
    throw new Error('[cn/service-role] invalid cron secret');
  }
}

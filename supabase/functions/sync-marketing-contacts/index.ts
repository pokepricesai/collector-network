// Supabase Edge Function: CN-D1 forward marketing sync worker.
//
// Invoked by pg_cron (steady state) or by preflightluke's manual
// backfill request. Reconciles Resend Contacts/Topics against
// Supabase's marketing preference state.
//
// Auth: rejects anything without a matching
//   `Authorization: Bearer $MARKETING_SYNC_TRIGGER_SECRET`
// header. Same gate for cron traffic AND the ?backfill=1 form —
// there is no publicly-invokable path.
//
// Deployed with `--no-verify-jwt` because pg_cron does not carry
// a Supabase JWT; we verify our own trigger secret instead.
//
// Environment (Supabase secrets, never in-repo):
//   MARKETING_RESEND_API_KEY        — Resend key for /contacts,
//                                     /topics writes.
//   MARKETING_SYNC_TRIGGER_SECRET   — Bearer secret gate.
//   SUPABASE_URL                    — auto-provided.
//   SUPABASE_SERVICE_ROLE_KEY       — auto-provided; used ONLY
//                                     for the internal @supabase
//                                     admin client.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_LAG_SECONDS,
  runReconcile,
  type ContactMapping,
  type ConsentEvent,
  type Cursor,
  type Preference,
  type SupabaseAdapter,
  type Topic,
} from '../_shared/sync-worker.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;

const BACKOFF_INITIAL_SECONDS = 60;

// Constant-time string compare — mirrors CN-C's verify-webhook.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSupabaseAdapter(sb: any): SupabaseAdapter {
  return {
    async getSegmentId() {
      const { data, error } = await sb
        .from('collector_marketing_config')
        .select('resend_segment_id')
        .eq('id', 'primary')
        .maybeSingle();
      if (error) throw error;
      return (data?.resend_segment_id as string | undefined) ?? null;
    },
    async getActiveTopics(): Promise<Topic[]> {
      const { data, error } = await sb
        .from('collector_marketing_topics')
        .select('scope, site_code, resend_topic_id, active, default_subscription')
        .eq('active', true);
      if (error) throw error;
      return (data ?? []).map((r: {
        scope: string;
        site_code: string | null;
        resend_topic_id: string;
        active: boolean;
        default_subscription: string;
      }) => ({
        scope: r.scope as 'site' | 'network',
        siteCode: r.site_code,
        resendTopicId: r.resend_topic_id,
        active: r.active,
        defaultSubscription: r.default_subscription as 'opt_in' | 'opt_out',
      }));
    },
    async getCursor(): Promise<Cursor> {
      const { data, error } = await sb
        .from('collector_marketing_sync_state')
        .select('last_event_occurred_at, last_event_id')
        .eq('id', 'primary')
        .maybeSingle();
      if (error) throw error;
      return {
        occurredAt: (data?.last_event_occurred_at as string | null) ?? null,
        eventId: (data?.last_event_id as string | null) ?? null,
      };
    },
    async getEventsSince(cursor, limit, lagSeconds): Promise<ConsentEvent[]> {
      // The composite-cursor query below is expressed as raw
      // SQL via RPC because the JS builder doesn't support
      // row-tuple comparison natively. The RPC is
      // collector_marketing_events_since (SECURITY DEFINER,
      // read-only, no side effects) — installed alongside the
      // schema migration.
      const { data, error } = await sb.rpc('collector_marketing_events_since', {
        p_last_occurred_at: cursor.occurredAt,
        p_last_event_id:    cursor.eventId,
        p_lag_seconds:      lagSeconds,
        p_limit:            limit,
      });
      if (error) throw error;
      return (data ?? []).map((r: {
        id: string;
        user_id: string;
        occurred_at: string;
      }) => ({
        id: r.id,
        userId: r.user_id,
        occurredAt: r.occurred_at,
      }));
    },
    async getUsersDueForRetry(nowIso, limit) {
      const { data, error } = await sb
        .from('collector_marketing_sync_failures')
        .select('user_id')
        .lte('next_retry_at', nowIso)
        .order('next_retry_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    },
    async getUsersWithAnyPreference(limit, afterUserId) {
      let query = sb
        .from('collector_marketing_preferences')
        .select('user_id')
        .order('user_id', { ascending: true })
        .limit(limit);
      if (afterUserId) query = query.gt('user_id', afterUserId);
      const { data, error } = await query;
      if (error) throw error;
      // Distinct isn't a first-class Postgrest feature; we dedup
      // on the client side. Row volume is small enough that this
      // is fine at CN-D1 launch (a handful of opted-in users).
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of (data ?? []) as Array<{ user_id: string }>) {
        if (!seen.has(r.user_id)) { seen.add(r.user_id); out.push(r.user_id); }
      }
      return out;
    },
    async getEmailForUser(userId) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error) return null;
      return data?.user?.email ?? null;
    },
    async getPreferencesForUser(userId): Promise<Preference[]> {
      const { data, error } = await sb
        .from('collector_marketing_preferences')
        .select('user_id, scope, site_code, email_opt_in')
        .eq('user_id', userId);
      if (error) throw error;
      return ((data ?? []) as Array<{
        user_id: string; scope: string; site_code: string | null; email_opt_in: boolean;
      }>).map((r) => ({
        userId:    r.user_id,
        scope:     r.scope as 'site' | 'network',
        siteCode:  r.site_code,
        emailOptIn: r.email_opt_in,
      }));
    },
    async getContactMapping(userId): Promise<ContactMapping | null> {
      const { data, error } = await sb
        .from('collector_marketing_contacts')
        .select('user_id, resend_contact_id, synced_email')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        userId: data.user_id,
        resendContactId: data.resend_contact_id,
        syncedEmail: data.synced_email,
      };
    },
    async insertContactMapping(m) {
      const { error } = await sb
        .from('collector_marketing_contacts')
        .upsert({
          user_id: m.userId,
          resend_contact_id: m.resendContactId,
          synced_email: m.syncedEmail,
          last_sync_status: 'ok',
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    async updateContactMappingEmail(userId, syncedEmail) {
      const { error } = await sb
        .from('collector_marketing_contacts')
        .update({ synced_email: syncedEmail, last_synced_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (error) throw error;
    },
    async markSyncSuccess(userId) {
      // Bump last_synced_at + clear any prior failure.
      const { error: e1 } = await sb
        .from('collector_marketing_contacts')
        .update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: 'ok',
        })
        .eq('user_id', userId);
      if (e1) throw e1;
      await sb.from('collector_marketing_sync_failures')
        .delete().eq('user_id', userId);
    },
    async recordSyncFailure(userId, errorTag, nowIso) {
      // Increment attempts server-side via RPC so we don't race.
      const { error } = await sb.rpc('collector_marketing_sync_record_failure', {
        p_user_id:               userId,
        p_error_tag:             errorTag.slice(0, 200),
        p_now:                   nowIso,
        p_initial_backoff_seconds: BACKOFF_INITIAL_SECONDS,
      });
      if (error) throw error;
    },
    async advanceCursor(next) {
      const { error } = await sb
        .from('collector_marketing_sync_state')
        .update({
          last_event_occurred_at: next.occurredAt,
          last_event_id:          next.eventId,
          last_run_at:            new Date().toISOString(),
          last_error:             null,
        })
        .eq('id', 'primary');
      if (error) throw error;
    },
    async updateCursorRunAt(nowIso) {
      const { error } = await sb
        .from('collector_marketing_sync_state')
        .update({ last_run_at: nowIso })
        .eq('id', 'primary');
      if (error) throw error;
    },
  };
}

Deno.serve(async (req: Request) => {
  // Method gate.
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  // Auth gate — same for cron traffic AND backfill invocations.
  const triggerSecret = Deno.env.get('MARKETING_SYNC_TRIGGER_SECRET') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  if (!triggerSecret || !authHeader.startsWith('Bearer ')) {
    return new Response('unauthorized', { status: 401 });
  }
  if (!constantTimeEqual(authHeader.slice('Bearer '.length), triggerSecret)) {
    return new Response('unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const backfill = url.searchParams.get('backfill') === '1';

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendKey  = Deno.env.get('MARKETING_RESEND_API_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return new Response('missing supabase env', { status: 500 });
  }
  if (!resendKey) {
    return new Response('missing resend key', { status: 500 });
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const summary = await runReconcile({
    supabase: makeSupabaseAdapter(sb),
    resendApiKey: resendKey,
    doFetch: fetch,
    backfill,
    batchSize: DEFAULT_BATCH_SIZE,
    lagSeconds: DEFAULT_LAG_SECONDS,
  });

  // Log tag-only summary. No PII, no tokens, no emails.
  console.log(JSON.stringify({
    kind: 'sync-marketing-contacts',
    backfill,
    processed: summary.processed,
    succeeded: summary.succeeded,
    failed: summary.failed,
    noop: summary.noop,
    cursorAdvanced: summary.cursorAdvanced,
    ...(summary.errorTag ? { errorTag: summary.errorTag } : {}),
  }));

  const status = summary.errorTag ? 500 : 200;
  return new Response(JSON.stringify(summary), {
    status,
    headers: { 'content-type': 'application/json' },
  });
});

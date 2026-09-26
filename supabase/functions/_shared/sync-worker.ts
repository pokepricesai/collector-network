// CN-D1 forward-sync reconciliation worker.
//
// Pure orchestration: takes a SupabaseAdapter + a FetchLike +
// the Resend API key and reconciles Resend Contacts/Topics
// against Supabase truth. All Supabase I/O goes through the
// adapter so this module runs unchanged under both Deno (edge
// function) and Node (unit tests).
//
// Invariants (folded in from cn-d1-review.md amendments):
//   - Supabase is the source of truth. Every cycle reads
//     current preferences; never blindly replays events.
//   - Missing preference row = do NOT touch that topic. Absence
//     is not opt-out. No fabrication.
//   - `unsubscribed` is NEVER written by forward sync.
//   - Cursor is composite (last_event_occurred_at,
//     last_event_id) with a read-lag; concurrent-timestamp
//     writes have committed by the time we read them.
//   - Per-user checkpointing: contact mapping + failure/success
//     bookkeeping happens as we process each user, so a crash
//     mid-batch produces zero data loss on the next cycle.
//   - Backfill iterates ONLY users with actual preference rows.
//     CN-A membership never causes a Resend Contact to be
//     created on its own.

import {
  createContact,
  getContactTopics,
  patchContactEmail,
  patchContactTopics,
  type FetchLike,
  type TopicSubscription,
} from './resend-contacts.ts';

// ── Types shared with the Supabase adapter ──────────────────────

export interface Cursor {
  occurredAt: string | null; // ISO 8601 timestamptz
  eventId: string | null;    // UUID string
}

export interface ConsentEvent {
  id: string;
  userId: string;
  occurredAt: string;
}

export interface Preference {
  userId: string;
  scope: 'site' | 'network';
  siteCode: string | null;
  emailOptIn: boolean;
}

export interface Topic {
  scope: 'site' | 'network';
  siteCode: string | null;
  resendTopicId: string;
  active: boolean;
  defaultSubscription: 'opt_in' | 'opt_out';
}

export interface ContactMapping {
  userId: string;
  resendContactId: string;
  syncedEmail: string;
}

export interface SupabaseAdapter {
  getSegmentId(): Promise<string | null>;
  getActiveTopics(): Promise<Topic[]>;
  getCursor(): Promise<Cursor>;
  // Events since (occurred_at, id::text) > cursor,
  // AND occurred_at < now - lagSeconds.
  getEventsSince(
    cursor: Cursor,
    limit: number,
    lagSeconds: number,
  ): Promise<ConsentEvent[]>;
  getUsersDueForRetry(nowIso: string, limit: number): Promise<string[]>;
  // Backfill mode ONLY: distinct user_ids that have any row in
  // collector_marketing_preferences. Membership is not consent —
  // this NEVER queries collector_user_sites.
  getUsersWithAnyPreference(limit: number, afterUserId: string | null): Promise<string[]>;
  getEmailForUser(userId: string): Promise<string | null>;
  getPreferencesForUser(userId: string): Promise<Preference[]>;
  getContactMapping(userId: string): Promise<ContactMapping | null>;
  insertContactMapping(mapping: ContactMapping): Promise<void>;
  updateContactMappingEmail(userId: string, syncedEmail: string): Promise<void>;
  markSyncSuccess(userId: string): Promise<void>;
  recordSyncFailure(userId: string, errorTag: string, nowIso: string, backoffSeconds: number): Promise<void>;
  advanceCursor(next: Cursor): Promise<void>;
  updateCursorRunAt(nowIso: string): Promise<void>;
}

// ── Result types ────────────────────────────────────────────────

export interface Summary {
  processed: number;
  succeeded: number;
  failed: number;
  noop: number;         // users with no active-topic preferences (skipped)
  backfill: boolean;
  cursorAdvanced: boolean;
  errorTag?: string;    // set on top-level failure (e.g. missing segment)
}

// ── Constants ───────────────────────────────────────────────────

export const DEFAULT_BATCH_SIZE = 100;
// Read lag ensures concurrent-timestamp INSERTs have committed
// before we read them. Small enough to keep p99 sync latency
// under ~10s at the 1-min cron cadence.
export const DEFAULT_LAG_SECONDS = 5;
// Backoff: 60s, 120s, 240s, ... capped at 1h. Fresh failures
// (attempts=1) wait ~60s before retry.
export function backoffSeconds(attempts: number): number {
  const s = 60 * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(s, 3600);
}

// Tag-only error extractor. Never leaks PII or provider bodies.
function toErrorTag(input: unknown): string {
  if (typeof input === 'string') return input.length > 40 ? input.slice(0, 40) : input;
  if (input && typeof input === 'object' && 'errorTag' in input && typeof (input as { errorTag?: unknown }).errorTag === 'string') {
    return (input as { errorTag: string }).errorTag;
  }
  if (input instanceof Error) return `error:${input.name}`;
  return 'unknown';
}

// Normalise emails identically to CN-C's email-change lib and
// Resend's own server-side storage: trim + lowercase.
function normaliseEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

// Match a topic against a preference row. Site topics match by
// scope+site_code; the network topic matches the single row where
// scope='network' and site_code is null.
function findPreference(prefs: Preference[], topic: Topic): Preference | undefined {
  return prefs.find(
    (p) => p.scope === topic.scope && (p.siteCode ?? null) === (topic.siteCode ?? null),
  );
}

// Compute the target topic subscription vector for a user.
//   - Only includes topics the user has an explicit preference
//     row for. Missing preference => topic omitted entirely
//     (not fabricated as opt_out).
export function computeTarget(
  prefs: Preference[],
  activeTopics: Topic[],
): TopicSubscription[] {
  const out: TopicSubscription[] = [];
  for (const t of activeTopics) {
    const p = findPreference(prefs, t);
    if (!p) continue; // no preference recorded → do not touch
    out.push({
      id: t.resendTopicId,
      subscription: p.emailOptIn ? 'opt_in' : 'opt_out',
    });
  }
  return out;
}

// Compute the smallest corrective diff (Gate B: additive PATCH).
// Only include topic entries where target[id] differs from
// current[id]. Topics present in target but missing from current
// are always included (Resend hasn't seen them yet).
export function computeDiff(
  target: TopicSubscription[],
  current: TopicSubscription[],
): TopicSubscription[] {
  const cur = new Map<string, 'opt_in' | 'opt_out'>();
  for (const c of current) cur.set(c.id, c.subscription);
  const diff: TopicSubscription[] = [];
  for (const t of target) {
    const before = cur.get(t.id);
    if (before !== t.subscription) diff.push(t);
  }
  return diff;
}

// ── Per-user sync ───────────────────────────────────────────────

export interface SyncUserContext {
  supabase: SupabaseAdapter;
  resendApiKey: string;
  doFetch: FetchLike;
  segmentId: string;
  activeTopics: Topic[];
}

export type SyncUserOutcome =
  | { kind: 'success' }
  | { kind: 'noop' } // user has no preferences on any active topic
  | { kind: 'failure'; errorTag: string };

export async function syncUser(
  userId: string,
  ctx: SyncUserContext,
): Promise<SyncUserOutcome> {
  // 1. Supabase truth.
  const email = await ctx.supabase.getEmailForUser(userId);
  if (!email) return { kind: 'noop' }; // user deleted; cascade will clean mapping
  const emailNorm = normaliseEmail(email);

  const prefs = await ctx.supabase.getPreferencesForUser(userId);
  const target = computeTarget(prefs, ctx.activeTopics);
  if (target.length === 0) {
    // No preferences on any active topic. Skip. Do not create a
    // contact and do not touch existing state. Absence is not
    // opt-out.
    return { kind: 'noop' };
  }

  // 2. Mapping row. If none, this is first-time sync for this
  //    user: POST + insert mapping in one round-trip.
  const mapping = await ctx.supabase.getContactMapping(userId);
  if (!mapping) {
    const created = await createContact(
      ctx.resendApiKey,
      { email: emailNorm, segmentId: ctx.segmentId, topics: target },
      ctx.doFetch,
    );
    if (!created.ok || !created.contactId) {
      return { kind: 'failure', errorTag: toErrorTag(created) };
    }
    await ctx.supabase.insertContactMapping({
      userId,
      resendContactId: created.contactId,
      syncedEmail: emailNorm,
    });
    await ctx.supabase.markSyncSuccess(userId);
    return { kind: 'success' };
  }

  // 3. Email drift: patch email on the existing contact BEFORE
  //    reading topic state, so subsequent topic writes hit the
  //    right identity.
  if (mapping.syncedEmail !== emailNorm) {
    const patched = await patchContactEmail(
      ctx.resendApiKey,
      { contactId: mapping.resendContactId, email: emailNorm, segmentId: ctx.segmentId },
      ctx.doFetch,
    );
    if (!patched.ok) {
      // 404: contact was deleted externally. Recreate.
      if (patched.status === 404) {
        return await recreateAfter404(userId, emailNorm, target, ctx);
      }
      return { kind: 'failure', errorTag: toErrorTag(patched) };
    }
    await ctx.supabase.updateContactMappingEmail(userId, emailNorm);
  }

  // 4. Current topic state on Resend.
  const current = await getContactTopics(
    ctx.resendApiKey,
    mapping.resendContactId,
    ctx.doFetch,
  );
  if (!current.ok) {
    if (current.status === 404) {
      return await recreateAfter404(userId, emailNorm, target, ctx);
    }
    return { kind: 'failure', errorTag: toErrorTag(current) };
  }

  // 5. Diff and write only what differs.
  const diff = computeDiff(target, current.data);
  if (diff.length > 0) {
    const patched = await patchContactTopics(
      ctx.resendApiKey,
      mapping.resendContactId,
      diff,
      ctx.doFetch,
    );
    if (!patched.ok) {
      if (patched.status === 404) {
        return await recreateAfter404(userId, emailNorm, target, ctx);
      }
      return { kind: 'failure', errorTag: toErrorTag(patched) };
    }
  }

  await ctx.supabase.markSyncSuccess(userId);
  return { kind: 'success' };
}

async function recreateAfter404(
  userId: string,
  email: string,
  target: TopicSubscription[],
  ctx: SyncUserContext,
): Promise<SyncUserOutcome> {
  const created = await createContact(
    ctx.resendApiKey,
    { email, segmentId: ctx.segmentId, topics: target },
    ctx.doFetch,
  );
  if (!created.ok || !created.contactId) {
    return { kind: 'failure', errorTag: toErrorTag(created) };
  }
  // Upsert semantics: reuse insertContactMapping which the
  // adapter implements as an INSERT ... ON CONFLICT (user_id)
  // DO UPDATE.
  await ctx.supabase.insertContactMapping({
    userId,
    resendContactId: created.contactId,
    syncedEmail: email,
  });
  await ctx.supabase.markSyncSuccess(userId);
  return { kind: 'success' };
}

// ── Top-level reconcile loop ────────────────────────────────────

export interface RunInput {
  supabase: SupabaseAdapter;
  resendApiKey: string;
  doFetch: FetchLike;
  backfill?: boolean;
  nowIso?: string;
  batchSize?: number;
  lagSeconds?: number;
}

export async function runReconcile(input: RunInput): Promise<Summary> {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const lagSeconds = input.lagSeconds ?? DEFAULT_LAG_SECONDS;
  const backfill = input.backfill === true;

  const segmentId = await input.supabase.getSegmentId();
  if (!segmentId) {
    return { processed: 0, succeeded: 0, failed: 0, noop: 0, backfill, cursorAdvanced: false, errorTag: 'missing-segment-config' };
  }
  const activeTopics = await input.supabase.getActiveTopics();
  if (activeTopics.length === 0) {
    // No topics configured yet — nothing to sync.
    if (!backfill) await input.supabase.updateCursorRunAt(nowIso);
    return { processed: 0, succeeded: 0, failed: 0, noop: 0, backfill, cursorAdvanced: false, errorTag: 'no-active-topics' };
  }

  // Build the user set to process.
  const usersToSync: string[] = [];
  let events: ConsentEvent[] = [];
  let batchMax: Cursor | null = null;

  if (backfill) {
    // Amendment 1: iterate ONLY users with actual preference
    // rows. Membership is not consent.
    const users = await input.supabase.getUsersWithAnyPreference(batchSize, null);
    usersToSync.push(...users);
  } else {
    const cursor = await input.supabase.getCursor();
    events = await input.supabase.getEventsSince(cursor, batchSize, lagSeconds);

    // Amendment 3: composite cursor advancement. Compute the
    // batch max by (occurred_at, id::text) — total ordering.
    for (const ev of events) {
      if (
        batchMax === null ||
        ev.occurredAt > (batchMax.occurredAt ?? '') ||
        (ev.occurredAt === batchMax.occurredAt && ev.id > (batchMax.eventId ?? ''))
      ) {
        batchMax = { occurredAt: ev.occurredAt, eventId: ev.id };
      }
    }

    // Users due for retry are processed in the same cycle so
    // failures don't wait for the next event.
    const retryUsers = await input.supabase.getUsersDueForRetry(nowIso, batchSize);
    const seen = new Set<string>();
    for (const ev of events) {
      if (!seen.has(ev.userId)) { seen.add(ev.userId); usersToSync.push(ev.userId); }
    }
    for (const uid of retryUsers) {
      if (!seen.has(uid)) { seen.add(uid); usersToSync.push(uid); }
    }
  }

  const ctx: SyncUserContext = {
    supabase: input.supabase,
    resendApiKey: input.resendApiKey,
    doFetch: input.doFetch,
    segmentId,
    activeTopics,
  };

  let succeeded = 0;
  let failed = 0;
  let noop = 0;

  for (const userId of usersToSync) {
    let outcome: SyncUserOutcome;
    try {
      outcome = await syncUser(userId, ctx);
    } catch (err) {
      outcome = { kind: 'failure', errorTag: toErrorTag(err) };
    }
    if (outcome.kind === 'success') {
      succeeded++;
    } else if (outcome.kind === 'noop') {
      noop++;
    } else {
      failed++;
      // Read attempts on the failure row so backoff grows across
      // cycles. Adapter is responsible for the upsert increment.
      await input.supabase.recordSyncFailure(
        userId,
        outcome.errorTag,
        nowIso,
        backoffSeconds(1), // adapter increments attempts and recomputes
      );
    }
  }

  // Cursor advancement. Only in non-backfill mode, and only if
  // we processed events. Advances to batchMax regardless of
  // per-user outcome: failed users are covered by
  // `sync_failures` retries. This satisfies "a failed batch
  // must not skip unreconciled users" because failed users are
  // tracked separately, and the composite cursor never skips
  // over concurrently-timestamped events (row-tuple comparison
  // gives a total order, and the read-lag ensures visibility).
  let cursorAdvanced = false;
  if (!backfill) {
    if (batchMax) {
      await input.supabase.advanceCursor(batchMax);
      cursorAdvanced = true;
    } else {
      await input.supabase.updateCursorRunAt(nowIso);
    }
  }

  return {
    processed: usersToSync.length,
    succeeded,
    failed,
    noop,
    backfill,
    cursorAdvanced,
  };
}

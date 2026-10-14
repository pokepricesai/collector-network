import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrandSiteCode, TemplateKey, EmailCategory } from '@collector-network/email';

export interface EnqueueInput {
  userId: string | null;
  recipientEmail: string;
  siteCode: BrandSiteCode;
  templateKey: TemplateKey;
  category: EmailCategory;
  variables?: Record<string, unknown>;
  idempotencyKey: string;
  sendAfter?: Date;
}

export interface EnqueueResult {
  enqueued: boolean;
  duplicate: boolean;
  queueId?: string;
  error?: string;
}

export async function enqueue(admin: SupabaseClient, input: EnqueueInput): Promise<EnqueueResult> {
  const row = {
    user_id: input.userId,
    recipient_email: input.recipientEmail.trim().toLowerCase(),
    site_code: input.siteCode,
    template_key: input.templateKey,
    category: input.category,
    variables: input.variables ?? {},
    idempotency_key: input.idempotencyKey,
    send_after: (input.sendAfter ?? new Date()).toISOString(),
    status: 'pending' as const,
  };
  const { data, error } = await admin
    .from('collector_email_queue')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    // Unique violation on idempotency_key → treat as duplicate (no-op).
    if (error.code === '23505') return { enqueued: false, duplicate: true };
    return { enqueued: false, duplicate: false, error: error.message };
  }
  return { enqueued: true, duplicate: false, queueId: (data as { id: string }).id };
}

export interface QueueRow {
  id: string;
  user_id: string | null;
  recipient_email: string;
  site_code: BrandSiteCode;
  template_key: TemplateKey;
  category: EmailCategory;
  variables: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
}

// Reset rows stuck in 'sending' back to 'pending' so the next tick
// retries. Safety: our Resend send always carries the queue row's
// idempotency_key as the HTTP Idempotency-Key header, so a retry
// after a Vercel-timeout-mid-send does NOT duplicate at Resend —
// Resend returns the same email id without re-dispatching.
export async function reclaimStaleSending(
  admin: SupabaseClient,
  olderThanSeconds: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
  const { data, error } = await admin
    .from('collector_email_queue')
    .update({ status: 'pending' })
    .eq('status', 'sending')
    .lt('updated_at', cutoff)
    .select('id');
  if (error || !data) return 0;
  return (data as { id: string }[]).length;
}

export async function claimPendingBatch(
  admin: SupabaseClient,
  limit: number,
): Promise<QueueRow[]> {
  // Simple two-step claim: fetch N pending ids due now, then update to
  // 'sending' and return. Concurrency is bounded because only one
  // cron invocation runs at a time (Vercel Cron). We also increment
  // attempts here so a crash mid-send doesn't re-send forever.
  const nowIso = new Date().toISOString();
  const { data: candidates, error: selErr } = await admin
    .from('collector_email_queue')
    .select('id, attempts')
    .eq('status', 'pending')
    .lte('send_after', nowIso)
    .order('send_after', { ascending: true })
    .limit(limit);
  if (selErr || !candidates || candidates.length === 0) return [];
  const rows = candidates as { id: string; attempts: number }[];
  const claimed: QueueRow[] = [];
  for (const row of rows) {
    const next = (row.attempts ?? 0) + 1;
    const { data: upd, error: updErr } = await admin
      .from('collector_email_queue')
      .update({ status: 'sending', attempts: next })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id,user_id,recipient_email,site_code,template_key,category,variables,idempotency_key,attempts')
      .maybeSingle();
    if (!updErr && upd) claimed.push(upd as QueueRow);
  }
  return claimed;
}

export async function markSent(
  admin: SupabaseClient,
  id: string,
  resendEmailId: string,
): Promise<void> {
  await admin
    .from('collector_email_queue')
    .update({
      status: 'sent',
      resend_email_id: resendEmailId,
      sent_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', id);
}

export async function markFailed(
  admin: SupabaseClient,
  id: string,
  err: string,
  retry: boolean,
): Promise<void> {
  await admin
    .from('collector_email_queue')
    .update({
      status: retry ? 'pending' : 'failed',
      last_error: err.slice(0, 500),
      send_after: retry ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : undefined,
    })
    .eq('id', id);
}

export async function markSkipped(
  admin: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  await admin
    .from('collector_email_queue')
    .update({ status: 'skipped', skipped_reason: reason })
    .eq('id', id);
}

export async function markSuppressed(
  admin: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  await admin
    .from('collector_email_queue')
    .update({ status: 'suppressed', skipped_reason: reason })
    .eq('id', id);
}

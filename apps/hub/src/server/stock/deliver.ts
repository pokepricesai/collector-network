import 'server-only';

// CN-STOCK-02 · outbox delivery worker.
//
// Per cron fire:
//   1. SELECT rows where status in (pending, failed_retryable)
//      AND next_attempt_at <= now().
//   2. For each: mark `sending`, POST to Discord, classify the
//      outcome, update the row.
//   3. Timeouts → status='timeout_ambiguous' + NO retry (the brief
//      explicitly forbids presuming non-delivery on client timeout).
//   4. Retryable errors → schedule next_attempt_at with exponential
//      backoff (or honour Retry-After for 429).
//   5. Permanent failures → status='failed_permanent', visible on
//      admin Jobs for operator intervention.

import type { SupabaseClient } from '@supabase/supabase-js';
import { nextRetryDelayMs, sendDiscord } from './discord';
import type { OutboxRow } from './types';

export interface DeliverOutcome {
  outbox_id: string;
  event_id: string;
  target: string;
  attempt_count: number;
  result: string;
  next_attempt_at: string | null;
}

export interface DeliverySummary {
  fired_at: string;
  processed: number;
  delivered: number;
  retryable: number;
  permanent: number;
  ambiguous: number;
  skipped_config_missing: number;
  outcomes: DeliverOutcome[];
  errors: string[];
  duration_ms: number;
}

export async function runDelivery(
  sb: SupabaseClient,
  options: {
    batch_cap?: number;
    now?: Date;
  } = {},
): Promise<DeliverySummary> {
  const started = Date.now();
  const nowDate = options.now ?? new Date();
  const nowIso = nowDate.toISOString();
  const batchCap = options.batch_cap ?? 25;

  const { data, error } = await sb.from('cn_stock_outbox')
    .select('*')
    .in('status', ['pending', 'failed_retryable'])
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(batchCap);
  if (error) {
    return {
      fired_at: nowIso,
      processed: 0,
      delivered: 0,
      retryable: 0,
      permanent: 0,
      ambiguous: 0,
      skipped_config_missing: 0,
      outcomes: [],
      errors: [`outbox_read: ${error.message}`],
      duration_ms: Date.now() - started,
    };
  }

  const rows = (data ?? []) as OutboxRow[];
  const outcomes: DeliverOutcome[] = [];
  const errors: string[] = [];
  let delivered = 0;
  let retryable = 0;
  let permanent = 0;
  let ambiguous = 0;
  let skippedConfigMissing = 0;

  for (const row of rows) {
    // Mark sending so concurrent runs don't double-send.
    const { error: lockErr, data: locked } = await sb.from('cn_stock_outbox')
      .update({ status: 'sending', last_attempted_at: nowIso, attempt_count: row.attempt_count + 1 })
      .eq('id', row.id)
      .eq('status', row.status)  // CAS: only lock if status unchanged
      .select('id')
      .maybeSingle();
    if (lockErr) {
      errors.push(`${row.id} lock: ${lockErr.message}`);
      continue;
    }
    if (!locked) {
      // Someone else grabbed it; move on.
      continue;
    }

    const sendResult = await sendDiscord(row.target, row.payload as { content: string }, { timeoutMs: 10_000 });

    let patch: Partial<OutboxRow>;
    switch (sendResult.kind) {
      case 'delivered':
        patch = {
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          last_error: null,
        };
        delivered += 1;
        break;
      case 'retryable':
        if (row.attempt_count + 1 >= row.max_attempts) {
          patch = {
            status: 'failed_permanent',
            last_error: `retry budget exhausted after ${row.attempt_count + 1} attempts: ${sendResult.summary}`,
          };
          permanent += 1;
        } else {
          const delay = nextRetryDelayMs(row.attempt_count + 1, sendResult.retry_after_ms);
          patch = {
            status: 'failed_retryable',
            next_attempt_at: new Date(nowDate.getTime() + delay).toISOString(),
            last_error: sendResult.summary,
          };
          retryable += 1;
        }
        break;
      case 'permanent':
        patch = { status: 'failed_permanent', last_error: sendResult.summary };
        permanent += 1;
        break;
      case 'timeout_ambiguous':
        // Brief: don't retry. Operator judges from the row + channel.
        patch = { status: 'timeout_ambiguous', last_error: sendResult.summary };
        ambiguous += 1;
        break;
      case 'config_missing':
        // Don't burn retries if the operator hasn't set up the
        // webhook yet. Revert to pending so a later cron picks
        // it up once the env var exists.
        patch = {
          status: 'pending',
          attempt_count: row.attempt_count,   // undo the +1
          last_error: sendResult.summary,
          next_attempt_at: new Date(nowDate.getTime() + 5 * 60_000).toISOString(),
        };
        skippedConfigMissing += 1;
        break;
    }

    const { error: updErr } = await sb.from('cn_stock_outbox').update(patch).eq('id', row.id);
    if (updErr) errors.push(`${row.id} update: ${updErr.message}`);

    outcomes.push({
      outbox_id: row.id,
      event_id: row.event_id,
      target: row.target,
      attempt_count: row.attempt_count + 1,
      result: sendResult.kind,
      next_attempt_at: patch.next_attempt_at ?? null,
    });
  }

  return {
    fired_at: nowIso,
    processed: rows.length,
    delivered,
    retryable,
    permanent,
    ambiguous,
    skipped_config_missing: skippedConfigMissing,
    outcomes,
    errors,
    duration_ms: Date.now() - started,
  };
}

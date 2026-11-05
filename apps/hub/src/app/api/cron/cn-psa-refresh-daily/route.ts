import 'server-only';

// CN-06.05-P03: PSA population refresh — daily Vercel cron.
//
// Schedule: 0 11 * * * (11:00 UTC), away from the 02:00-04:00 sync window
// and the 06:00-07:00 ingest/reporting windows. One fire per UTC day.
//
// Gating:
//   • CN_PSA_REFRESH_ENABLED=1       — hard feature flag; default off.
//   • PSA_PUBLIC_API_TOKEN present    — required or job exits as 'disabled'.
//   • CRON_SECRET bearer / ?secret    — standard Hub cron auth.
//
// Behaviour on cap/auth events:
//   • Atomic slot reservation via cn_psa_reserve_slots (hard cap 100).
//   • Halts the fire on 401/403/429; last_status recorded; no retries.
//   • Lock TTL 15 min so a stuck fire cannot block tomorrow.
//
// Writes:
//   • cn_psa_pop_latest  (upsert)
//   • cn_psa_pop_history (append-only, one row per spec/snapshot_date)
//   • cn_psa_candidates  (bump last_refresh_* + next_due_at)
//   • network_job_runs   (standard Hub audit via the existing RPC pair)

import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';
import { runOnce } from '@/server/psa/refresh';

export const runtime  = 'nodejs';
export const dynamic  = 'force-dynamic';
export const maxDuration = 180;

async function handle(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }
  const sb = createServiceRoleSupabase();

  // Hub audit row — standard pattern across every scheduled job.
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'psa.refresh.daily',
    p_job_type: 'ingest',
    p_site_id:  null,
    p_metadata: { trigger: 'cron' } as unknown as Record<string, unknown>,
  });

  let outcome;
  try {
    outcome = await runOnce(sb);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: 'failed',
      p_rows_examined: 0, p_rows_inserted: 0, p_rows_updated: 0, p_rows_rejected: 0,
      p_error_summary: msg.slice(0, 500),
      p_metadata: { trigger: 'cron', stage: 'runOnce_threw' } as unknown as Record<string, unknown>,
    });
    return NextResponse.json({ ok: false, error: msg.slice(0, 500) }, { status: 500 });
  }

  const status = (() => {
    switch (outcome.status) {
      case 'ok':           return 'success';
      case 'partial':      return 'warning';
      case 'disabled':
      case 'no_lock':
      case 'budget_exhausted':
      case 'no_candidates': return 'success'; // No-op completions are success for Hub audit.
      case 'halted_auth':
      case 'halted_rate_limit': return 'warning';
      default:              return 'warning';
    }
  })();

  await sb.rpc('network_complete_job_run', {
    p_id: jobId,
    p_status: status,
    p_rows_examined: outcome.requests_sent,
    p_rows_inserted: outcome.successes,
    p_rows_updated:  0,
    p_rows_rejected: outcome.failures,
    p_error_summary: outcome.halted_by ? `halted: ${outcome.halted_by}` : (outcome.reason ?? null),
    p_metadata: {
      trigger: 'cron',
      outcome_status:           outcome.status,
      reserved_slots:           outcome.reserved_slots,
      cohort_slots_target:      outcome.cohort_slots_target,
      first_time_slots_target:  outcome.first_time_slots_target,
      cohort_slots_used:        outcome.cohort_slots_used,
      first_time_slots_used:    outcome.first_time_slots_used,
      halt_retry_after:         outcome.halt_retry_after_seconds ?? null,
      per_item_errors:          outcome.per_item_errors.slice(0, 20),
    } as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true, outcome });
}

export async function GET(req: Request)  { return handle(req); }
export async function POST(req: Request) { return handle(req); }

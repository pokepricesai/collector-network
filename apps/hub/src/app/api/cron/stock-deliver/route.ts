import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { runDelivery } from '@/server/stock/deliver';

// CN-STOCK-02 · outbox delivery worker.
//
// Drains the cn_stock_outbox queue to Discord. Gated by the same
// STOCK_PROBE_ENABLED env var as the probe (simplifies activation
// — a single flag turns the whole pipeline on or off).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  try { assertCronCaller(req); } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 401 });
  }

  const enabled = process.env['STOCK_PROBE_ENABLED'] === '1';
  if (!enabled) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'STOCK_PROBE_ENABLED is not set to "1"; stock delivery worker is dormant',
    });
  }

  const sb = createServiceRoleSupabase();

  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'stock.deliver',
    p_job_type: 'sync',
    p_site_id: null,
    p_metadata: { trigger: 'cron' } as unknown as Record<string, unknown>,
  });

  const summary = await runDelivery(sb, { batch_cap: 25 });

  if (jobId) {
    const status = summary.errors.length === 0 ? 'success' : 'warning';
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: status,
      p_rows_examined: summary.processed,
      p_rows_inserted: 0,
      p_rows_updated: summary.processed,
      p_rows_rejected: summary.permanent,
      p_error_summary: summary.errors.slice(0, 3).join(' | ') || null,
      p_metadata: {
        duration_ms: summary.duration_ms,
        delivered: summary.delivered,
        retryable: summary.retryable,
        permanent: summary.permanent,
        ambiguous: summary.ambiguous,
        skipped_config_missing: summary.skipped_config_missing,
      } as unknown as Record<string, unknown>,
    });
  }

  return NextResponse.json({ ok: summary.errors.length === 0, ...summary }, {
    status: summary.errors.length === 0 ? 200 : 207,
  });
}

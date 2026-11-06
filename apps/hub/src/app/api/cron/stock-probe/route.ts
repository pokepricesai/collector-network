import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { runProbe } from '@/server/stock/probe';

// CN-STOCK-02 · scheduled stock probe.
//
// Fires on the Vercel cron schedule set in apps/hub/vercel.json.
// Gated OFF by default — the handler returns a no-op summary
// when STOCK_PROBE_ENABLED !== '1'.
//
// On successful run writes a row to network_job_runs (job_name=
// 'stock.probe') so the /admin/jobs page surfaces the invocation.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  try { assertCronCaller(req); } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 401 });
  }

  const enabled = process.env['STOCK_PROBE_ENABLED'] === '1';
  if (!enabled) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'STOCK_PROBE_ENABLED is not set to "1"; stock probe is dormant',
    });
  }

  const sb = createServiceRoleSupabase();
  const listingCap = Number(process.env['STOCK_PROBE_LISTING_CAP'] ?? '50');
  const perHostDelay = Number(process.env['STOCK_PROBE_PER_HOST_DELAY_MS'] ?? '3000');
  const target = process.env['STOCK_PROBE_TARGET'] ?? 'discord:test';

  // Register the job_run so the Jobs page shows this cron.
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'stock.probe',
    p_job_type: 'sync',
    p_site_id: null,
    p_metadata: { trigger: 'cron' } as unknown as Record<string, unknown>,
  });

  const summary = await runProbe(sb, {
    listing_cap: Number.isFinite(listingCap) ? listingCap : 50,
    per_host_delay_ms: Number.isFinite(perHostDelay) ? perHostDelay : 3000,
    target,
  });

  if (jobId) {
    const status = summary.errors.length === 0 ? 'success' : 'warning';
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: status,
      p_rows_examined: summary.listings_examined,
      p_rows_inserted: summary.events_emitted,
      p_rows_updated: summary.listings_examined,
      p_rows_rejected: 0,
      p_error_summary: summary.errors.slice(0, 3).join(' | ') || null,
      p_metadata: {
        duration_ms: summary.duration_ms,
        outcomes: summary.outcomes.map((o) => ({
          id: o.watchlist_id,
          state: o.observation_state,
          emitted_event: o.emitted_event,
          outbox_enqueued: o.outbox_enqueued,
          duration_ms: o.duration_ms,
        })),
        events_emitted: summary.events_emitted,
        outbox_enqueued: summary.outbox_enqueued,
      } as unknown as Record<string, unknown>,
    });
  }

  return NextResponse.json({ ok: summary.errors.length === 0, ...summary }, {
    status: summary.errors.length === 0 ? 200 : 207,
  });
}

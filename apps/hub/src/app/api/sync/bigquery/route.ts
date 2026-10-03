import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { runPokepricesBqAnalysis, bigqueryDiagnostic } from '@/server/bigquery/analysis';
import { estimateBqCostUsd, formatBqBytes } from '@/server/google/bigquery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Runs BigQuery deep analysis for PokePrices and persists
// cannibalisation + content-gap findings. Also exposes a diagnostic
// mode (?mode=diag) that only probes the WIF chain and dataset
// visibility.

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 401 });
  }
  const sb = createServiceRoleSupabase();
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') ?? 'analyse';

  if (mode === 'diag') {
    const r = await bigqueryDiagnostic();
    // Record the probe in network_integrations.
    await sb.from('network_integrations').update({
      status: r.ok ? 'connected' : 'error',
      last_success_at: r.ok ? new Date().toISOString() : undefined,
      last_attempt_at: new Date().toISOString(),
      error_summary: r.ok ? null : (r.error ?? 'unknown'),
    }).eq('provider', 'bigquery');
    await sb.from('network_bigquery_readiness').update({
      gsc_export_status: r.ok ? 'connected' : 'error',
      last_checked_at: new Date().toISOString(),
    }).eq('gcp_project_id', 'pokeprices-seo');
    const { ok: _ok, ...rest } = r;
    return NextResponse.json({ ok: r.ok, ...rest, bytesProcessedFmt: formatBqBytes(r.bytesProcessed), bytesBilledFmt: formatBqBytes(r.bytesBilled) });
  }

  // Find the PokePrices site.
  const { data: pokemon } = await sb.from('network_sites').select('id').eq('slug', 'pokemon').maybeSingle();
  if (!pokemon) return NextResponse.json({ ok: false, error: 'pokemon site not found' }, { status: 500 });
  const siteId = (pokemon as { id: string }).id;

  const jobStart = Date.now();
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'bq.pokeprices_analysis',
    p_job_type: 'analysis',
    p_site_id: siteId,
    p_metadata: {} as unknown as Record<string, unknown>,
  });
  try {
    const r = await runPokepricesBqAnalysis(sb, siteId);
    const estCost = estimateBqCostUsd(r.bytesBilled);
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: 'success',
      p_rows_examined: 0,
      p_rows_inserted: r.cannibalFindings + r.gapFindings,
      p_rows_updated: 0,
      p_rows_rejected: 0,
      p_error_summary: null,
      p_metadata: {
        bq_bytes_processed: r.bytesProcessed,
        bq_bytes_billed: r.bytesBilled,
        bq_bytes_processed_fmt: formatBqBytes(r.bytesProcessed),
        bq_bytes_billed_fmt: formatBqBytes(r.bytesBilled),
        bq_est_cost_usd: Number(estCost.toFixed(6)),
        queries: r.queries,
        duration_ms: Date.now() - jobStart,
      } as unknown as Record<string, unknown>,
    });
    // Flip the pokeprices BQ integration to connected on first success.
    await sb.from('network_integrations').update({
      status: 'connected',
      last_success_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      error_summary: null,
    }).eq('provider', 'bigquery');
    return NextResponse.json({
      ok: true,
      ...r,
      bytesProcessedFmt: formatBqBytes(r.bytesProcessed),
      bytesBilledFmt: formatBqBytes(r.bytesBilled),
      estimatedCostUsd: Number(estCost.toFixed(6)),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sb.rpc('network_fail_job_run', { p_id: jobId, p_error_summary: msg.slice(0, 500), p_metadata: null as unknown as Record<string, unknown> });
    await sb.from('network_integrations').update({
      status: 'error',
      last_attempt_at: new Date().toISOString(),
      error_summary: msg.slice(0, 300),
    }).eq('provider', 'bigquery');
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

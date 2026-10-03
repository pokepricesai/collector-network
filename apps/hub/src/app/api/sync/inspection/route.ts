import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { buildInspectionQueue, processInspectionQueue } from '@/server/inspection/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Build queue + process up to MAX_PER_SITE_PER_RUN URLs per site.
// Default of 50 keeps us well under the inspection API quota.
const MAX_PER_SITE_PER_RUN = 50;

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 401 });
  }
  const url = new URL(req.url);
  const siteFilter = url.searchParams.get('site');
  const maxPerSite = Number(url.searchParams.get('max') ?? MAX_PER_SITE_PER_RUN);

  const sb = createServiceRoleSupabase();
  const { data: props, error } = await sb
    .from('network_google_properties')
    .select('site_id, property_id, network_sites!inner(slug)')
    .eq('kind', 'gsc')
    .eq('status', 'active');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const results: Array<{ site: string; enqueued: number; processed: number; inspected: number; quotaExceeded: boolean; errors: number }> = [];

  for (const row of (props ?? []) as unknown as Array<{ site_id: string; property_id: string; network_sites: { slug: string } }>) {
    const slug = row.network_sites.slug;
    if (siteFilter && slug !== siteFilter) continue;

    const jobStart = Date.now();
    const { data: jobId } = await sb.rpc('network_start_job_run', {
      p_job_name: 'inspection.cycle',
      p_job_type: 'sync',
      p_site_id: row.site_id,
      p_metadata: { property_id: row.property_id } as unknown as Record<string, unknown>,
    });
    try {
      const { enqueued } = await buildInspectionQueue(sb, row.site_id);
      const r = await processInspectionQueue(sb, row.site_id, row.property_id, maxPerSite);
      results.push({ site: slug, enqueued, processed: r.processed, inspected: r.inspected, quotaExceeded: r.quotaExceeded, errors: r.errors.length });
      await sb.rpc('network_complete_job_run', {
        p_id: jobId,
        p_status: r.errors.length === 0 && !r.quotaExceeded ? 'success' : 'warning',
        p_rows_examined: r.processed,
        p_rows_inserted: r.inspected,
        p_rows_updated: 0,
        p_rows_rejected: r.errors.length,
        p_error_summary: r.quotaExceeded ? 'quota exceeded' : null,
        p_metadata: { enqueued, duration_ms: Date.now() - jobStart } as unknown as Record<string, unknown>,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sb.rpc('network_fail_job_run', { p_id: jobId, p_error_summary: msg.slice(0, 500), p_metadata: null as unknown as Record<string, unknown> });
      results.push({ site: slug, enqueued: 0, processed: 0, inspected: 0, quotaExceeded: false, errors: 1 });
    }
  }
  return NextResponse.json({ ok: true, results });
}

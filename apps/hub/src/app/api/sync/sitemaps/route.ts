import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { runSitemapsForAllSites } from '@/server/sitemaps/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 401 });
  }
  const sb = createServiceRoleSupabase();
  const { data: sites, error } = await sb
    .from('network_sites')
    .select('id, slug, canonical_url')
    .eq('status', 'active');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const url = new URL(req.url);
  const siteFilter = url.searchParams.get('site');
  const descriptors = (sites ?? [])
    .map((s) => ({ id: s.id as string, slug: s.slug as string, canonicalUrl: s.canonical_url as string }))
    .filter((s) => !siteFilter || s.slug === siteFilter);

  const jobStart = Date.now();
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'sitemap.check',
    p_job_type: 'sync',
    p_site_id: null,
    p_metadata: { site_filter: siteFilter } as unknown as Record<string, unknown>,
  });

  try {
    const { snapshots, errors } = await runSitemapsForAllSites(sb, descriptors);
    const rowsInserted = snapshots.reduce((a, s) => a + s.result.submittedCount, 0);
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: errors.length === 0 ? 'success' : 'warning',
      p_rows_examined: rowsInserted,
      p_rows_inserted: snapshots.length,
      p_rows_updated: 0,
      p_rows_rejected: errors.length,
      p_error_summary: errors.length === 0 ? null : errors.map((e) => `${e.site}:${e.error}`).join('; ').slice(0, 500),
      p_metadata: { snapshots: snapshots.map((s) => ({ site: s.site, submitted: s.result.submittedCount, issues: s.result.issues.length })), duration_ms: Date.now() - jobStart } as unknown as Record<string, unknown>,
    });
    return NextResponse.json({
      ok: true,
      snapshots: snapshots.map((s) => ({
        site: s.site,
        submitted: s.result.submittedCount,
        validSampled: s.result.validSampled,
        issues: s.result.issues.length,
        shards: s.result.shardCount,
      })),
      errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sb.rpc('network_fail_job_run', { p_id: jobId, p_error_summary: msg.slice(0, 500), p_metadata: null as unknown as Record<string, unknown> });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

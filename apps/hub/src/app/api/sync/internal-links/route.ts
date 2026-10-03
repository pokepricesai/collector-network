import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { generateInternalLinkOpportunities } from '@/server/internal-links/engine';
import { generatePageOpportunities } from '@/server/page-opportunities/engine';

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
    .select('id, slug')
    .eq('status', 'active');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const url = new URL(req.url);
  const siteFilter = url.searchParams.get('site');
  const today = new Date();
  const perSite: Array<{ site: string; internal: { generated: number; updated: number }; pages: { generated: number; updated: number } }> = [];

  for (const s of (sites ?? []) as Array<{ id: string; slug: string }>) {
    if (siteFilter && s.slug !== siteFilter) continue;
    const jobStart = Date.now();
    const { data: jobId } = await sb.rpc('network_start_job_run', {
      p_job_name: 'intel.links_and_pages',
      p_job_type: 'analysis',
      p_site_id: s.id,
      p_metadata: {} as unknown as Record<string, unknown>,
    });
    try {
      const [internal, pages] = await Promise.all([
        generateInternalLinkOpportunities(sb, s.id, today),
        generatePageOpportunities(sb, s.slug, s.id, today),
      ]);
      perSite.push({ site: s.slug, internal, pages });
      await sb.rpc('network_complete_job_run', {
        p_id: jobId,
        p_status: 'success',
        p_rows_examined: 0,
        p_rows_inserted: internal.generated + pages.generated,
        p_rows_updated: internal.updated + pages.updated,
        p_rows_rejected: 0,
        p_error_summary: null,
        p_metadata: { internal, pages, duration_ms: Date.now() - jobStart } as unknown as Record<string, unknown>,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sb.rpc('network_fail_job_run', { p_id: jobId, p_error_summary: msg.slice(0, 500), p_metadata: null as unknown as Record<string, unknown> });
    }
  }

  return NextResponse.json({ ok: true, results: perSite });
}

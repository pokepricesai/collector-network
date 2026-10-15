import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';
import { generateIdeasForSite } from '@/server/content/ideas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// CN-04 Slice A weekly ideas cron.
//
// Fires once a week (Monday 07:00 UTC per vercel.json). Produces up
// to 4 fresh ideas per active site via the deterministic generator,
// so the operator opens the week with roughly 20 candidates ready
// for Approve / Reject / Edit.
//
// No AI spend. The generator reads Phase 2 opportunities + content
// gaps and nothing else.

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  const sb = createServiceRoleSupabase();
  const { data: sites } = await sb
    .from('network_sites')
    .select('id, slug')
    .eq('status', 'active');

  const perSite: Array<{ site: string; generated: number; refreshed: number; dismissed_stale: number; shortfall?: number; candidates_considered?: number; error?: string }> = [];
  for (const s of ((sites ?? []) as Array<{ id: string; slug: string }>)) {
    try {
      const r = await generateIdeasForSite(sb, s.id, s.slug);
      perSite.push({ site: s.slug, ...r });
    } catch (err) {
      perSite.push({ site: s.slug, generated: 0, refreshed: 0, dismissed_stale: 0, error: (err as Error).message.slice(0, 200) });
    }
  }

  const totalGenerated = perSite.reduce((a, r) => a + r.generated, 0);
  const totalShortfall = perSite.reduce((a, r) => a + (r.shortfall ?? 0), 0);
  const shortSites = perSite.filter((r) => (r.shortfall ?? 0) > 0).map((r) => `${r.site}:-${r.shortfall}`);
  // The weekly target is 20 ideas (4 × 5 active sites). If evidence
  // was too thin for the full set, note it in the response + audit
  // log so the operator sees "shortage" rather than a silent miss.
  if (totalShortfall > 0) {
    try {
      await sb.rpc('network_log_audit', {
        p_action: 'ideas.weekly_shortfall',
        p_entity_type: 'network_content_ideas',
        p_entity_id: null,
        p_site_id: null,
        p_old_value: null,
        p_new_value: { totalGenerated, totalShortfall, shortSites } as unknown as Record<string, unknown>,
        p_actor_type: 'system',
        p_source: 'cron',
        p_metadata: {} as unknown as Record<string, unknown>,
      });
    } catch { /* audit log best-effort */ }
  }
  return NextResponse.json({ ok: true, totalGenerated, totalShortfall, shortSites, perSite });
}

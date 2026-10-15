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

  const perSite: Array<{ site: string; generated: number; refreshed: number; dismissed_stale: number; error?: string }> = [];
  for (const s of ((sites ?? []) as Array<{ id: string; slug: string }>)) {
    try {
      const r = await generateIdeasForSite(sb, s.id, s.slug);
      perSite.push({ site: s.slug, ...r });
    } catch (err) {
      perSite.push({ site: s.slug, generated: 0, refreshed: 0, dismissed_stale: 0, error: (err as Error).message.slice(0, 200) });
    }
  }

  const totalGenerated = perSite.reduce((a, r) => a + r.generated, 0);
  return NextResponse.json({ ok: true, totalGenerated, perSite });
}

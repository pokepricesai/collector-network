import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { runJobBySlug } from '@/server/jobs/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// CRON-authed trigger for the intelligence engine. Runs
// `intelligence.refresh` via the central job registry, then returns:
//   { ok, result, top10 }
// where top10 is a compact JSON of the current top 10 open items.
//
// Phase 1 is manual-only; this endpoint exists for operator curl
// invocations (CRON_SECRET-authed). No AI, no external action.

interface Top10Row {
  id: string;
  priority: number;
  signal_kind: string;
  category: string;
  type: string;
  site_slug: string | null;
  title: string;
  summary: string;
  recommended_action: string;
  impact: number;
  confidence: number;
  urgency: number;
  effort: number;
  expected_upside: unknown;
  evidence_summary: unknown;
}

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
  }

  const result = await runJobBySlug('intelligence.refresh');
  const sb = createServiceRoleSupabase();

  // Pull current top-10 open items regardless of job success; if the
  // engine failed partway through, prior items may still exist.
  const { data: rows } = await sb
    .from('network_intelligence_items')
    .select('id, priority_score, signal_kind, category, type, site_id, title, summary, recommended_action, impact_score, confidence_score, urgency_score, effort_score, expected_upside, evidence, network_sites(slug)')
    .in('status', ['open', 'task_created'])
    .order('priority_score', { ascending: false })
    .order('last_detected_at', { ascending: false })
    .limit(10);
  const top10: Top10Row[] = ((rows ?? []) as unknown as Array<{
    id: string; priority_score: number; signal_kind: string; category: string; type: string;
    site_id: string | null; title: string; summary: string; recommended_action: string;
    impact_score: number; confidence_score: number; urgency_score: number; effort_score: number;
    expected_upside: unknown; evidence: Record<string, unknown>;
    network_sites: { slug: string } | null;
  }>).map((r) => ({
    id: r.id,
    priority: r.priority_score,
    signal_kind: r.signal_kind,
    category: r.category,
    type: r.type,
    site_slug: r.network_sites?.slug ?? null,
    title: r.title,
    summary: r.summary,
    recommended_action: r.recommended_action,
    impact: r.impact_score,
    confidence: r.confidence_score,
    urgency: r.urgency_score,
    effort: r.effort_score,
    expected_upside: r.expected_upside,
    evidence_summary: summariseEvidence(r.evidence),
  }));

  if (!result.ok) {
    return NextResponse.json({ ok: false, result, top10 }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result, top10 }, { status: 200 });
}

// Compact view of the evidence jsonb so the response stays readable.
// Keeps numeric scalars + short strings; truncates arrays/objects.
function summariseEvidence(ev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev ?? {})) {
    if (v == null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
    if (typeof v === 'string') { out[k] = v.length > 160 ? v.slice(0, 157) + '…' : v; continue; }
    if (Array.isArray(v)) { out[k] = `[Array×${v.length}]`; continue; }
    if (typeof v === 'object') { out[k] = '{...}'; continue; }
  }
  return out;
}

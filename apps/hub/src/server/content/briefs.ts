import 'server-only';

// Brief orchestrator. Reads a content idea + Phase 2 evidence from
// Supabase, calls the AI brief generator with structured input, and
// persists the brief into network_content_briefs. The brief enters
// 'draft' status and must be approved via network_approvals before
// a draft can be generated.

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateBrief, logAiCost, type VoiceProfile, type BriefEvidence } from './ai';

export interface BriefResult {
  briefId: string;
  briefPayload: Record<string, unknown>;
  approvalId: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    est_cost_usd: number;
    model: string;
  };
}

async function loadVoice(sb: SupabaseClient, siteId: string): Promise<VoiceProfile> {
  const { data, error } = await sb
    .from('network_voice_profiles')
    .select('audience, tone, terminology, content_emphasis, preferred_structure, balance, do_not, naming_rules, canonical_tag, example_openings')
    .eq('site_id', siteId)
    .maybeSingle();
  if (error) throw new Error(`[briefs] load voice: ${error.message}`);
  if (!data) throw new Error(`[briefs] no voice profile for site ${siteId}`);
  const row = data as unknown as VoiceProfile & { example_openings: unknown };
  return {
    audience: row.audience,
    tone: row.tone,
    terminology: row.terminology,
    content_emphasis: row.content_emphasis,
    preferred_structure: row.preferred_structure,
    balance: row.balance,
    do_not: row.do_not,
    naming_rules: row.naming_rules,
    canonical_tag: row.canonical_tag,
    example_openings: Array.isArray(row.example_openings) ? (row.example_openings as string[]) : [],
  };
}

async function loadEvidence(
  sb: SupabaseClient,
  idea: { site_id: string; working_title: string; primary_query: string | null; secondary_queries: string[]; content_type: string; summary: string | null; origin_type: string; evidence: Record<string, unknown>; },
): Promise<BriefEvidence> {
  // GSC query/page context: pull the 28d most-impressed queries/pages
  // for the site so the brief can anchor on real demand signals.
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 28);
  const sinceIso = since.toISOString().slice(0, 10);

  const [{ data: queries }, { data: pages }, { data: linkOpps }, { data: existingArticles }] = await Promise.all([
    sb.from('network_gsc_query_daily')
      .select('query, clicks, impressions, position_avg')
      .eq('site_id', idea.site_id).gte('date', sinceIso)
      .order('impressions', { ascending: false }).limit(50),
    sb.from('network_gsc_url_daily')
      .select('page, clicks, impressions')
      .eq('site_id', idea.site_id).gte('date', sinceIso)
      .order('impressions', { ascending: false }).limit(30),
    sb.from('network_internal_link_opportunities')
      .select('target_url, reason, evidence')
      .eq('site_id', idea.site_id).eq('status', 'open').limit(30),
    sb.from('network_articles')
      .select('title, slug, publication_url, summary')
      .eq('site_id', idea.site_id).eq('status', 'published').limit(50),
  ]);

  // Deduplicate queries by text and aggregate.
  const qAgg = new Map<string, { impressions: number; clicks: number; posW: number; posD: number }>();
  for (const r of ((queries ?? []) as Array<{ query: string; clicks: number; impressions: number; position_avg: number | null }>)) {
    const prev = qAgg.get(r.query);
    if (!prev) qAgg.set(r.query, { impressions: r.impressions, clicks: r.clicks, posW: (r.position_avg ?? 0) * r.impressions, posD: r.impressions });
    else { prev.impressions += r.impressions; prev.clicks += r.clicks; prev.posW += (r.position_avg ?? 0) * r.impressions; prev.posD += r.impressions; }
  }
  const relatedQueries = [...qAgg.entries()]
    .map(([q, m]) => ({ query: q, impressions: m.impressions, clicks: m.clicks, position: m.posD > 0 ? m.posW / m.posD : null }))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 20);

  const pAgg = new Map<string, { impressions: number; clicks: number }>();
  for (const r of ((pages ?? []) as Array<{ page: string; clicks: number; impressions: number }>)) {
    const prev = pAgg.get(r.page);
    if (!prev) pAgg.set(r.page, { impressions: r.impressions, clicks: r.clicks });
    else { prev.impressions += r.impressions; prev.clicks += r.clicks; }
  }
  const rankingPages = [...pAgg.entries()]
    .map(([p, m]) => ({ page: p, impressions: m.impressions, clicks: m.clicks }))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 10);

  const linkTargets = ((linkOpps ?? []) as Array<{ target_url: string; reason: string; evidence: Record<string, unknown> }>).slice(0, 15);
  const articleRefs = ((existingArticles ?? []) as Array<{ title: string; slug: string; publication_url: string | null; summary: string | null }>).map((a) => ({
    title: a.title,
    url: a.publication_url ?? `/insights/${a.slug}`,
    summary: a.summary ?? undefined,
  }));

  return {
    idea: {
      working_title: idea.working_title,
      primary_query: idea.primary_query,
      secondary_queries: idea.secondary_queries ?? [],
      content_type: idea.content_type,
      summary: idea.summary,
      origin_type: idea.origin_type,
      evidence: idea.evidence,
    },
    gsc_context: { related_queries: relatedQueries, ranking_pages: rankingPages },
    internal_link_targets: linkTargets,
    existing_articles: articleRefs,
  };
}

export async function generateBriefForIdea(
  sb: SupabaseClient,
  ideaId: string,
  adminId: string | null,
): Promise<BriefResult> {
  // Load idea
  const { data: ideaRow, error: ideaErr } = await sb
    .from('network_content_ideas')
    .select('id, site_id, working_title, primary_query, secondary_queries, content_type, summary, origin_type, evidence, network_sites(slug)')
    .eq('id', ideaId).maybeSingle();
  if (ideaErr) throw new Error(`[briefs] load idea: ${ideaErr.message}`);
  if (!ideaRow) throw new Error(`[briefs] idea ${ideaId} not found`);
  const idea = ideaRow as unknown as {
    id: string; site_id: string; working_title: string; primary_query: string | null;
    secondary_queries: string[]; content_type: string; summary: string | null;
    origin_type: string; evidence: Record<string, unknown>;
    network_sites: { slug: string };
  };

  const voice = await loadVoice(sb, idea.site_id);
  const evidence = await loadEvidence(sb, idea);
  const { brief, usage, rawText } = await generateBrief({
    siteSlug: idea.network_sites.slug, voice, evidence,
  });

  // Persist brief
  const { data: inserted, error: insErr } = await sb
    .from('network_content_briefs')
    .insert({
      idea_id: idea.id,
      site_id: idea.site_id,
      content_type: idea.content_type,
      payload: brief as unknown as Record<string, unknown>,
      status: 'in_review',
      actor_type: 'ai',
      ai_provider: 'anthropic',
      ai_model: usage.model,
      ai_input_tokens: usage.input_tokens,
      ai_output_tokens: usage.output_tokens,
      ai_est_cost_usd: usage.est_cost_usd,
      created_by: adminId,
    })
    .select('id').single();
  if (insErr) throw new Error(`[briefs] insert: ${insErr.message}`);
  const briefId = (inserted as { id: string }).id;

  await logAiCost(sb, {
    operation: 'brief',
    usage,
    idea_id: idea.id,
    brief_id: briefId,
    actor_user_id: adminId ?? undefined,
  });

  // Create an approval. The admin can also approve directly from the
  // brief page; this entry ties into /admin/approvals and the audit log.
  const { data: appr, error: apprErr } = await sb
    .from('network_approvals')
    .insert({
      site_id: idea.site_id,
      action_type: 'content_brief',
      title: `Brief: ${brief.suggested_h1 ?? idea.working_title}`,
      description: brief.purpose ?? idea.summary ?? '',
      payload: { brief_id: briefId, idea_id: idea.id } as unknown as Record<string, unknown>,
      source_code: 'ai',
      requested_by: 'ai',
      requested_by_id: adminId,
      status: 'pending',
    })
    .select('id').single();
  if (apprErr) throw new Error(`[briefs] insert approval: ${apprErr.message}`);
  const approvalId = (appr as { id: string }).id;

  await sb.from('network_content_briefs').update({ approval_id: approvalId }).eq('id', briefId);

  // Flip idea status
  await sb.from('network_content_ideas').update({ status: 'in_brief' }).eq('id', idea.id);

  await sb.rpc('network_log_audit', {
    p_action: 'brief.ai_generated',
    p_entity_type: 'network_content_brief',
    p_entity_id: briefId,
    p_site_id: idea.site_id,
    p_old_value: null,
    p_new_value: { idea_id: idea.id, model: usage.model, cost_usd: usage.est_cost_usd } as unknown as Record<string, unknown>,
    p_actor_type: 'ai',
    p_source: 'ai_claude',
    p_metadata: { approval_id: approvalId, raw_chars: rawText.length } as unknown as Record<string, unknown>,
  });

  return { briefId, briefPayload: brief as unknown as Record<string, unknown>, approvalId, usage };
}

export async function approveBrief(
  sb: SupabaseClient,
  briefId: string,
  adminId: string,
): Promise<void> {
  const { data: brief, error } = await sb
    .from('network_content_briefs')
    .select('id, idea_id, site_id, approval_id, status')
    .eq('id', briefId).maybeSingle();
  if (error) throw new Error(`[briefs] load for approve: ${error.message}`);
  if (!brief) throw new Error(`[briefs] not found`);
  const b = brief as { id: string; idea_id: string; site_id: string; approval_id: string | null; status: string };
  if (b.status === 'approved') return;

  await sb.from('network_content_briefs').update({
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: adminId,
  }).eq('id', briefId);

  if (b.approval_id) {
    await sb.from('network_approvals').update({
      status: 'approved',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', b.approval_id);
  }

  await sb.rpc('network_log_audit', {
    p_action: 'brief.approved',
    p_entity_type: 'network_content_brief',
    p_entity_id: briefId,
    p_site_id: b.site_id,
    p_old_value: { status: b.status } as unknown as Record<string, unknown>,
    p_new_value: { status: 'approved' } as unknown as Record<string, unknown>,
    p_actor_type: 'human',
    p_source: 'manual',
    p_metadata: { idea_id: b.idea_id } as unknown as Record<string, unknown>,
  });
}

export async function rejectBrief(
  sb: SupabaseClient,
  briefId: string,
  adminId: string,
  reason: string,
): Promise<void> {
  const { data: brief } = await sb
    .from('network_content_briefs')
    .select('id, idea_id, site_id, approval_id, status').eq('id', briefId).maybeSingle();
  if (!brief) return;
  const b = brief as { id: string; idea_id: string; site_id: string; approval_id: string | null; status: string };

  await sb.from('network_content_briefs').update({
    status: 'rejected',
    rejection_reason: reason.slice(0, 500),
  }).eq('id', briefId);

  if (b.approval_id) {
    await sb.from('network_approvals').update({
      status: 'rejected',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      review_notes: reason.slice(0, 500),
    }).eq('id', b.approval_id);
  }

  // Return the idea to 'new' so operator can try again.
  await sb.from('network_content_ideas').update({ status: 'new' }).eq('id', b.idea_id);
}

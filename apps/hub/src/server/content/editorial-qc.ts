import 'server-only';

// Editorial AI QC orchestrator. Semantic reviewer that runs AFTER
// the deterministic Phase 3 QC. Does not replace it — the two serve
// different purposes:
//
//   deterministic QC → catches structural problems (missing title,
//                       duplicate slug, placeholder markers, bad
//                       heading structure, meta length).
//   editorial QC     → catches semantic problems (incomplete
//                       tables, merged rows, unsupported claims,
//                       inconsistent ordering, excessive certainty,
//                       investment-advice tone).
//
// The reviewer is instructed to return SPECIFIC issues with
// locations, not an arbitrary 0-100 score.

import type { SupabaseClient } from '@supabase/supabase-js';
import { runEditorialQcOnArticle, logSocialAiCost, type EditorialQcIssue } from '../social/ai';
import type { GeneratedBrief } from './ai';

interface ArticleRow {
  id: string;
  site_id: string;
  title: string;
  slug: string;
  body: string;
  summary: string | null;
  meta_title: string | null;
  meta_description: string | null;
  brief_id: string | null;
  idea_id: string | null;
  qc_report: Record<string, unknown> | null;
  network_sites: { slug: string; name: string };
}

interface SiteVoiceRow { label: string }

export async function runEditorialQcForArticle(
  sb: SupabaseClient,
  articleId: string,
  adminId: string | null,
): Promise<{
  issues: EditorialQcIssue[];
  summary: string;
  usage: { input_tokens: number; output_tokens: number; est_cost_usd: number; model: string };
}> {
  // Load article + brief + evidence facts (same shape the draft
  // generator receives, so the reviewer is grounded on exactly the
  // same material that was supposed to constrain the writer).
  const { data: artRaw, error: artErr } = await sb
    .from('network_articles')
    .select('id, site_id, title, slug, body, summary, meta_title, meta_description, brief_id, idea_id, qc_report, network_sites(slug, name)')
    .eq('id', articleId).maybeSingle();
  if (artErr) throw new Error(`[editorial-qc] load article: ${artErr.message}`);
  if (!artRaw) throw new Error('article not found');
  const art = artRaw as unknown as ArticleRow;

  if (!art.brief_id) {
    throw new Error('[editorial-qc] article has no brief_id — editorial QC requires the originating brief');
  }

  const { data: briefRow } = await sb.from('network_content_briefs')
    .select('payload, idea_id').eq('id', art.brief_id).maybeSingle();
  if (!briefRow) throw new Error('brief not found');
  const brief = briefRow as { payload: GeneratedBrief; idea_id: string };

  // Pull the originating idea's evidence (contains structured
  // pricing_data for data-driven articles).
  const { data: ideaRow } = await sb.from('network_content_ideas')
    .select('evidence').eq('id', brief.idea_id).maybeSingle();
  const ideaEvidence = (ideaRow as { evidence?: Record<string, unknown> } | null)?.evidence ?? {};
  const evidenceFacts = buildEvidenceFactsForQc(ideaEvidence);

  // Load the site's content voice label for context (not for enforcement — the QC reviewer uses the brief as truth).
  let siteVoiceLabel = `${art.network_sites.name} (${art.network_sites.slug})`;
  const { data: vp } = await sb.from('network_voice_profiles')
    .select('canonical_tag').eq('site_id', art.site_id).maybeSingle();
  const vpRow = vp as SiteVoiceRow | null;
  if (vpRow?.label) siteVoiceLabel = `${art.network_sites.name} — ${vpRow.label}`;

  const { result, usage, rawText } = await runEditorialQcOnArticle({
    article: {
      title: art.title, slug: art.slug, body: art.body,
      summary: art.summary, meta_title: art.meta_title, meta_description: art.meta_description,
    },
    brief: brief.payload as unknown as Record<string, unknown>,
    evidenceFacts,
    siteVoiceLabel,
  });

  // Persist into article.qc_report (merging with any prior
  // deterministic report so operators see both).
  const existing = (art.qc_report as { issues?: unknown[]; ran_at?: string } | null) ?? { issues: [], ran_at: null };
  const merged = {
    deterministic: { issues: existing.issues ?? [], ran_at: existing.ran_at ?? null },
    editorial: {
      issues: result.issues,
      summary: result.summary,
      ran_at: new Date().toISOString(),
      model: usage.model,
      cost_usd: usage.est_cost_usd,
      checked_against: result.checked_against,
    },
  };
  await sb.from('network_articles').update({
    qc_report: merged as unknown as Record<string, unknown>,
  }).eq('id', art.id);

  // Cost log.
  await logSocialAiCost(sb, {
    operation: 'editorial_qc', usage,
    article_id: art.id, brief_id: art.brief_id,
    actor_user_id: adminId ?? undefined,
  });

  await sb.rpc('network_log_audit', {
    p_action: 'article.editorial_qc_ran',
    p_entity_type: 'network_article', p_entity_id: art.id,
    p_site_id: art.site_id, p_old_value: null,
    p_new_value: {
      issue_count: result.issues.length,
      blockers: result.issues.filter((i) => i.severity === 'blocker').length,
      warnings: result.issues.filter((i) => i.severity === 'warning').length,
      cost_usd: usage.est_cost_usd,
    } as unknown as Record<string, unknown>,
    p_actor_type: 'ai', p_source: 'editorial_qc',
    p_metadata: { raw_chars: rawText.length } as unknown as Record<string, unknown>,
  });

  return { issues: result.issues, summary: result.summary, usage };
}

/**
 * Flatten the idea's structured evidence into the same
 * additional_facts shape the draft generator was authorised to
 * cite. This gives the QC reviewer visibility into whether the
 * article actually used the data that was available to it.
 */
function buildEvidenceFactsForQc(evidence: Record<string, unknown>): Array<{ claim: string; source: string }> {
  const facts: Array<{ claim: string; source: string }> = [];
  const pd = evidence['pricing_data'] as Record<string, unknown> | undefined;
  if (!pd) return facts;

  const win = pd['window'] as { label?: string; start_date?: string; end_date?: string } | undefined;
  const sourceBase = `PokePrices ${win?.label ?? 'window'} (${win?.start_date ?? '?'} → ${win?.end_date ?? '?'})`;

  const sections: Array<[string, string]> = [
    ['raw_risers', 'Raw riser'], ['raw_fallers', 'Raw faller'],
    ['psa10_risers', 'PSA 10 riser'], ['psa10_fallers', 'PSA 10 faller'],
  ];
  for (const [key, label] of sections) {
    const rows = (pd[key] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const r of rows) {
      const name = String(r['card_name'] ?? '?');
      const set = String(r['set_name'] ?? '?');
      const start = Number(r['start_price_usd'] ?? 0);
      const end = Number(r['end_price_usd'] ?? 0);
      const abs = Number(r['abs_change_usd'] ?? 0);
      const pct = Number(r['pct_change'] ?? 0);
      const sales = Number(r['sales_90d'] ?? 0);
      facts.push({
        claim: `${label}: ${name} (${set}) · $${start.toFixed(2)} → $${end.toFixed(2)} · ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% · abs ${abs >= 0 ? '+' : ''}$${Math.abs(abs).toFixed(2)} · ${sales} sales/90d`,
        source: sourceBase,
      });
    }
  }
  return facts;
}

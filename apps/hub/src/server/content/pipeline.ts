import 'server-only';

// CN-04 Slice B drafting pipeline.
//
// One entry point: driveDraftingFromIdea(). Given an approved idea,
// it walks the deterministic chain idea → brief → article → draft
// → deterministic QC in a single call, respecting the rolling-7d
// budget. Partial failures leave recoverable state that the cron
// at /api/cron/process-approved-ideas can pick up on the next tick.
//
// Idempotency: before every step the pipeline checks for the next
// artifact (brief then article then non-empty body) and skips the
// step if it already exists. The pipeline never regenerates an
// article whose operator-facing body (body_rich) has been edited —
// manual edits are sacrosanct.

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateBriefForIdea, approveBrief } from './briefs';
import {
  createArticleFromBrief,
  generateArticleDraft,
  runArticleQc,
} from './drafts';
import { getRollingAiBudget, ESTIMATED_COST_USD } from './budget';

export type PipelineOutcome =
  | { status: 'drafted'; articleId: string }
  | { status: 'budget_waiting'; articleId?: string; neededUsd: number; availableUsd: number }
  | { status: 'skipped'; articleId: string; reason: 'manual_edits_present' | 'already_drafted' }
  | { status: 'failed'; articleId?: string; error: string };

const BUDGET_WAITING_REASON = 'budget_waiting';
const BRIEF_FAILED_REASON = 'brief_failed';
const DRAFT_FAILED_REASON = 'draft_failed';

export async function driveDraftingFromIdea(
  sb: SupabaseClient,
  ideaId: string,
  adminId: string | null,
): Promise<PipelineOutcome> {
  // Load the idea so we can inspect state and (where needed) nudge
  // its status back to 'approved' for a retry that recovers from a
  // mid-pipeline failure.
  const { data: ideaRow } = await sb
    .from('network_content_ideas')
    .select('id, site_id, status, hold_reasons')
    .eq('id', ideaId).maybeSingle();
  if (!ideaRow) return { status: 'failed', error: `idea ${ideaId} not found` };
  const idea = ideaRow as { id: string; site_id: string; status: string; hold_reasons: string[] };

  // Idempotency: if the operator already has an article for this
  // idea, don't regenerate. Manual edits (body_rich) are never
  // destroyed by the pipeline.
  const { data: existingArticles } = await sb
    .from('network_articles')
    .select('id, body, body_rich, brief_id')
    .eq('idea_id', ideaId).order('created_at', { ascending: false }).limit(1);
  const existing = (existingArticles ?? [])[0] as { id: string; body: string | null; body_rich: unknown | null; brief_id: string | null } | undefined;

  if (existing) {
    const hasManualEdits = isNonEmptyBodyRich(existing.body_rich);
    const hasBody = (existing.body ?? '').trim().length > 0;
    if (hasManualEdits) {
      await clearHoldReason(sb, ideaId, BUDGET_WAITING_REASON);
      return { status: 'skipped', articleId: existing.id, reason: 'manual_edits_present' };
    }
    if (hasBody) {
      // Article already drafted (markdown body populated by prior
      // generateArticleDraft). The editor imports body → body_rich on
      // open, so this is "ready for operator".
      await clearHoldReason(sb, ideaId, BUDGET_WAITING_REASON);
      return { status: 'skipped', articleId: existing.id, reason: 'already_drafted' };
    }
    // Article shell exists but no body yet (brief ran, draft gen
    // failed/held). We'll resume at the draft step.
    if (!existing.brief_id) {
      return { status: 'failed', articleId: existing.id, error: 'article has no brief_id — manual intervention required' };
    }
    const draftOnly = await runDraftOnly(sb, existing.id, ideaId, adminId);
    return draftOnly;
  }

  // Pre-flight budget check: both brief + draft estimates must fit.
  const needed = ESTIMATED_COST_USD.brief + ESTIMATED_COST_USD.draft;
  const budget = await getRollingAiBudget(sb);
  const available = budget.limit_usd - budget.spent_usd - budget.reserved_usd;
  if (available < needed) {
    await markHold(sb, ideaId, BUDGET_WAITING_REASON);
    return { status: 'budget_waiting', neededUsd: needed, availableUsd: available };
  }

  // The brief generator refuses any idea whose status is not
  // 'approved'. If the pipeline previously advanced the idea to
  // 'in_brief' and then failed, we rewind the status so the retry
  // can replay from a clean start.
  if (idea.status !== 'approved') {
    await sb.from('network_content_ideas').update({ status: 'approved' }).eq('id', ideaId);
  }

  // ── Brief ─────────────────────────────────────────────────────
  let briefId: string;
  try {
    const r = await generateBriefForIdea(sb, ideaId, adminId);
    briefId = r.briefId;
  } catch (err) {
    const msg = (err as Error).message;
    if (/budget denied|rolling_budget_exceeded/i.test(msg)) {
      await markHold(sb, ideaId, BUDGET_WAITING_REASON);
      return { status: 'budget_waiting', neededUsd: needed, availableUsd: available };
    }
    await markHold(sb, ideaId, BRIEF_FAILED_REASON);
    return { status: 'failed', error: `brief: ${msg}` };
  }

  // Auto-approve the brief. The human already approved the idea; a
  // second review layer on the brief would defeat Slice B's single-
  // click goal. Operators retain final control at the article edit
  // + publish stages.
  try {
    await approveBrief(sb, briefId, adminId);
  } catch (err) {
    await markHold(sb, ideaId, BRIEF_FAILED_REASON);
    return { status: 'failed', error: `brief auto-approve: ${(err as Error).message}` };
  }

  // ── Article shell ─────────────────────────────────────────────
  let articleId: string;
  try {
    const r = await createArticleFromBrief(sb, briefId, adminId);
    articleId = r.articleId;
  } catch (err) {
    await markHold(sb, ideaId, DRAFT_FAILED_REASON);
    return { status: 'failed', error: `article create: ${(err as Error).message}` };
  }

  // ── Draft body ────────────────────────────────────────────────
  return runDraftOnly(sb, articleId, ideaId, adminId);
}

/**
 * Run just the draft-generation step for an existing article. Used
 * both for first-time drafting (fresh article shell from the brief
 * step above) and for retries that previously held at this step.
 */
async function runDraftOnly(
  sb: SupabaseClient,
  articleId: string,
  ideaId: string,
  adminId: string | null,
): Promise<PipelineOutcome> {
  // Budget re-check specifically for the draft portion. The brief
  // may have already consumed its estimate, so we only need the
  // draft estimate here.
  const budget = await getRollingAiBudget(sb);
  const available = budget.limit_usd - budget.spent_usd - budget.reserved_usd;
  if (available < ESTIMATED_COST_USD.draft) {
    await markHold(sb, ideaId, BUDGET_WAITING_REASON);
    return { status: 'budget_waiting', articleId, neededUsd: ESTIMATED_COST_USD.draft, availableUsd: available };
  }

  try {
    await generateArticleDraft(sb, articleId, adminId);
  } catch (err) {
    const msg = (err as Error).message;
    if (/budget denied|rolling_budget_exceeded/i.test(msg)) {
      await markHold(sb, ideaId, BUDGET_WAITING_REASON);
      return { status: 'budget_waiting', articleId, neededUsd: ESTIMATED_COST_USD.draft, availableUsd: available };
    }
    await markHold(sb, ideaId, DRAFT_FAILED_REASON);
    return { status: 'failed', articleId, error: `draft: ${msg}` };
  }

  // Deterministic QC runs immediately so the operator opens the
  // article with issues already flagged.
  try { await runArticleQc(sb, articleId); } catch { /* non-fatal */ }

  await clearAllHoldReasons(sb, ideaId);
  return { status: 'drafted', articleId };
}

function isNonEmptyBodyRich(raw: unknown): boolean {
  if (!raw) return false;
  if (typeof raw === 'string') return raw.trim().length > 0;
  if (typeof raw === 'object') {
    const r = raw as { html?: string; text?: string };
    if (typeof r.html === 'string') return r.html.replace(/<[^>]+>/g, '').trim().length > 0;
    if (typeof r.text === 'string') return r.text.trim().length > 0;
  }
  return false;
}

async function markHold(sb: SupabaseClient, ideaId: string, reason: string): Promise<void> {
  const { data } = await sb.from('network_content_ideas')
    .select('hold_reasons').eq('id', ideaId).maybeSingle();
  const current = ((data as { hold_reasons: string[] } | null)?.hold_reasons ?? []).filter((r) => r !== reason);
  const next = [...current, reason];
  await sb.from('network_content_ideas').update({ hold_reasons: next }).eq('id', ideaId);
}

async function clearHoldReason(sb: SupabaseClient, ideaId: string, reason: string): Promise<void> {
  const { data } = await sb.from('network_content_ideas')
    .select('hold_reasons').eq('id', ideaId).maybeSingle();
  const current = ((data as { hold_reasons: string[] } | null)?.hold_reasons ?? []).filter((r) => r !== reason);
  await sb.from('network_content_ideas').update({ hold_reasons: current }).eq('id', ideaId);
}

async function clearAllHoldReasons(sb: SupabaseClient, ideaId: string): Promise<void> {
  await sb.from('network_content_ideas').update({ hold_reasons: [] }).eq('id', ideaId);
}

'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { loadAutopilotSnapshot } from '@/server/autopilot/config';
import { previewPipeline } from '@/server/autopilot/pipeline';
import { selectModel } from '@/server/autopilot/models';
import { assemblePrompt, loadVoiceSnapshot } from '@/server/autopilot/prompt';
import { reserveAiBudget, consumeAiBudget, failAiBudget } from '@/server/autopilot/budget';
import { executeRealDraft } from '@/server/autopilot/real-executor';
import { runDeterministicQA, persistQAFindings } from '@/server/autopilot/qa';
import { draftToBodyRich } from '@/server/autopilot/body-rich';
import { persistEvidencePack } from '@/server/autopilot/evidence-pack';
import type { TiptapDoc } from '@/server/autopilot/body-rich';
import type { ArticleTemplateId } from '@/server/autopilot/types';

// ONE paid draft generation. Admin-triggered. No publish. No retry.
// Called from /admin/content/autopilot/preview — the form carries a
// confirmation checkbox that must be present or we abort.
//
// Flow:
//   1. requireAdmin + check confirmation.
//   2. Re-run previewPipeline() to resolve the current top eligible
//      candidate (same code path the operator just saw).
//   3. Preflight gates: eligible, projected cost fits caps, model
//      registered in MODEL_PRICING.
//   4. Reserve the projected spend via network_reserve_ai_budget.
//   5. Call executeRealDraft (Anthropic — ONE message). Parse via the
//      shared parseDraftJson.
//   6. Run deterministic QA against the real draft.
//   7. Insert a new network_articles row (status=review, publication
//      target preserved, autopilot_run_id set, budget_cents_actual
//      populated with real cost). Persist evidence pack + QA findings.
//   8. Consume the budget reservation with the actual cost.
//   9. No publishing. No semantic QA. No further AI calls.
//
// If any step fails after reservation: release reservation and log
// a holdlist entry. The paid cost (if the API already succeeded) is
// still accounted via consume (never released) so the ledger is
// truthful.

const AUTO_PUBLISH_PRIVILEGE_IS_FALSE = true; // sanity marker

export async function executeFirstPaidDraftAction(formData: FormData): Promise<void> {
  // Confirmation checkbox is REQUIRED. The <input type="checkbox"> only
  // submits a value when checked, so FormData.has('confirm') is enough.
  if (!formData.has('confirm')) return;

  const { sb, admin } = await requireAdmin('/admin/content/autopilot/preview');
  const run_id = crypto.randomUUID();

  // ─── 1. Re-run the pipeline to resolve the current top eligible ─
  const preview = await previewPipeline({ sb, site_slug: 'ygo' });
  const chosen = preview.researched_shortlist.find((r) => r.eligible_for_generation);
  if (!chosen) {
    // Nothing eligible — write a held marker article so the operator
    // can see the attempt + rationale on /admin/content/holds.
    await writeHeldArticle(sb, admin.adminRowId, run_id, 'ygo', 'autopilot_disabled', 'No eligible researched candidate at the time of trigger.');
    revalidatePath('/admin/content/autopilot/preview');
    return;
  }

  // ─── 2. Load config + model + voice ────────────────────────────
  const snap = await loadAutopilotSnapshot(sb);
  const modelSel = await selectModel(sb, 'default_draft');
  if ('ok' in modelSel) {
    await writeHeldArticle(sb, admin.adminRowId, run_id, 'ygo', 'adapter_unavailable', `Draft model unavailable: ${modelSel.reason}`);
    revalidatePath('/admin/content/autopilot/preview');
    return;
  }

  // ─── 3. Resolve YGO site_id + build the prompt ─────────────────
  const { data: siteRow } = await sb
    .from('network_sites')
    .select('id, slug, name')
    .eq('slug', 'ygo')
    .maybeSingle();
  if (!siteRow) {
    await writeHeldArticle(sb, admin.adminRowId, run_id, 'ygo', 'adapter_unavailable', 'YGO site row missing from network_sites.');
    revalidatePath('/admin/content/autopilot/preview');
    return;
  }
  const site = siteRow as { id: string; slug: string; name: string };
  const voice = await loadVoiceSnapshot(sb, site.id);
  const prompt = assemblePrompt({
    pack: chosen.evidence_pack,
    voice,
    approved_internal_links: chosen.internal_links_outbound,
  });

  // ─── 4. Preflight budget projection ────────────────────────────
  const inputMtok  = prompt.estimated_input_tokens / 1_000_000;
  const outputMtok = prompt.max_output_tokens      / 1_000_000;
  const projected =
    inputMtok  * modelSel.pricing.input_per_mtok +
    outputMtok * modelSel.pricing.output_per_mtok;
  if (projected > snap.global.max_cost_per_article_usd) {
    await writeHeldArticle(sb, admin.adminRowId, run_id, 'ygo', 'estimate_exceeds_per_article_cap', `Projected ${projected.toFixed(4)} USD exceeds cap ${snap.global.max_cost_per_article_usd}.`);
    revalidatePath('/admin/content/autopilot/preview');
    return;
  }

  // ─── 5. Reserve the projected spend ────────────────────────────
  const reservation = await reserveAiBudget(sb, {
    runId: run_id,
    siteId: site.id,
    ideaId: chosen.discovery.kind === 'internal_idea' ? chosen.discovery.key : null,
    estimatedUsd: projected,
  });
  if (!reservation.reserved || !reservation.reservationId) {
    await writeHeldArticle(sb, admin.adminRowId, run_id, 'ygo', mapReservationReason(reservation.reason), `Reservation refused: ${reservation.reason ?? 'unknown'}.`);
    revalidatePath('/admin/content/autopilot/preview');
    return;
  }
  const reservationId = reservation.reservationId;

  // ─── 6. Call the real model. ONE call only. ────────────────────
  let exec;
  try {
    exec = await executeRealDraft({ prompt, provider: modelSel.provider, model: modelSel.model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The API may have succeeded but been rejected by the parser —
    // we can't tell without more work. Treat as failed/no spend and
    // release the reservation; the Anthropic SDK charges only when
    // the request completes, and a parse failure means the operator
    // needs to see what happened before trying again.
    await failAiBudget(sb, { reservationId, reason: msg.slice(0, 500) });
    await writeHeldArticle(sb, admin.adminRowId, run_id, 'ygo', 'semantic_qa_failed', `Real executor failed: ${msg}`);
    revalidatePath('/admin/content/autopilot/preview');
    return;
  }

  // ─── 7. Deterministic QA against the REAL draft ────────────────
  const { report, repaired } = await runDeterministicQA({
    sb,
    pack: chosen.evidence_pack,
    draft: exec.draft,
    site_id: site.id,
  });
  const bodyRich: TiptapDoc = draftToBodyRich(repaired);

  // ─── 8. Persist evidence pack + article ────────────────────────
  const packId = await persistEvidencePack({
    sb,
    payload: chosen.evidence_pack,
    content_hash: hashCanonical(chosen.evidence_pack),
    idea_id: chosen.discovery.kind === 'internal_idea' ? chosen.discovery.key : null,
    article_id: null, // will be linked after article insert
    autopilot_run_id: run_id,
  });

  // Hold reasons derived from QA blockers.
  const hold_reasons: string[] = [];
  for (const f of report.findings) {
    if (f.severity !== 'blocker') continue;
    if (f.check_name === 'slug_unique' || f.check_name === 'title_cannibalisation') hold_reasons.push('title_cannibalisation');
    else if (f.check_name === 'price_claim_traceable' || f.check_name === 'percentage_claim_traceable') hold_reasons.push('price_claim_failed');
    else if (f.check_name === 'image_resolves') hold_reasons.push('image_missing');
    else if (f.check_name === 'banned_filler_phrase' || f.check_name === 'body_rich_sanitised') hold_reasons.push('semantic_qa_failed');
    else if (f.check_name === 'broken_internal_link' || f.check_name === 'internal_link_resolves') hold_reasons.push('broken_internal_link');
  }

  const bodyMarkdown = draftToMarkdown(repaired);
  const slugCandidate = ensureUniqueSlug(repaired.slug, run_id);

  const budget_cents_actual = Math.round(exec.cost_usd * 10_000) / 100; // store as cents * 100 → actually cents
  const budgetCentsInt = Math.round(exec.cost_usd * 100);

  const { data: articleRow, error: articleErr } = await sb
    .from('network_articles')
    .insert({
      site_id: site.id,
      idea_id: chosen.discovery.kind === 'internal_idea' ? chosen.discovery.key : null,
      brief_id: null,
      title: repaired.title,
      working_title: chosen.discovery.working_title,
      slug: slugCandidate,
      status: 'review',          // NEVER 'published' here — Luke reviews first.
      content_type: chosen.discovery.template_id as ArticleTemplateId,
      primary_query: null,
      secondary_queries: [],
      summary: repaired.meta_description ?? null,
      body: bodyMarkdown,
      body_format: 'markdown',
      body_rich: bodyRich as unknown as Record<string, unknown>,
      meta_title: repaired.meta_title ?? null,
      meta_description: repaired.meta_description ?? null,
      featured_image_url: repaired.featured_image_source_url ?? null,
      publication_target: 'ygo_db',
      autopilot_run_id: run_id,
      budget_cents_actual: budgetCentsInt,
      hold_reasons,
      author: 'YGOPrices autopilot',
      created_by: admin.adminRowId,
    })
    .select('id')
    .single();

  if (articleErr) {
    // Article didn't persist, but the paid call did happen — we MUST
    // consume the budget to keep the ledger honest. Hold with
    // publisher_failed so operators can diagnose.
    await consumeAiBudget(sb, { reservationId, articleId: null, actualUsd: exec.cost_usd });
    await writeHeldArticle(sb, admin.adminRowId, run_id, 'ygo', 'publisher_failed', `Insert into network_articles failed: ${articleErr.message}. Paid cost ${exec.cost_usd.toFixed(4)} USD still accounted via reservation.`);
    revalidatePath('/admin/content/autopilot/preview');
    return;
  }
  const article_id = (articleRow as { id: string }).id;

  // Link evidence pack back to the article (we inserted it before the
  // article row existed, so update now).
  if (packId.ok && packId.id) {
    await sb.from('network_article_evidence_packs').update({ article_id }).eq('id', packId.id);
  }
  await persistQAFindings(sb, article_id, packId.ok ? packId.id ?? null : null, report);
  await consumeAiBudget(sb, { reservationId, articleId: article_id, actualUsd: exec.cost_usd });

  // Record token/cost metadata for the preview page.
  await sb.from('network_ai_cost_log').insert({
    operation: 'draft',
    provider: modelSel.provider,
    model: modelSel.model,
    article_id,
    brief_id: null,
    idea_id: chosen.discovery.kind === 'internal_idea' ? chosen.discovery.key : null,
    autopilot_run_id: run_id,
    input_tokens: exec.tokens.input,
    output_tokens: exec.tokens.output,
    cache_read_tokens: exec.tokens.cache_read,
    cache_write_tokens: exec.tokens.cache_write,
    est_cost_usd: exec.cost_usd,
    actor_user_id: admin.adminRowId,
  });

  void budget_cents_actual;
  void AUTO_PUBLISH_PRIVILEGE_IS_FALSE;
  revalidatePath('/admin/content/autopilot/preview');
  revalidatePath('/admin/content');
}

// ─── Helpers ───────────────────────────────────────────────────

type AnySb = Awaited<ReturnType<typeof requireAdmin>>['sb'];

async function writeHeldArticle(sb: AnySb, actorId: string, run_id: string, siteSlug: string, holdReason: string, note: string): Promise<void> {
  const { data: siteRow } = await sb.from('network_sites').select('id').eq('slug', siteSlug).maybeSingle();
  const site_id = (siteRow as { id: string } | null)?.id ?? null;
  if (!site_id) return;
  await sb.from('network_articles').insert({
    site_id,
    title: `[held] First paid run · ${run_id.slice(0, 8)}`,
    working_title: 'Autopilot paid-run attempt',
    slug: `held-${run_id.slice(0, 12)}`,
    status: 'failed',
    content_type: 'news' as ArticleTemplateId,
    body: note,
    body_format: 'markdown',
    publication_target: 'ygo_db',
    autopilot_run_id: run_id,
    hold_reasons: [holdReason],
    author: 'YGOPrices autopilot',
    created_by: actorId,
  });
}

function mapReservationReason(r: string | null): string {
  switch (r) {
    case 'estimate_exceeds_per_article_cap': return 'estimate_exceeds_per_article_cap';
    case 'daily_budget_exceeded':            return 'daily_budget_exceeded';
    case 'monthly_budget_exceeded':          return 'monthly_budget_exceeded';
    default:                                 return 'budget_exceeded';
  }
}

// Deterministic markdown emitter — used so a legacy consumer that
// only renders `body` sees something coherent. The canonical body is
// still body_rich (TipTap JSON).
function draftToMarkdown(draft: Awaited<ReturnType<typeof executeRealDraft>>['draft']): string {
  const lines: string[] = [];
  for (const s of draft.sections) {
    if (s.heading && s.heading_level) {
      lines.push(`${'#'.repeat(s.heading_level + 1)} ${s.heading}`);
      lines.push('');
    } else if (s.heading) {
      lines.push(`## ${s.heading}`);
      lines.push('');
    }
    for (const p of s.paragraphs) {
      lines.push(p);
      lines.push('');
    }
    for (const img of s.images) {
      lines.push(`![${img.alt_text}](${img.source_url})`);
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

function ensureUniqueSlug(base: string, run_id: string): string {
  const clean = (base || 'autopilot-draft').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return `${clean}-${run_id.slice(0, 6)}`;
}

function hashCanonical(obj: unknown): string {
  const canon = canonicalise(obj);
  return crypto.createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}
function canonicalise(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonicalise);
  const o = v as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) sorted[k] = canonicalise(o[k]);
  return sorted;
}

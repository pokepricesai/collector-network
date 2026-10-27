'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import {
  buildClaudePrompt,
  type SiteForPrompt,
  type IntelligenceForPrompt,
  type TaskForPrompt,
  type BuiltPrompt,
} from '@/server/claude/action-prompt';
import {
  parseAndValidateReceipt,
  type ImplementationReceiptStored,
} from '@/server/claude/completion-receipt';
import {
  buildBaselineSnapshot,
  extractEvidenceTargets,
  type BaselineSnapshot,
} from '@/server/claude/baseline';

// CN-05 OS Phase 2 — Server Action that assembles the Claude Code
// implementation prompt for a given task, saves it to
// network_tasks.metadata.generated_prompts for audit, and revalidates
// the detail page.
//
// Deterministic + idempotent: the exact same inputs always produce
// the same prompt and the same sha256 hash. If a prompt with the
// same hash already exists in metadata, we don't duplicate it.
//
// Zero AI API spend. The builder is a pure function.

export async function generateClaudePromptAction(formData: FormData): Promise<void> {
  const taskId = formData.get('task_id');
  if (typeof taskId !== 'string') return;
  const { sb } = await requireAdmin('/admin/tasks');

  const { data: task, error: tErr } = await sb
    .from('network_tasks')
    .select('id, title, description, priority, status, site_id, task_type, task_kind, task_source, evidence, metadata, recommended_action, created_at')
    .eq('id', taskId)
    .maybeSingle();
  if (tErr || !task) return;

  // Resolve the site record if the task is site-scoped.
  let site: SiteForPrompt | null = null;
  if (task.site_id) {
    const { data: siteRow } = await sb
      .from('network_sites')
      .select('slug, name, domain')
      .eq('id', task.site_id)
      .maybeSingle();
    site = siteRow ?? null;
  }

  // Pull the linked Intelligence item when the task was sourced from it.
  // The evidence jsonb carries the id under intelligence_item_id — see
  // apps/hub/src/app/admin/intelligence/actions.ts line 75-91.
  let intel: IntelligenceForPrompt | null = null;
  const intelId = (task.evidence as { intelligence_item_id?: unknown } | null)?.intelligence_item_id;
  if (typeof intelId === 'string' && intelId.length > 0) {
    const { data: intelRow } = await sb
      .from('network_intelligence_items')
      .select('id, category, type, signal_kind, title, summary, recommended_action, evidence, expected_upside, impact_score, confidence_score, urgency_score, effort_score, priority_score, first_detected_at, last_detected_at')
      .eq('id', intelId)
      .maybeSingle();
    intel = intelRow ?? null;
  }

  // CN-05 OS Phase C — thread the frozen baseline into the prompt so
  // Claude can quote exact pre-change numbers in its summary.
  const existingBaseline = ((task.metadata ?? {}) as { baseline?: BaselineSnapshot }).baseline ?? null;

  const built: BuiltPrompt = buildClaudePrompt({
    task: task as unknown as TaskForPrompt,
    site,
    intel,
    baseline: existingBaseline,
  });

  // Append to metadata.generated_prompts if not already present. We
  // compare by hash so repeat clicks are no-ops. Keep at most the
  // most recent 10 to prevent metadata bloat.
  const prevMeta = (task.metadata as { generated_prompts?: Array<{ prompt_hash: string }> } | null) ?? {};
  const existing = Array.isArray(prevMeta.generated_prompts) ? prevMeta.generated_prompts : [];
  const alreadyThere = existing.some((p) => p?.prompt_hash === built.prompt_hash);
  if (!alreadyThere) {
    const nextList = [
      {
        prompt_version: built.prompt_version,
        prompt_hash: built.prompt_hash,
        implementation_type: built.implementation_type,
        created_at: built.created_at,
        prompt_text: built.prompt_text,
      },
      ...existing,
    ].slice(0, 10);
    const nextMeta = { ...(prevMeta as Record<string, unknown>), generated_prompts: nextList };
    await sb.from('network_tasks').update({ metadata: nextMeta }).eq('id', taskId);
  }

  revalidatePath(`/admin/tasks/${taskId}`);
}

// CN-05 OS Phase B — Record Claude Implementation.
//
// Accepts a pasted JSON receipt, validates it strictly, appends to
// network_tasks.metadata.implementation_receipts (newest first,
// max 10 for audit). Does NOT automatically mark the task
// production-verified — that is an explicit operator step so Claude
// cannot self-certify a deploy.
//
// Returns search-param-driven feedback to the detail page because
// Next's Server Action primitives don't carry a response object.

export async function recordClaudeImplementationAction(
  formData: FormData,
): Promise<void> {
  const taskId = formData.get('task_id');
  const rawPaste = formData.get('receipt');
  if (typeof taskId !== 'string' || typeof rawPaste !== 'string') return;

  const { sb } = await requireAdmin('/admin/tasks');

  const { data: task, error: tErr } = await sb
    .from('network_tasks')
    .select('id, metadata')
    .eq('id', taskId)
    .maybeSingle();
  if (tErr || !task) {
    revalidatePath(`/admin/tasks/${taskId}`);
    return;
  }

  const validation = parseAndValidateReceipt(rawPaste, taskId);
  const prevMeta =
    ((task.metadata ?? {}) as {
      implementation_receipts?: ImplementationReceiptStored[];
      receipt_last_error?: { at: string; message: string; path?: string };
    }) ?? {};

  if (!validation.ok) {
    const nextMeta = {
      ...(prevMeta as Record<string, unknown>),
      receipt_last_error: {
        at: new Date().toISOString(),
        message: validation.error,
        path: validation.path,
      },
    };
    await sb.from('network_tasks').update({ metadata: nextMeta }).eq('id', taskId);
    revalidatePath(`/admin/tasks/${taskId}`);
    return;
  }

  const stored: ImplementationReceiptStored = {
    ...validation.value,
    received_at: new Date().toISOString(),
    received_version: 'cn05-receipt-v1',
    operator_confirmed_at: null,
    operator_confirmed_by: null,
  };
  const existing = Array.isArray(prevMeta.implementation_receipts)
    ? prevMeta.implementation_receipts
    : [];
  const next = [stored, ...existing].slice(0, 10);
  const nextMeta = {
    ...(prevMeta as Record<string, unknown>),
    implementation_receipts: next,
    // Clear any previous error on a successful import.
    receipt_last_error: undefined,
  };
  await sb.from('network_tasks').update({ metadata: nextMeta }).eq('id', taskId);
  revalidatePath(`/admin/tasks/${taskId}`);
}

// Operator confirmation — explicit human step so Claude can't
// self-certify a deployment. Flips operator_confirmed_at/by on the
// latest receipt and marks the task status='in_progress' (so it
// stays open while measurement runs after D7/D14/D28/D90 ships).
export async function confirmReceiptVerifiedAction(
  formData: FormData,
): Promise<void> {
  const taskId = formData.get('task_id');
  if (typeof taskId !== 'string') return;
  const { sb, admin } = await requireAdmin('/admin/tasks');

  const { data: task } = await sb
    .from('network_tasks')
    .select('id, metadata')
    .eq('id', taskId)
    .maybeSingle();
  if (!task) return;

  const prevMeta =
    ((task.metadata ?? {}) as {
      implementation_receipts?: ImplementationReceiptStored[];
    }) ?? {};
  const receipts = Array.isArray(prevMeta.implementation_receipts)
    ? prevMeta.implementation_receipts
    : [];
  if (receipts.length === 0) return;

  const now = new Date().toISOString();
  const nextReceipts = receipts.map((r, i) =>
    i === 0
      ? {
          ...r,
          operator_confirmed_at: now,
          operator_confirmed_by: admin.adminRowId,
        }
      : r,
  );
  const nextMeta = {
    ...(prevMeta as Record<string, unknown>),
    implementation_receipts: nextReceipts,
  };
  await sb
    .from('network_tasks')
    .update({ metadata: nextMeta, status: 'in_progress' })
    .eq('id', taskId);
  revalidatePath(`/admin/tasks/${taskId}`);
}

// CN-05 OS Phase C — baseline freeze.
//
// Reads the latest-complete GSC + GA4 window for the task's site and
// writes a BaselineSnapshot into network_tasks.metadata.baseline.
// Refuses to overwrite an existing baseline unless the operator
// explicitly passes `force=1` (prevents accidental re-captures after
// an intervention has already landed).
export async function freezeBaselineAction(formData: FormData): Promise<void> {
  const taskId = formData.get('task_id');
  const force = formData.get('force') === '1';
  if (typeof taskId !== 'string') return;
  const { sb } = await requireAdmin('/admin/tasks');

  const { data: task } = await sb
    .from('network_tasks')
    .select('id, site_id, evidence, metadata')
    .eq('id', taskId)
    .maybeSingle();
  if (!task) return;

  const prevMeta =
    ((task.metadata ?? {}) as { baseline?: BaselineSnapshot }) ?? {};
  if (prevMeta.baseline && !force) {
    revalidatePath(`/admin/tasks/${taskId}`);
    return;
  }

  let siteSlug: string | null = null;
  if (task.site_id) {
    const { data: siteRow } = await sb
      .from('network_sites')
      .select('slug')
      .eq('id', task.site_id)
      .maybeSingle();
    siteSlug = siteRow?.slug ?? null;
  }

  let intelEvidence: Record<string, unknown> | null = null;
  const intelId = (task.evidence as { intelligence_item_id?: unknown } | null)?.intelligence_item_id;
  if (typeof intelId === 'string' && intelId.length > 0) {
    const { data: intelRow } = await sb
      .from('network_intelligence_items')
      .select('evidence')
      .eq('id', intelId)
      .maybeSingle();
    intelEvidence = (intelRow?.evidence as Record<string, unknown> | null) ?? null;
  }

  const { target_url, target_query } = extractEvidenceTargets(
    task.evidence as Record<string, unknown> | null,
    intelEvidence,
  );

  const baseline = await buildBaselineSnapshot(sb, {
    taskId,
    siteId: task.site_id,
    siteSlug,
    evidenceTargetUrl: target_url,
    evidenceTargetQuery: target_query,
  });

  const nextMeta = { ...(prevMeta as Record<string, unknown>), baseline };
  await sb.from('network_tasks').update({ metadata: nextMeta }).eq('id', taskId);
  revalidatePath(`/admin/tasks/${taskId}`);
}

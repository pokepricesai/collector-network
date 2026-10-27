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

  const built: BuiltPrompt = buildClaudePrompt({
    task: task as unknown as TaskForPrompt,
    site,
    intel,
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

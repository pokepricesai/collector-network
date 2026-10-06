'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import {
  AUTOPILOT_SITE_SLUGS,
  updateAutopilotConfig,
  type AutopilotSiteSlug,
  type ScopeKey,
} from '@/server/autopilot/config';

// Narrow server actions for the autopilot settings page. Every action
// writes to network_autopilot_config via the typed helper and then
// revalidates the page.

async function updateAndRevalidate(scope: ScopeKey, key: string, value: unknown): Promise<void> {
  const { sb, admin } = await requireAdmin('/admin/content/autopilot');
  await updateAutopilotConfig(sb, scope, key, value, admin.adminRowId);
  revalidatePath('/admin/content/autopilot');
}

export async function toggleGlobalBoolAction(formData: FormData): Promise<void> {
  const key = String(formData.get('key') ?? '');
  const value = formData.get('value') === 'true';
  const allowed = new Set(['autopilot_enabled', 'auto_publish_enabled', 'refreshes_enabled']);
  if (!allowed.has(key)) return;
  await updateAndRevalidate('global', key, value);
}

export async function updateGlobalNumberAction(formData: FormData): Promise<void> {
  const key = String(formData.get('key') ?? '');
  const raw = String(formData.get('value') ?? '').trim();
  const allowed = new Set([
    'max_articles_per_day',
    'max_cost_per_article_usd',
    'daily_article_budget_usd',
    'monthly_article_budget_usd',
    'min_opportunity_score',
  ]);
  if (!allowed.has(key)) return;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return;
  await updateAndRevalidate('global', key, n);
}

export async function updateModelAction(formData: FormData): Promise<void> {
  const key = String(formData.get('key') ?? '');
  const allowed = new Set(['default_draft_model', 'fallback_model', 'semantic_qa_model']);
  if (!allowed.has(key)) return;
  const provider = String(formData.get('provider') ?? 'anthropic');
  const model = String(formData.get('model') ?? '').trim();
  const toks = Number(formData.get('max_output_tokens') ?? 4000);
  if (!model) return;
  await updateAndRevalidate('global', key, {
    provider,
    model,
    max_output_tokens: Number.isFinite(toks) ? Math.max(1, Math.floor(toks)) : 4000,
  });
}

export async function toggleSiteBoolAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('slug') ?? '');
  const key = String(formData.get('key') ?? '');
  const value = formData.get('value') === 'true';
  if (!(AUTOPILOT_SITE_SLUGS as readonly string[]).includes(slug)) return;
  if (!['enabled', 'auto_publish_allowed'].includes(key)) return;
  await updateAndRevalidate(`site:${slug as AutopilotSiteSlug}`, key, value);
}

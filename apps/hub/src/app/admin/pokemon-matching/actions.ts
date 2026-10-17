'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';

// All server actions for the Pokémon → TCGGraph matching workbench.
// Each action:
//   • calls requireAdmin(path) first (never trust client-passed creds)
//   • performs its mutation through the admin's session Supabase client,
//     so RLS enforces admin-only writes
//   • writes an append-only row to pokemon_tcg_mapping_audit via the
//     same client — no privileged bypass
//   • returns a plain { ok, ...details } object
//   • revalidates the affected admin paths
//
// NO action touches public.cards, public.card_trends, or any live
// pricing surface. Activation of TCGGraph pricing is a separate
// future gate (Phase 8); not implemented here.

type Provider = 'tcggraph' | 'justtcg';

async function writeAudit(sb: any, params: {
  mapping_id: string;
  pp_card_slug: string;
  provider: Provider;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  from_tcg_card_id?: string | null;
  to_tcg_card_id?: string | null;
  from_printing_key?: string | null;
  to_printing_key?: string | null;
  actor_user_id?: string | null;
  actor_display?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await sb.from('pokemon_tcg_mapping_audit').insert({
    mapping_id: params.mapping_id,
    pp_card_slug: params.pp_card_slug,
    provider: params.provider,
    action: params.action,
    from_status: params.from_status ?? null,
    to_status: params.to_status ?? null,
    from_tcg_card_id: params.from_tcg_card_id ?? null,
    to_tcg_card_id: params.to_tcg_card_id ?? null,
    from_printing_key: params.from_printing_key ?? null,
    to_printing_key: params.to_printing_key ?? null,
    actor_user_id: params.actor_user_id ?? null,
    actor_display: params.actor_display ?? null,
    reason: params.reason ?? null,
    metadata: (params.metadata ?? {}) as Record<string, unknown>,
  });
  if (error) throw new Error(`audit write: ${error.message}`);
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  affected?: number;
}

// -------- Approve current mapping --------

export async function approveCurrentMapping(
  pp_card_slug: string,
  options: { force?: boolean; reason?: string | null } = {},
): Promise<ActionResult> {
  const { admin, sb } = await requireAdmin(`/admin/pokemon-matching/${encodeURIComponent(pp_card_slug)}`);

  const { data: m, error: readErr } = await sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, provider, review_status, tcg_card_id, tcg_printing_key, confidence')
    .eq('pp_card_slug', pp_card_slug)
    .eq('provider', 'tcggraph')
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!m) return { ok: false, error: 'mapping not found' };
  if (!m.tcg_card_id) return { ok: false, error: 'cannot approve: no TCG card attached' };

  const { error: upErr } = await sb
    .from('pokemon_tcg_mappings')
    .update({
      review_status: 'approved',
      previous_review_status: m.review_status,
      reviewer_user_id: admin.authUserId,
      reviewer_display: admin.displayName || admin.email,
      reviewed_at: new Date().toISOString(),
      match_method: m.confidence === 'verified' ? 'auto_exact' : 'manual_approved',
    })
    .eq('id', m.id);
  if (upErr) return { ok: false, error: upErr.message };

  await writeAudit(sb, {
    mapping_id: m.id, pp_card_slug: m.pp_card_slug, provider: m.provider as Provider,
    action: 'status_change',
    from_status: m.review_status, to_status: 'approved',
    from_tcg_card_id: m.tcg_card_id, to_tcg_card_id: m.tcg_card_id,
    from_printing_key: m.tcg_printing_key, to_printing_key: m.tcg_printing_key,
    actor_user_id: admin.authUserId, actor_display: admin.displayName || admin.email,
    reason: options.reason ?? null,
  });

  revalidatePath('/admin/pokemon-matching');
  revalidatePath(`/admin/pokemon-matching/${encodeURIComponent(pp_card_slug)}`);
  return { ok: true, message: 'approved' };
}

// -------- Reassign to a specific candidate --------

export async function reassignToCandidate(
  pp_card_slug: string,
  candidate_id: string,
  options: { reason?: string | null } = {},
): Promise<ActionResult> {
  const { admin, sb } = await requireAdmin(`/admin/pokemon-matching/${encodeURIComponent(pp_card_slug)}`);

  const { data: m, error: mErr } = await sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, provider, review_status, tcg_card_id, tcg_printing_key, confidence')
    .eq('pp_card_slug', pp_card_slug)
    .eq('provider', 'tcggraph')
    .maybeSingle();
  if (mErr || !m) return { ok: false, error: mErr?.message || 'mapping not found' };

  const { data: c, error: cErr } = await sb
    .from('pokemon_tcg_mapping_candidates')
    .select('*')
    .eq('id', candidate_id)
    .eq('pp_card_slug', pp_card_slug)
    .maybeSingle();
  if (cErr || !c) return { ok: false, error: cErr?.message || 'candidate not found' };

  const { error: upErr } = await sb
    .from('pokemon_tcg_mappings')
    .update({
      tcg_card_id: c.tcg_card_id,
      tcg_printing_key: c.tcg_printing_key,
      tcg_price_card_id: c.tcg_price_card_id,
      tcg_set_code: c.tcg_set_code,
      tcg_language: c.tcg_language,
      tcg_name: c.tcg_name,
      confidence: c.confidence,
      match_method: 'manual_reassigned',
      previous_review_status: m.review_status,
      review_status: 'approved',
      reviewer_user_id: admin.authUserId,
      reviewer_display: admin.displayName || admin.email,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', m.id);
  if (upErr) return { ok: false, error: upErr.message };

  await writeAudit(sb, {
    mapping_id: m.id, pp_card_slug: m.pp_card_slug, provider: m.provider as Provider,
    action: 'reassign',
    from_status: m.review_status, to_status: 'approved',
    from_tcg_card_id: m.tcg_card_id, to_tcg_card_id: c.tcg_card_id,
    from_printing_key: m.tcg_printing_key, to_printing_key: c.tcg_printing_key,
    actor_user_id: admin.authUserId, actor_display: admin.displayName || admin.email,
    reason: options.reason ?? null,
    metadata: { candidate_id, match_method: c.match_method },
  });

  revalidatePath('/admin/pokemon-matching');
  revalidatePath(`/admin/pokemon-matching/${encodeURIComponent(pp_card_slug)}`);
  return { ok: true, message: 'reassigned + approved' };
}

// -------- Reject (set status to rejected / no_tcg_equivalent) --------

export async function rejectMapping(
  pp_card_slug: string,
  options: { kind: 'rejected' | 'no_tcg_equivalent'; reason?: string | null } = { kind: 'rejected' },
): Promise<ActionResult> {
  const { admin, sb } = await requireAdmin(`/admin/pokemon-matching/${encodeURIComponent(pp_card_slug)}`);

  const { data: m, error: mErr } = await sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, provider, review_status, tcg_card_id, tcg_printing_key')
    .eq('pp_card_slug', pp_card_slug)
    .eq('provider', 'tcggraph')
    .maybeSingle();
  if (mErr || !m) return { ok: false, error: mErr?.message || 'mapping not found' };

  const { error: upErr } = await sb
    .from('pokemon_tcg_mappings')
    .update({
      review_status: options.kind,
      previous_review_status: m.review_status,
      reviewer_user_id: admin.authUserId,
      reviewer_display: admin.displayName || admin.email,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', m.id);
  if (upErr) return { ok: false, error: upErr.message };

  await writeAudit(sb, {
    mapping_id: m.id, pp_card_slug: m.pp_card_slug, provider: m.provider as Provider,
    action: 'status_change',
    from_status: m.review_status, to_status: options.kind,
    from_tcg_card_id: m.tcg_card_id, to_tcg_card_id: m.tcg_card_id,
    from_printing_key: m.tcg_printing_key, to_printing_key: m.tcg_printing_key,
    actor_user_id: admin.authUserId, actor_display: admin.displayName || admin.email,
    reason: options.reason ?? null,
  });

  revalidatePath('/admin/pokemon-matching');
  revalidatePath(`/admin/pokemon-matching/${encodeURIComponent(pp_card_slug)}`);
  return { ok: true, message: options.kind };
}

// -------- Undo last status change --------

export async function undoMapping(pp_card_slug: string): Promise<ActionResult> {
  const { admin, sb } = await requireAdmin(`/admin/pokemon-matching/${encodeURIComponent(pp_card_slug)}`);

  const { data: m, error: mErr } = await sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, provider, review_status, previous_review_status, tcg_card_id, tcg_printing_key')
    .eq('pp_card_slug', pp_card_slug)
    .eq('provider', 'tcggraph')
    .maybeSingle();
  if (mErr || !m) return { ok: false, error: mErr?.message || 'mapping not found' };
  if (!m.previous_review_status) return { ok: false, error: 'nothing to undo' };

  const { error: upErr } = await sb
    .from('pokemon_tcg_mappings')
    .update({
      review_status: m.previous_review_status,
      previous_review_status: m.review_status,
      reviewer_user_id: admin.authUserId,
      reviewer_display: admin.displayName || admin.email,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', m.id);
  if (upErr) return { ok: false, error: upErr.message };

  await writeAudit(sb, {
    mapping_id: m.id, pp_card_slug: m.pp_card_slug, provider: m.provider as Provider,
    action: 'undo',
    from_status: m.review_status, to_status: m.previous_review_status,
    from_tcg_card_id: m.tcg_card_id, to_tcg_card_id: m.tcg_card_id,
    from_printing_key: m.tcg_printing_key, to_printing_key: m.tcg_printing_key,
    actor_user_id: admin.authUserId, actor_display: admin.displayName || admin.email,
    reason: 'undo',
  });

  revalidatePath('/admin/pokemon-matching');
  revalidatePath(`/admin/pokemon-matching/${encodeURIComponent(pp_card_slug)}`);
  return { ok: true, message: `restored to ${m.previous_review_status}` };
}

// -------- Bulk approve verified pending-review rows --------

export async function bulkApproveVerified(options: {
  dryRun?: boolean;
  language?: 'en' | 'jp' | 'all';
  maxRows?: number;
} = {}): Promise<ActionResult & { preview?: Array<{ pp_card_slug: string; pp_card_name: string | null; tcg_name: string | null }>; total_eligible?: number }> {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching');

  // Count eligible first
  let countQ = sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, pp_card_name, tcg_card_id, tcg_printing_key, tcg_name, review_status, pp_language', { count: 'exact' })
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified')
    .not('tcg_card_id', 'is', null);
  if (options.language && options.language !== 'all') countQ = countQ.eq('pp_language', options.language);
  const { data: candidates, count: eligibleCount, error: cErr } = await countQ.limit(Math.min(options.maxRows ?? 10_000, 10_000));
  if (cErr) return { ok: false, error: cErr.message };

  const preview = (candidates || []).slice(0, 20).map(r => ({
    pp_card_slug: r.pp_card_slug,
    pp_card_name: r.pp_card_name,
    tcg_name: r.tcg_name,
  }));

  if (options.dryRun) {
    return {
      ok: true,
      message: `dry-run: ${eligibleCount ?? 0} eligible for bulk approval`,
      preview,
      total_eligible: eligibleCount ?? 0,
    };
  }

  if (!candidates || candidates.length === 0) {
    return { ok: true, message: 'nothing to approve', affected: 0, total_eligible: 0 };
  }

  // Approve in batches to keep audit history explicit
  const now = new Date().toISOString();
  const BATCH = 500;
  let affected = 0;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const ids = batch.map(c => c.id);
    const { error: upErr } = await sb
      .from('pokemon_tcg_mappings')
      .update({
        review_status: 'approved',
        previous_review_status: 'pending_review',
        reviewer_user_id: admin.authUserId,
        reviewer_display: admin.displayName || admin.email,
        reviewed_at: now,
        match_method: 'auto_exact',
      })
      .in('id', ids);
    if (upErr) return { ok: false, error: upErr.message, affected };

    const auditRows = batch.map(c => ({
      mapping_id: c.id,
      pp_card_slug: c.pp_card_slug,
      provider: 'tcggraph',
      action: 'status_change' as const,
      from_status: 'pending_review',
      to_status: 'approved',
      from_tcg_card_id: c.tcg_card_id,
      to_tcg_card_id: c.tcg_card_id,
      from_printing_key: c.tcg_printing_key,
      to_printing_key: c.tcg_printing_key,
      actor_user_id: admin.authUserId,
      actor_display: admin.displayName || admin.email,
      reason: 'bulk approve verified exact',
      metadata: { source: 'bulk_approve_verified' } as Record<string, unknown>,
    }));
    const { error: auErr } = await sb.from('pokemon_tcg_mapping_audit').insert(auditRows);
    if (auErr) return { ok: false, error: `audit batch: ${auErr.message}`, affected };

    affected += batch.length;
  }

  revalidatePath('/admin/pokemon-matching');
  return { ok: true, message: `approved ${affected}`, affected, total_eligible: eligibleCount ?? 0 };
}

// -------- Add a set alias --------

export async function addSetAlias(input: {
  pp_set_name: string;
  pp_language: 'en' | 'jp';
  tcg_set_code: string;
  tcg_language: 'en' | 'ja';
  notes?: string | null;
}): Promise<ActionResult> {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching');
  const { error } = await sb.from('pokemon_tcg_set_aliases').upsert({
    pp_set_name: input.pp_set_name.trim(),
    pp_language: input.pp_language,
    tcg_set_code: input.tcg_set_code.trim(),
    tcg_language: input.tcg_language,
    notes: input.notes ?? null,
    created_by: admin.authUserId,
  }, { onConflict: 'pp_set_name,pp_language,tcg_set_code,tcg_language' });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/pokemon-matching');
  return { ok: true, message: 'alias added' };
}

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

// -------- Bulk approve: resumable + idempotent + previewable --------
//
// Only approves rows with pricing_eligibility='bulk_safe' by default.
// Allows an operator-opt-in to also include market_only or identity_only.
// Each call processes one 500-row chunk and returns the next cursor;
// the client re-invokes until the batch is done. State persists in
// pokemon_tcg_bulk_batches so a disconnect/timeout can resume.

const BULK_BATCH_SIZE = 500;

export type BulkEligibilityFilter = 'bulk_safe' | 'market_only' | 'identity_only';

export interface BulkChunkResult extends ActionResult {
  batch_id?: string;
  state?: 'running' | 'completed' | 'failed';
  total_eligible?: number;
  rows_approved?: number;
  rows_remaining?: number;
  last_pp_slug?: string | null;
  preview?: Array<{ pp_card_slug: string; pp_card_name: string | null; tcg_name: string | null; pricing_eligibility: string | null }>;
}

async function selectEligibleQuery(
  sb: any,
  pricing_eligibility: BulkEligibilityFilter,
  language?: 'en' | 'jp' | 'all',
) {
  let q = sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, pp_card_name, tcg_card_id, tcg_printing_key, tcg_name, pp_language, pricing_eligibility', { count: 'exact' })
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified')
    .eq('pricing_eligibility', pricing_eligibility)
    .not('tcg_card_id', 'is', null);
  if (language && language !== 'all') q = q.eq('pp_language', language);
  return q;
}

/** Dry-run preview: count eligible + sample 20 rows. No writes. */
export async function bulkApproveDryRun(options: {
  pricing_eligibility?: BulkEligibilityFilter;
  language?: 'en' | 'jp' | 'all';
} = {}): Promise<BulkChunkResult> {
  const { sb } = await requireAdmin('/admin/pokemon-matching');
  const pe = options.pricing_eligibility ?? 'bulk_safe';

  const q = await selectEligibleQuery(sb, pe, options.language);
  const { data, count, error } = await q.order('pp_card_slug', { ascending: true }).limit(20);
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    message: `dry-run: ${count ?? 0} rows match pricing_eligibility=${pe}` + (options.language && options.language !== 'all' ? ` language=${options.language}` : ''),
    total_eligible: count ?? 0,
    preview: (data || []).map((r: any) => ({
      pp_card_slug: r.pp_card_slug,
      pp_card_name: r.pp_card_name,
      tcg_name: r.tcg_name,
      pricing_eligibility: r.pricing_eligibility,
    })),
  };
}

/** Start a new bulk-approve batch run. Returns batch_id to resume via tick. */
export async function bulkApproveStart(options: {
  pricing_eligibility?: BulkEligibilityFilter;
  language?: 'en' | 'jp' | 'all';
  limit_total?: number;
}): Promise<BulkChunkResult> {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching');
  const pe = options.pricing_eligibility ?? 'bulk_safe';

  // Count what we'd process
  const q = await selectEligibleQuery(sb, pe, options.language);
  const { count, error: countErr } = await q.range(0, 0);
  if (countErr) return { ok: false, error: countErr.message };

  const totalEligible = Math.min(count ?? 0, options.limit_total ?? 100_000);
  if (totalEligible === 0) {
    return { ok: true, message: 'nothing to approve', total_eligible: 0, state: 'completed', rows_approved: 0, rows_remaining: 0 };
  }

  const { data: batch, error: batchErr } = await sb
    .from('pokemon_tcg_bulk_batches')
    .insert({
      kind: 'bulk_approve',
      pricing_eligibility: pe,
      pp_language: options.language && options.language !== 'all' ? options.language : null,
      requested_by: admin.authUserId,
      requested_by_email: admin.email,
      total_eligible: totalEligible,
      state: 'running',
    })
    .select('id')
    .single();
  if (batchErr || !batch) return { ok: false, error: batchErr?.message ?? 'batch create failed' };

  revalidatePath('/admin/pokemon-matching');
  return {
    ok: true,
    batch_id: batch.id,
    message: `batch started: ${totalEligible} rows queued`,
    state: 'running',
    total_eligible: totalEligible,
    rows_approved: 0,
    rows_remaining: totalEligible,
    last_pp_slug: null,
  };
}

/** Process one chunk of a running batch. Returns updated progress.
 *  Idempotent at the row level — processing is cursored on pp_card_slug
 *  which stays stable even if the same chunk is replayed (the row is
 *  already approved so the `pending_review` filter excludes it). */
export async function bulkApproveTick(batch_id: string): Promise<BulkChunkResult> {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching');

  const { data: batch, error: readErr } = await sb
    .from('pokemon_tcg_bulk_batches')
    .select('*')
    .eq('id', batch_id)
    .maybeSingle();
  if (readErr || !batch) return { ok: false, error: readErr?.message ?? 'batch not found' };
  if (batch.state !== 'running') {
    return { ok: true, state: batch.state as 'completed'|'failed'|'running',
             rows_approved: batch.rows_approved, rows_remaining: 0, batch_id,
             message: `batch is ${batch.state}` };
  }

  // Grab next 500 rows after last_pp_slug cursor
  let q = sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, pp_card_name, tcg_card_id, tcg_printing_key')
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified')
    .eq('pricing_eligibility', batch.pricing_eligibility)
    .not('tcg_card_id', 'is', null);
  if (batch.pp_language) q = q.eq('pp_language', batch.pp_language);
  if (batch.last_pp_slug) q = q.gt('pp_card_slug', batch.last_pp_slug);
  q = q.order('pp_card_slug', { ascending: true }).limit(BULK_BATCH_SIZE);

  const { data: chunk, error: chunkErr } = await q;
  if (chunkErr) {
    await sb.from('pokemon_tcg_bulk_batches')
      .update({ state: 'failed', error_message: chunkErr.message, finished_at: new Date().toISOString() })
      .eq('id', batch_id);
    return { ok: false, error: chunkErr.message };
  }

  if (!chunk || chunk.length === 0) {
    // All done
    await sb.from('pokemon_tcg_bulk_batches')
      .update({ state: 'completed', finished_at: new Date().toISOString() })
      .eq('id', batch_id);
    revalidatePath('/admin/pokemon-matching');
    return {
      ok: true,
      batch_id,
      state: 'completed',
      total_eligible: batch.total_eligible,
      rows_approved: batch.rows_approved,
      rows_remaining: 0,
      message: `batch complete: ${batch.rows_approved} rows approved`,
    };
  }

  // Update the chunk + append audit rows
  const nowIso = new Date().toISOString();
  const ids = chunk.map((r: any) => r.id);
  const { error: upErr } = await sb
    .from('pokemon_tcg_mappings')
    .update({
      review_status: 'approved',
      previous_review_status: 'pending_review',
      reviewer_user_id: admin.authUserId,
      reviewer_display: admin.displayName || admin.email,
      reviewed_at: nowIso,
      match_method: 'auto_bulk_approve',
    })
    .in('id', ids);
  if (upErr) {
    await sb.from('pokemon_tcg_bulk_batches')
      .update({ state: 'failed', error_message: upErr.message, finished_at: new Date().toISOString() })
      .eq('id', batch_id);
    return { ok: false, error: upErr.message };
  }

  const auditRows = chunk.map((c: any) => ({
    mapping_id: c.id, pp_card_slug: c.pp_card_slug, provider: 'tcggraph',
    action: 'status_change' as const,
    from_status: 'pending_review', to_status: 'approved',
    from_tcg_card_id: c.tcg_card_id, to_tcg_card_id: c.tcg_card_id,
    from_printing_key: c.tcg_printing_key, to_printing_key: c.tcg_printing_key,
    actor_user_id: admin.authUserId, actor_display: admin.displayName || admin.email,
    reason: 'bulk_approve',
    metadata: { batch_id, pricing_eligibility: batch.pricing_eligibility } as Record<string, unknown>,
  }));
  const { error: auErr } = await sb.from('pokemon_tcg_mapping_audit').insert(auditRows);
  if (auErr) {
    // Audit failure after row update: fail the batch loudly rather than silently drift
    await sb.from('pokemon_tcg_bulk_batches')
      .update({ state: 'failed', error_message: `audit: ${auErr.message}`, finished_at: new Date().toISOString() })
      .eq('id', batch_id);
    return { ok: false, error: `audit batch: ${auErr.message}` };
  }

  // Checkpoint
  const lastRow = chunk[chunk.length - 1];
  const lastSlug = (lastRow as { pp_card_slug: string }).pp_card_slug;
  const newApproved = batch.rows_approved + chunk.length;
  const { error: cpErr } = await sb.from('pokemon_tcg_bulk_batches')
    .update({
      rows_approved: newApproved,
      last_pp_slug: lastSlug,
      last_checkpoint_at: nowIso,
    })
    .eq('id', batch_id);
  if (cpErr) return { ok: false, error: `checkpoint: ${cpErr.message}` };

  const remaining = Math.max(batch.total_eligible - newApproved, 0);
  revalidatePath('/admin/pokemon-matching');
  return {
    ok: true,
    batch_id,
    state: remaining === 0 ? 'running' : 'running', // next tick confirms completion
    total_eligible: batch.total_eligible,
    rows_approved: newApproved,
    rows_remaining: remaining,
    last_pp_slug: lastSlug,
    message: `+${chunk.length} rows approved (total ${newApproved}/${batch.total_eligible})`,
  };
}

/** Cancel a running batch. Already-approved rows stay approved. */
export async function bulkApproveCancel(batch_id: string): Promise<ActionResult> {
  const { sb } = await requireAdmin('/admin/pokemon-matching');
  const { error } = await sb.from('pokemon_tcg_bulk_batches')
    .update({ state: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', batch_id)
    .eq('state', 'running');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/pokemon-matching');
  return { ok: true, message: 'cancelled; already-approved rows remain approved' };
}

/** Historic bulk-approval runs (for the panel). */
export async function recentBulkBatches(limit = 10) {
  const { sb } = await requireAdmin('/admin/pokemon-matching');
  const { data, error } = await sb
    .from('pokemon_tcg_bulk_batches')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message, batches: [] };
  return { ok: true, batches: data || [] };
}

// Legacy alias (used by the first-version BulkApproveForm). Keeps the
// name compiling until the UI is cut over. Internally delegates to the
// dry-run / start flow. Deprecated.
export async function bulkApproveVerified(options: {
  dryRun?: boolean;
  language?: 'en' | 'jp' | 'all';
} = {}): Promise<ActionResult & { preview?: Array<{ pp_card_slug: string; pp_card_name: string | null; tcg_name: string | null }>; total_eligible?: number }> {
  if (options.dryRun) {
    const res = await bulkApproveDryRun({ pricing_eligibility: 'bulk_safe', language: options.language });
    return {
      ok: res.ok,
      error: res.error,
      message: res.message,
      total_eligible: res.total_eligible,
      preview: res.preview?.map(p => ({ pp_card_slug: p.pp_card_slug, pp_card_name: p.pp_card_name, tcg_name: p.tcg_name })),
    };
  }
  return { ok: false, error: 'bulkApproveVerified is deprecated; use bulkApproveStart + bulkApproveTick' };
}

// -------- Add a set alias + preview impact --------

export async function searchTcgSetsAction(query: string, language?: 'en' | 'ja' | 'all'): Promise<ActionResult & { results?: Array<{ code: string; name: string; language: string; releasedAt: string | null; cards: number | null }> }> {
  const { sb: _sb } = await requireAdmin('/admin/pokemon-matching');
  void _sb;
  const { searchTcgSets } = await import('@/server/pokemon-matching/sets');
  const results = searchTcgSets(query, 20, language);
  return { ok: true, results };
}

/** Preview the impact of adding an alias:
 *  how many unmatched / pending_review PP cards use `pp_set_name`,
 *  and how many of them have the TCG set as a possible match. */
export async function previewAliasImpact(input: {
  pp_set_name: string;
  pp_language: 'en' | 'jp';
}): Promise<ActionResult & { pp_rows_in_set?: number; already_approved?: number; pending_or_unmatched?: number }> {
  const { sb } = await requireAdmin('/admin/pokemon-matching');
  const { data, error } = await sb
    .from('pokemon_tcg_mappings')
    .select('review_status', { count: 'exact' })
    .eq('pp_set_name', input.pp_set_name)
    .eq('pp_language', input.pp_language);
  if (error) return { ok: false, error: error.message };
  const rows = data || [];
  const alreadyApproved = rows.filter(r => r.review_status === 'approved').length;
  const pendingOrUnmatched = rows.filter(r => ['pending_review','unmatched'].includes(r.review_status)).length;
  return {
    ok: true,
    pp_rows_in_set: rows.length,
    already_approved: alreadyApproved,
    pending_or_unmatched: pendingOrUnmatched,
    message: `${rows.length} PP rows in "${input.pp_set_name}" (${input.pp_language}). ${alreadyApproved} already approved (unchanged); ${pendingOrUnmatched} pending/unmatched will be re-evaluated against the TCG set.`,
  };
}

export async function addSetAlias(input: {
  pp_set_name: string;
  pp_language: 'en' | 'jp';
  tcg_set_code: string;
  tcg_language: 'en' | 'ja';
  notes?: string | null;
}): Promise<ActionResult> {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching');

  // Verify the TCG set code is real
  const { tcgSetByCode } = await import('@/server/pokemon-matching/sets');
  const tcgSet = tcgSetByCode(input.tcg_set_code.trim());
  if (!tcgSet) return { ok: false, error: `unknown TCG set code: ${input.tcg_set_code}` };

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
  return { ok: true, message: `alias added: "${input.pp_set_name}" (${input.pp_language}) → ${input.tcg_set_code} (${tcgSet.name}, ${tcgSet.language})` };
}

export async function listAliases(): Promise<{ ok: boolean; error?: string; aliases?: Array<{ id: string; pp_set_name: string; pp_language: string; tcg_set_code: string; tcg_language: string; notes: string | null; created_at: string }> }> {
  const { sb } = await requireAdmin('/admin/pokemon-matching');
  const { data, error } = await sb.from('pokemon_tcg_set_aliases')
    .select('id, pp_set_name, pp_language, tcg_set_code, tcg_language, notes, created_at')
    .order('pp_set_name', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, aliases: data || [] };
}

export async function deleteAlias(id: string): Promise<ActionResult> {
  const { sb } = await requireAdmin('/admin/pokemon-matching');
  const { error } = await sb.from('pokemon_tcg_set_aliases').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/pokemon-matching');
  return { ok: true, message: 'alias removed. Re-run the matcher to regenerate candidates.' };
}

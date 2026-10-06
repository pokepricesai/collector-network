'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { runJobBySlug } from '@/server/jobs/registry';

// Server actions: trigger the Impact EPN backfill or daily sync via
// the central jobs registry. Routing through runJobBySlug ensures a
// network_job_runs row is written for every manual invocation — the
// same code path cron uses — so the operator view is truthful.
//
// The settings-row metadata that was broken on the first run
// (upsert on-conflict used the wrong key, see the diagnostic panel on
// the executor page) is now redundant: /admin/jobs is the canonical
// place to see completion history.

export async function executeImpactBackfillAction(): Promise<void> {
  // Admin check only (we rely on runJobBySlug's own service-role
  // client for the actual DB work).
  await requireAdmin('/admin/revenue/impact-reset/execute');
  await runJobBySlug('impact.epn.backfill_365d');
  revalidatePath('/admin/revenue/impact-reset/execute');
  revalidatePath('/admin/jobs');
}

export async function executeImpactDailySyncAction(): Promise<void> {
  await requireAdmin('/admin/revenue/impact-reset/execute');
  await runJobBySlug('impact.epn.sync_daily');
  revalidatePath('/admin/revenue/impact-reset/execute');
  revalidatePath('/admin/jobs');
}

export async function executeImpactInvoiceSyncAction(): Promise<void> {
  await requireAdmin('/admin/revenue/impact-reset/execute');
  await runJobBySlug('impact.invoices.sync');
  revalidatePath('/admin/revenue/impact-reset/execute');
  revalidatePath('/admin/jobs');
}

// Reconstructs a truthful job-run entry for the canonical EPN rows
// that were ingested before this registry existed. Reads min/max
// first_seen_at and the impact:epn:* count from the active ledger,
// writes a network_job_runs row with status=success and metadata
// explaining provenance. Does NOT re-run the ingest.
export async function reconstructCanonicalBackfillJobAction(): Promise<void> {
  const { sb } = await requireAdmin('/admin/revenue/impact-reset/execute');

  // Resolve EPN source UUIDs.
  const { data: srcData } = await sb
    .from('network_revenue_sources')
    .select('id')
    .eq('kind', 'ebay_epn');
  const sourceIds = ((srcData ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (sourceIds.length === 0) return;

  // Scan canonical rows for timing + totals. 453 rows is small; the
  // paginated read is bounded.
  interface R { idempotency_key: string | null; first_seen_at: string | null; ledger_status: string | null }
  const rows: R[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 20_000; offset += PAGE) {
    const { data } = await sb
      .from('network_revenue_events')
      .select('idempotency_key, first_seen_at, ledger_status')
      .in('source_id', sourceIds)
      .range(offset, offset + PAGE - 1);
    const page = (data ?? []) as R[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const canonical = rows.filter((r) => r.idempotency_key?.startsWith('impact:epn:'));
  if (canonical.length === 0) {
    // Nothing to reconstruct.
    return;
  }
  let firstSeenMin: string | null = null;
  let firstSeenMax: string | null = null;
  for (const r of canonical) {
    if (!r.first_seen_at) continue;
    if (!firstSeenMin || r.first_seen_at < firstSeenMin) firstSeenMin = r.first_seen_at;
    if (!firstSeenMax || r.first_seen_at > firstSeenMax) firstSeenMax = r.first_seen_at;
  }
  const byStatus = { pending: 0, confirmed: 0, reversed: 0, other: 0 };
  for (const r of canonical) {
    switch (r.ledger_status) {
      case 'pending': byStatus.pending++; break;
      case 'confirmed': byStatus.confirmed++; break;
      case 'reversed': byStatus.reversed++; break;
      default: byStatus.other++;
    }
  }

  // Avoid writing duplicate reconstruction rows.
  const { data: existing } = await sb
    .from('network_job_runs')
    .select('id')
    .eq('job_name', 'impact.epn.backfill')
    .contains('metadata', { trigger: 'reconstructed' } as unknown as Record<string, unknown>)
    .limit(1);
  if (existing && existing.length > 0) {
    // Already reconstructed; refresh the revalidation and move on.
    revalidatePath('/admin/revenue/impact-reset/execute');
    revalidatePath('/admin/jobs');
    return;
  }

  // Write one job_run via the RPCs so admin/jobs renders it like any
  // other run. We use the actual first-seen min as started_at so the
  // timing is truthful.
  const { data: id, error: startErr } = await sb.rpc('network_start_job_run', {
    p_job_name: 'impact.epn.backfill',
    p_job_type: 'sync',
    p_site_id: null,
    p_metadata: {
      trigger: 'reconstructed',
      note: 'Canonical rows were ingested before the jobs-registry wrapping existed; this entry is reconstructed from the ledger.',
      first_seen_at_min: firstSeenMin,
      first_seen_at_max: firstSeenMax,
      canonical_row_count: canonical.length,
      by_status: byStatus,
    } as unknown as Record<string, unknown>,
  });
  if (startErr) {
    return;
  }
  await sb.rpc('network_complete_job_run', {
    p_id: id as string,
    p_status: 'success',
    p_rows_examined: canonical.length,
    p_rows_inserted: canonical.length,  // all were new at the time
    p_rows_updated: 0,
    p_rows_rejected: 0,
    p_error_summary: null,
    p_metadata: {
      trigger: 'reconstructed',
      first_seen_at_min: firstSeenMin,
      first_seen_at_max: firstSeenMax,
      canonical_row_count: canonical.length,
      by_status: byStatus,
    } as unknown as Record<string, unknown>,
  });

  revalidatePath('/admin/revenue/impact-reset/execute');
  revalidatePath('/admin/jobs');
}

import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { ingestScryfallMTG, ingestYgoProDeckYGO } from '@/server/releases/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// CN-05 Growth Intelligence · Release Tracker daily ingestion.
//
// Runs the ingesters that have been VERIFIED feasible against
// permissive APIs:
//
//   * Scryfall /sets → MTG English future releases.
//   * ygoprodeck /cardsets → YGO English future releases.
//
// Everything else (Pokemon EN/JP, One Piece EN/JP, Lorcana EN)
// remains manual curation per /admin/intelligence/releases.
// A separate daily sweep (/api/cron/releases-sweep) handles the
// deterministic status transitions (date passes → released,
// source_verified_at >30d → stale flag).

export async function GET(req: Request) {
  try { assertCronCaller(req) } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 401 });
  }
  const sb = createServiceRoleSupabase();
  const started = Date.now();

  // Register the job_run so the Jobs page shows this cron.
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'releases.ingest',
    p_job_type: 'sync',
    p_site_id: null,
    p_metadata: { trigger: 'cron' } as unknown as Record<string, unknown>,
  });

  const [scryfall, ygo] = await Promise.all([
    ingestScryfallMTG(sb),
    ingestYgoProDeckYGO(sb),
  ]);
  const results = [scryfall, ygo];
  const allErrors = results.flatMap((r) => r.errors);
  const totalFetched = results.reduce((a, r) => a + r.fetched, 0);
  const totalUpserted = results.reduce((a, r) => a + r.upserted, 0);
  const totalInserted = results.reduce((a, r) => a + r.inserted, 0);
  const totalUpdated = results.reduce((a, r) => a + r.updated, 0);
  const totalDateChanges = results.reduce((a, r) => a + r.date_changes, 0);
  const totalDateProposals = results.reduce((a, r) => a + r.date_proposals, 0);
  const totalSkippedPreserved = results.reduce((a, r) => a + r.skipped_preserved, 0);
  const totalSkipped = results.reduce((a, r) => a + r.skipped, 0);

  const anyUnavailable = results.some((r) => !r.ok);
  const duration_ms = Date.now() - started;

  if (jobId) {
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: anyUnavailable ? 'warning' : allErrors.length > 0 ? 'warning' : 'success',
      p_rows_examined: totalFetched,
      p_rows_inserted: totalInserted,
      p_rows_updated: totalUpdated,
      p_rows_rejected: totalSkipped,
      p_error_summary: anyUnavailable
        ? `one or more ingesters unavailable: ${results.filter((r) => !r.ok).map((r) => r.source).join(', ')}`
        : allErrors.length > 0 ? allErrors.slice(0, 3).join(' | ') : null,
      p_metadata: {
        duration_ms,
        per_source: results.map((r) => ({
          source: r.source, ok: r.ok, fetched: r.fetched, upserted: r.upserted,
          inserted: r.inserted, updated: r.updated,
          date_changes: r.date_changes, date_proposals: r.date_proposals,
          skipped_preserved: r.skipped_preserved,
          skipped: r.skipped, errors: r.errors.length,
        })),
      } as unknown as Record<string, unknown>,
    });
  }

  return NextResponse.json({
    ok: !anyUnavailable,
    duration_ms,
    totals: {
      fetched: totalFetched,
      upserted: totalUpserted,
      inserted: totalInserted,
      updated: totalUpdated,
      date_changes: totalDateChanges,
      date_proposals: totalDateProposals,
      skipped_preserved: totalSkippedPreserved,
      skipped: totalSkipped,
    },
    results,
  }, { status: anyUnavailable ? 207 : 200 });
}

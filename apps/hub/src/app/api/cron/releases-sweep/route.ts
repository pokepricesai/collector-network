import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// CN-05 Growth Intelligence · Release Tracker daily sweep.
//
// Transitions releases past their date to 'released' and writes a
// status_changed change-log entry. Flags rows whose
// source_verified_at is older than 30 days as stale (via metadata)
// so the UI can warn the operator.
//
// Does NOT scrape publisher sites. v1 is manual-curation first —
// the daily sweep handles the deterministic status transitions
// that don't need an external fetch.

interface ReleaseLite {
  id: string;
  release_date: string | null;
  release_date_precision: string;
  confirmation_status: string;
  source_verified_at: string | null;
  metadata: Record<string, unknown> | null;
}

export async function GET(req: Request) {
  try { assertCronCaller(req) } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 401 });
  }
  const sb = createServiceRoleSupabase();
  const started = Date.now();

  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'releases.sweep',
    p_job_type: 'maintenance',
    p_site_id: null,
    p_metadata: { trigger: 'cron' } as unknown as Record<string, unknown>,
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const staleCutoff = new Date(Date.now() - 30 * 86400000).toISOString();

  // 1. Mark releases whose date is now in the past AND
  //    confirmation_status is confirmed → released.
  const { data: toRelease, error: readErr } = await sb
    .from('network_tcg_releases')
    .select('id, release_date, release_date_precision, confirmation_status, source_verified_at, metadata')
    .eq('confirmation_status', 'confirmed')
    .not('release_date', 'is', null)
    .lt('release_date', todayIso)
    .limit(500);

  const result = {
    ok: true, job_run_id: (jobId as string | null) ?? null, today: todayIso,
    marked_released: 0, flagged_stale: 0, errors: [] as string[],
  };

  if (readErr) {
    result.errors.push(`read failed: ${readErr.message}`);
  } else {
    const rows = (toRelease ?? []) as ReleaseLite[];
    for (const r of rows) {
      // Honour precision — month-only releases pass when we're
      // past the end of their stated month (not their stated day).
      let effectiveDate = r.release_date!;
      if (r.release_date_precision === 'month') {
        const d = new Date(effectiveDate + 'T00:00:00Z');
        d.setUTCMonth(d.getUTCMonth() + 1);
        d.setUTCDate(0);
        effectiveDate = d.toISOString().slice(0, 10);
      }
      if (effectiveDate >= todayIso) continue;
      const now = new Date().toISOString();
      const { error: updErr } = await sb.from('network_tcg_releases').update({
        confirmation_status: 'released',
      }).eq('id', r.id).eq('confirmation_status', 'confirmed');
      if (updErr) {
        result.errors.push(`${r.id}: ${updErr.message}`);
        continue;
      }
      await sb.from('network_tcg_release_changes').insert({
        release_id: r.id, change_type: 'status_changed',
        previous_value: { confirmation_status: 'confirmed' },
        new_value: { confirmation_status: 'released', reason: 'date_passed' },
        changed_at: now, change_source: 'daily_sweep',
      });
      result.marked_released += 1;
    }
  }

  // 2. Flag rows with stale source_verified_at (>30 days). We
  //    write a metadata.stale_as_of flag so the UI can surface it;
  //    we do NOT auto-cancel or delete.
  const { data: staleRows, error: staleErr } = await sb
    .from('network_tcg_releases')
    .select('id, source_verified_at, metadata')
    .not('source_verified_at', 'is', null)
    .lt('source_verified_at', staleCutoff)
    .in('confirmation_status', ['confirmed', 'announced_tbc', 'rumoured', 'postponed'])
    .limit(500);
  if (staleErr) {
    result.errors.push(`stale read failed: ${staleErr.message}`);
  } else {
    const rows = (staleRows ?? []) as Array<{ id: string; source_verified_at: string | null; metadata: Record<string, unknown> | null }>;
    for (const r of rows) {
      const meta = r.metadata ?? {};
      if ((meta as { stale_as_of?: string }).stale_as_of) continue;   // already flagged
      await sb.from('network_tcg_releases').update({
        metadata: { ...meta, stale_as_of: new Date().toISOString() },
      }).eq('id', r.id);
      result.flagged_stale += 1;
    }
  }

  const duration_ms = Date.now() - started;
  if (jobId) {
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: result.errors.length > 0 ? 'warning' : 'success',
      p_rows_examined: (toRelease?.length ?? 0) + (staleRows?.length ?? 0),
      p_rows_updated: result.marked_released + result.flagged_stale,
      p_rows_inserted: result.marked_released,  // one changelog row per marked_released
      p_rows_rejected: 0,
      p_error_summary: result.errors.length > 0 ? result.errors.slice(0, 3).join(' | ') : null,
      p_metadata: { duration_ms, marked_released: result.marked_released, flagged_stale: result.flagged_stale } as unknown as Record<string, unknown>,
    });
  }

  return NextResponse.json({ ...result, duration_ms }, { status: result.errors.length > 0 ? 500 : 200 });
}

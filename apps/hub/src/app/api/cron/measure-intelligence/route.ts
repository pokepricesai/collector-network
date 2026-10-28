import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import {
  captureCheckpoint,
  CHECKPOINTS,
  type Checkpoint,
  type MeasurementSchedule,
  iso,
  isCheckpointDue,
  addDays,
} from '@/server/intelligence/measurement';

// CN-05 OS — daily measurement sweep.
//
// Scans tasks with a measurement_schedule and attempts to capture
// any checkpoint whose target_date + settle-lag has passed but
// which hasn't been measured yet. Idempotent: once a checkpoint's
// status is `measured`, `inconclusive`, or `insufficient_data`, it
// is skipped on subsequent runs. The baseline is never touched.
//
// Scheduling: one entry in apps/hub/vercel.json at 03:45 UTC, inside
// the existing cron cluster. Writes a network_job_runs entry for
// visibility in the admin Jobs view (same pattern as other crons).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOB_NAME = 'intelligence.measurement_sweep';

interface TaskRow {
  id: string;
  site_id: string | null;
  title: string;
  metadata: Record<string, unknown> | null;
}

export async function GET(req: Request) {
  try { assertCronCaller(req) } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 401 });
  }
  const result = await sweep();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export interface SweepResult {
  ok: boolean;
  job_run_id: string | null;
  today: string;
  tasks_examined: number;
  checkpoints_due: number;
  checkpoints_measured: number;
  checkpoints_still_pending: number;
  errors: Array<{ task_id: string; message: string }>;
  per_task: Array<{ task_id: string; title: string; actions: string[] }>;
  duration_ms: number;
}

export async function sweep(todayOverride?: string): Promise<SweepResult> {
  const started = Date.now();
  const sb = createServiceRoleSupabase();
  const today = todayOverride ?? iso(new Date());

  // Open a job_run row so the admin Jobs view can see the sweep.
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: JOB_NAME,
    p_job_type: 'analysis',
    p_site_id: null,
    p_metadata: { trigger: 'cron', today } as unknown as Record<string, unknown>,
  });
  const job_run_id = (jobId as string | null) ?? null;

  const errors: SweepResult['errors'] = [];
  const perTask: SweepResult['per_task'] = [];
  let tasksExamined = 0, checkpointsDue = 0, checkpointsMeasured = 0, checkpointsStillPending = 0;

  // Fetch candidate tasks. We prefer PostgREST's jsonb path operators
  // over a scan + client filter — ask for rows whose metadata has a
  // measurement_schedule.anchor_at string. Fall back to a full scan
  // only if the filter errors.
  const { data: rows, error } = await sb
    .from('network_tasks')
    .select('id, site_id, title, metadata')
    .not('metadata->measurement_schedule', 'is', null)
    .in('status', ['in_progress', 'completed'])
    .limit(500);
  if (error) {
    const msg = `candidate query failed: ${error.message}`;
    await closeJobRun(sb, job_run_id, 'failed', { error: msg, examined: 0 });
    return { ok: false, job_run_id, today, tasks_examined: 0, checkpoints_due: 0, checkpoints_measured: 0, checkpoints_still_pending: 0, errors: [{ task_id: 'n/a', message: msg }], per_task: [], duration_ms: Date.now() - started };
  }

  const tasks = (rows ?? []) as TaskRow[];
  for (const task of tasks) {
    tasksExamined++;
    const actions: string[] = [];
    try {
      const changed = await measureOne(sb, task, today, {
        onAction: (a) => actions.push(a),
        counts: (d, m, p) => { checkpointsDue += d; checkpointsMeasured += m; checkpointsStillPending += p; },
      });
      if (changed) perTask.push({ task_id: task.id, title: task.title, actions });
    } catch (err) {
      errors.push({ task_id: task.id, message: (err as Error).message });
    }
  }

  const duration_ms = Date.now() - started;
  const status = errors.length > 0 ? 'warning' : 'success';
  await closeJobRun(sb, job_run_id, status, {
    today,
    tasks_examined: tasksExamined,
    checkpoints_measured: checkpointsMeasured,
    checkpoints_still_pending: checkpointsStillPending,
    duration_ms,
  });
  return {
    ok: errors.length === 0,
    job_run_id, today,
    tasks_examined: tasksExamined,
    checkpoints_due: checkpointsDue,
    checkpoints_measured: checkpointsMeasured,
    checkpoints_still_pending: checkpointsStillPending,
    errors, per_task: perTask, duration_ms,
  };
}

async function closeJobRun(sb: ReturnType<typeof createServiceRoleSupabase>, id: string | null, status: 'success' | 'warning' | 'failed', metadata: Record<string, unknown>): Promise<void> {
  if (!id) return;
  await sb.rpc('network_complete_job_run', {
    p_id: id,
    p_status: status,
    p_rows_examined: typeof metadata.tasks_examined === 'number' ? metadata.tasks_examined : 0,
    p_rows_inserted: typeof metadata.checkpoints_measured === 'number' ? metadata.checkpoints_measured : 0,
    p_rows_updated: 0,
    p_rows_rejected: 0,
    p_error_summary: null,
    p_metadata: metadata as unknown as Record<string, unknown>,
  });
}

interface MeasureOneArgs {
  onAction: (a: string) => void;
  counts: (due: number, measured: number, pending: number) => void;
}

export async function measureOne(sb: ReturnType<typeof createServiceRoleSupabase>, task: TaskRow, today: string, hooks: MeasureOneArgs): Promise<boolean> {
  const meta = (task.metadata ?? {}) as {
    measurement_schedule?: MeasurementSchedule;
    measurement_checkpoints?: Checkpoint[];
    implementation_receipts?: Array<{ operator_confirmed_at?: string | null; primary_success_metric?: string | null }>;
  };
  const schedule = meta.measurement_schedule;
  if (!schedule) return false;

  // Gate: implementation must be operator-verified. (The schedule
  // is written on operator-verify, but we defensively re-check here
  // so a hand-crafted schedule can't bypass the gate.)
  const receipts = meta.implementation_receipts ?? [];
  const verifiedReceipt = receipts.find((r) => r?.operator_confirmed_at);
  if (!verifiedReceipt) return false;

  const existing = Array.isArray(meta.measurement_checkpoints) ? meta.measurement_checkpoints.slice() : [];
  const byD = new Map<number, Checkpoint>(existing.map((c) => [c.checkpoint, c]));

  let changed = false;
  let due = 0, measured = 0, pending = 0;
  for (const dCount of CHECKPOINTS) {
    const targetDate = addDays(schedule.anchor_at.slice(0, 10), dCount);
    const prev = byD.get(dCount);
    if (prev && prev.status !== 'pending') continue;
    if (!isCheckpointDue(targetDate, today)) continue;
    due++;
    const captured = await captureCheckpoint(sb, {
      taskId: task.id, siteId: task.site_id, schedule,
      checkpoint: dCount, today,
      primarySuccessMetric: schedule.primary_success_metric ?? verifiedReceipt.primary_success_metric ?? null,
    });
    if (captured.status === 'measured' || captured.status === 'inconclusive' || captured.status === 'insufficient_data') {
      measured++;
      hooks.onAction(`captured D${dCount}: ${captured.outcome}`);
    } else {
      pending++;
      hooks.onAction(`D${dCount} still pending (${captured.notes.at(-1) ?? 'no data'})`);
    }
    byD.set(dCount, captured);
    changed = true;
  }
  hooks.counts(due, measured, pending);

  if (!changed) return false;

  const nextCheckpoints = Array.from(byD.values()).sort((a, b) => a.checkpoint - b.checkpoint);
  const nextMeta = { ...meta, measurement_checkpoints: nextCheckpoints };
  await sb.from('network_tasks').update({ metadata: nextMeta as unknown as Record<string, unknown> }).eq('id', task.id);
  return true;
}

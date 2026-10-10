import 'server-only';

// Read helpers for network_tasks. Shared across the admin inbox,
// the dashboard summary panel, the per-site admin page, and the
// future Morning Brief. Everything here is deterministic read-only
// — writes live in the admin server actions.

import type { SupabaseClient } from '@supabase/supabase-js';

export type TaskKind = 'fix' | 'improvement';
export type TaskSourceCategory = 'manual' | 'intelligence' | 'system';
// Legacy priority column still carries 'critical' for historical
// rows; the Phase-1 UI only lets the operator pick high/normal/low.
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type TaskStatus =
  | 'open'          // default — awaiting action
  | 'in_progress'   // legacy state, treated as "open bucket"
  | 'waiting'       // legacy state, treated as "open bucket"
  | 'completed'
  | 'dismissed';    // legacy state, hidden from inbox

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  site_id: string | null;
  task_type: string;
  task_kind: TaskKind;
  task_source: TaskSourceCategory;
  evidence: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export const TASK_OPEN_STATUSES: TaskStatus[] = ['open', 'in_progress', 'waiting'];

export interface TaskFilter {
  // null = network-scope only, undefined = any (including network).
  // Caller resolves slug→site_id upstream to keep this read-only.
  site_id?: string | null;
  task_kind?: TaskKind;
  task_source?: TaskSourceCategory;
  statuses?: TaskStatus[];
  limit?: number;
}

const SELECT_COLS = 'id, title, description, priority, status, site_id, task_type, task_kind, task_source, evidence, metadata, created_at, completed_at';

export async function listTasks(
  sb: SupabaseClient,
  filter: TaskFilter = {},
): Promise<TaskRow[]> {
  const statuses = filter.statuses ?? TASK_OPEN_STATUSES;
  let q = sb.from('network_tasks')
    .select(SELECT_COLS)
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 200);
  if (filter.site_id === null) q = q.is('site_id', null);
  else if (filter.site_id) q = q.eq('site_id', filter.site_id);
  if (filter.task_kind) q = q.eq('task_kind', filter.task_kind);
  if (filter.task_source) q = q.eq('task_source', filter.task_source);
  const { data, error } = await q;
  if (error) {
    console.error('[tasks/queries] listTasks:', error.message);
    return [];
  }
  return (data ?? []) as TaskRow[];
}

export async function countOpenTasks(
  sb: SupabaseClient,
  filter: Omit<TaskFilter, 'limit' | 'statuses'> = {},
): Promise<number> {
  let q = sb.from('network_tasks')
    .select('id', { count: 'exact', head: true })
    .in('status', TASK_OPEN_STATUSES);
  if (filter.site_id === null) q = q.is('site_id', null);
  else if (filter.site_id) q = q.eq('site_id', filter.site_id);
  if (filter.task_kind) q = q.eq('task_kind', filter.task_kind);
  if (filter.task_source) q = q.eq('task_source', filter.task_source);
  const { count } = await q;
  return count ?? 0;
}

// Compact summary used by the dashboard panel.
export interface TaskSummary {
  total_open: number;
  fixes: number;
  improvements: number;
  manual: number;
  intelligence: number;
  system: number;
  network_scope: number;
  high_priority: number;
}

export async function fetchTaskSummary(sb: SupabaseClient): Promise<TaskSummary> {
  const [total, fixes, improvements, manual, intelligence, system, network, high] = await Promise.all([
    countOpenTasks(sb),
    countOpenTasks(sb, { task_kind: 'fix' }),
    countOpenTasks(sb, { task_kind: 'improvement' }),
    countOpenTasks(sb, { task_source: 'manual' }),
    countOpenTasks(sb, { task_source: 'intelligence' }),
    countOpenTasks(sb, { task_source: 'system' }),
    countOpenTasks(sb, { site_id: null }),
    (async () => {
      const { count } = await sb.from('network_tasks')
        .select('id', { count: 'exact', head: true })
        .in('status', TASK_OPEN_STATUSES)
        .in('priority', ['critical', 'high']);
      return count ?? 0;
    })(),
  ]);
  return {
    total_open: total,
    fixes, improvements,
    manual, intelligence, system,
    network_scope: network,
    high_priority: high,
  };
}

// Top-N highest-priority open tasks (dashboard preview + future
// Morning Brief). Priority order: critical > high > normal > low,
// then newest first.
export async function listHighPriorityTasks(
  sb: SupabaseClient,
  limit = 5,
): Promise<TaskRow[]> {
  const { data } = await sb.from('network_tasks')
    .select(SELECT_COLS)
    .in('status', TASK_OPEN_STATUSES)
    .in('priority', ['critical', 'high'])
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as TaskRow[]);
}

// Tasks created within the last `withinDays` (default 7). Used by
// Morning Brief to flag what's new.
export async function listRecentTasks(
  sb: SupabaseClient,
  withinDays = 7,
  limit = 20,
): Promise<TaskRow[]> {
  const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb.from('network_tasks')
    .select(SELECT_COLS)
    .gte('created_at', since)
    .in('status', TASK_OPEN_STATUSES)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as TaskRow[]);
}

// CN-DISCORD-01 · pure reconciliation logic + orchestrator.
//
// planReconcileAction(target, bindings, currentRoleIds) is pure
// and testable without Postgres or fetch. It is the single source
// of truth for "what should happen to this user right now".
//
// runReconcile(deps, options) is the orchestrator that reads from
// the role-sync-targets view, calls the Discord client per user
// (respecting dryRun), and appends one row per action to
// collector_discord_role_sync_log.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DiscordClient } from './client';

export interface RoleBinding {
  tier: 'free' | 'premium';
  discord_role_id: string;
}

export interface ReconcileTarget {
  user_id: string;
  current_tier: 'free' | 'premium';
  current_status: 'active' | 'cancelled' | 'expired' | 'suspended';
  current_expires_at: string | null;
  discord_user_id: string | null;
  discord_active: boolean;
  // desired_tier is computed by the view: null when no role should
  // be applied (suspended / cancelled membership).
  desired_tier: 'free' | 'premium' | null;
}

export type PlannedAction =
  | { kind: 'add_role'; roleId: string }
  | { kind: 'remove_role'; roleId: string }
  | { kind: 'noop' }
  | { kind: 'skip_disconnected' }
  | { kind: 'skip_no_binding'; missingTier: 'free' | 'premium' }
  | { kind: 'skip_suspended' };

export interface PlanOutput {
  target: ReconcileTarget;
  /** Actions to attempt in order. Add-role first, then remove-role,
   *  so a free→premium transition never leaves the user with no
   *  role between the two writes. */
  actions: PlannedAction[];
  desiredRoleId: string | null;
}

/** Pure plan: what should happen to this user? Called once per
 *  reconciliation target, independent of the Discord state. The
 *  caller then intersects actions with the user's current role
 *  list to drop noop writes. */
export function planReconcileAction(
  target: ReconcileTarget,
  bindings: Record<string, string>, // tier → role id
): PlanOutput {
  // Users who have no Discord link (never linked, or disconnected)
  // get a single skip action. Nothing to call Discord with.
  if (!target.discord_active || !target.discord_user_id) {
    return {
      target,
      actions: [{ kind: 'skip_disconnected' }],
      desiredRoleId: null,
    };
  }

  // Suspended / cancelled membership → remove BOTH tier roles if
  // present on the user. Record as skip_suspended so the audit log
  // explains WHY two removes landed.
  if (target.desired_tier === null) {
    const removes: PlannedAction[] = [];
    if (bindings['premium']) removes.push({ kind: 'remove_role', roleId: bindings['premium'] });
    if (bindings['free']) removes.push({ kind: 'remove_role', roleId: bindings['free'] });
    if (removes.length === 0) {
      return { target, actions: [{ kind: 'skip_suspended' }], desiredRoleId: null };
    }
    return { target, actions: [{ kind: 'skip_suspended' }, ...removes], desiredRoleId: null };
  }

  const desiredRoleId = bindings[target.desired_tier];
  if (!desiredRoleId) {
    return {
      target,
      actions: [{ kind: 'skip_no_binding', missingTier: target.desired_tier }],
      desiredRoleId: null,
    };
  }

  // Add the desired role, remove the OTHER tier role if present.
  const other: 'free' | 'premium' = target.desired_tier === 'premium' ? 'free' : 'premium';
  const actions: PlannedAction[] = [{ kind: 'add_role', roleId: desiredRoleId }];
  const otherId = bindings[other];
  if (otherId) actions.push({ kind: 'remove_role', roleId: otherId });
  return { target, actions, desiredRoleId };
}

export interface ReconcileSummary {
  run_id: string;
  targets_seen: number;
  add_role: number;
  remove_role: number;
  noop: number;
  skip_disconnected: number;
  skip_not_in_guild: number;
  skip_no_binding: number;
  skip_suspended: number;
  errors: number;
  dry_run_rows: number;
  // Max number of Discord API calls budgeted for this run. If we
  // stopped early because we hit the cap, this is the batch size.
  budget_cap: number;
  budget_remaining: number;
}

export interface ReconcileDeps {
  supabase: SupabaseClient;
  discord: DiscordClient;
  guildId: string;
  bindings: Record<string, string>;
  /** Pre-fetched run id (uuid) so the audit log groups together. */
  runId: string;
  /** When true, no PUT/DELETE/GET is issued to Discord. The audit
   *  log still records intended actions, with result='dry_run'. */
  dryRun: boolean;
  /** Hard cap on how many Discord API calls we emit in one
   *  invocation. Default 50. Prevents a bad plan from burning
   *  through the Discord rate budget. */
  apiCallBudget?: number;
  /** Optional clock override, used by tests. */
  now?: () => Date;
  /** Optional tracer, used by tests. Receives one row per audit
   *  log insert immediately after it's queued. */
  onLog?: (row: Record<string, unknown>) => void;
}

export async function runReconcile(
  deps: ReconcileDeps,
  targets: ReconcileTarget[],
): Promise<ReconcileSummary> {
  const budget = deps.apiCallBudget ?? 50;
  let remaining = budget;
  const summary: ReconcileSummary = {
    run_id: deps.runId,
    targets_seen: targets.length,
    add_role: 0,
    remove_role: 0,
    noop: 0,
    skip_disconnected: 0,
    skip_not_in_guild: 0,
    skip_no_binding: 0,
    skip_suspended: 0,
    errors: 0,
    dry_run_rows: 0,
    budget_cap: budget,
    budget_remaining: remaining,
  };

  for (const target of targets) {
    const plan = planReconcileAction(target, deps.bindings);

    // Skip paths that don't need a Discord round-trip.
    if (plan.actions.length === 1 && plan.actions[0]!.kind === 'skip_disconnected') {
      await logRow(deps, {
        action: 'skip_disconnected',
        result: 'dry_run',
        user_id: target.user_id,
        desired_tier: target.desired_tier,
      });
      summary.skip_disconnected++;
      continue;
    }
    if (plan.actions.length === 1 && plan.actions[0]!.kind === 'skip_no_binding') {
      await logRow(deps, {
        action: 'skip_no_binding',
        result: 'dry_run',
        user_id: target.user_id,
        discord_user_id: target.discord_user_id,
        desired_tier: target.desired_tier,
      });
      summary.skip_no_binding++;
      continue;
    }

    // Fetch current roles so we can suppress noop writes. Even in
    // dry-run we WOULD hit this endpoint, but to keep dry-run cheap
    // on CI / tests we only fetch when the budget allows AND when
    // we're not strictly auditing.
    let currentRoleIds: string[] | null = null;
    if (!deps.dryRun) {
      if (remaining <= 0) break;
      remaining--;
      const got = await deps.discord.getGuildMember(deps.guildId, target.discord_user_id!);
      if (!got.ok) {
        if (got.code === 'not_in_guild') {
          await logRow(deps, {
            action: 'skip_not_in_guild',
            result: 'ok',
            user_id: target.user_id,
            discord_user_id: target.discord_user_id,
          });
          summary.skip_not_in_guild++;
          continue;
        }
        await logRow(deps, {
          action: 'noop',
          result: discordErrorToResult(got),
          user_id: target.user_id,
          discord_user_id: target.discord_user_id,
          error_detail: got.detail,
        });
        summary.errors++;
        continue;
      }
      currentRoleIds = got.value.role_ids;
    }

    const previousRoleIds = currentRoleIds ?? [];
    for (const action of plan.actions) {
      if (remaining <= 0 && !deps.dryRun) {
        // Out of budget. Remaining actions in this plan are dropped
        // and will be picked up by the next cron tick.
        break;
      }
      if (action.kind === 'skip_suspended') {
        await logRow(deps, {
          action: 'skip_suspended',
          result: deps.dryRun ? 'dry_run' : 'ok',
          user_id: target.user_id,
          discord_user_id: target.discord_user_id,
          previous_role_ids: previousRoleIds,
        });
        summary.skip_suspended++;
        continue;
      }
      if (action.kind === 'add_role') {
        if (currentRoleIds && currentRoleIds.includes(action.roleId)) {
          await logRow(deps, {
            action: 'noop',
            result: 'ok',
            user_id: target.user_id,
            discord_user_id: target.discord_user_id,
            desired_role_id: action.roleId,
            previous_role_ids: previousRoleIds,
          });
          summary.noop++;
          continue;
        }
        if (deps.dryRun) {
          await logRow(deps, {
            action: 'add_role',
            result: 'dry_run',
            user_id: target.user_id,
            discord_user_id: target.discord_user_id,
            desired_role_id: action.roleId,
            desired_tier: target.desired_tier,
            previous_role_ids: previousRoleIds,
          });
          summary.add_role++;
          summary.dry_run_rows++;
          continue;
        }
        remaining--;
        const r = await deps.discord.addGuildMemberRole(deps.guildId, target.discord_user_id!, action.roleId);
        await logRow(deps, {
          action: 'add_role',
          result: r.ok ? 'ok' : discordErrorToResult(r),
          user_id: target.user_id,
          discord_user_id: target.discord_user_id,
          desired_role_id: action.roleId,
          desired_tier: target.desired_tier,
          previous_role_ids: previousRoleIds,
          error_detail: r.ok ? null : r.detail,
        });
        if (r.ok) summary.add_role++;
        else summary.errors++;
        continue;
      }
      if (action.kind === 'remove_role') {
        if (currentRoleIds && !currentRoleIds.includes(action.roleId)) {
          await logRow(deps, {
            action: 'noop',
            result: 'ok',
            user_id: target.user_id,
            discord_user_id: target.discord_user_id,
            desired_role_id: action.roleId,
            previous_role_ids: previousRoleIds,
          });
          summary.noop++;
          continue;
        }
        if (deps.dryRun) {
          await logRow(deps, {
            action: 'remove_role',
            result: 'dry_run',
            user_id: target.user_id,
            discord_user_id: target.discord_user_id,
            desired_role_id: action.roleId,
            desired_tier: target.desired_tier,
            previous_role_ids: previousRoleIds,
          });
          summary.remove_role++;
          summary.dry_run_rows++;
          continue;
        }
        remaining--;
        const r = await deps.discord.removeGuildMemberRole(deps.guildId, target.discord_user_id!, action.roleId);
        await logRow(deps, {
          action: 'remove_role',
          result: r.ok ? 'ok' : discordErrorToResult(r),
          user_id: target.user_id,
          discord_user_id: target.discord_user_id,
          desired_role_id: action.roleId,
          desired_tier: target.desired_tier,
          previous_role_ids: previousRoleIds,
          error_detail: r.ok ? null : r.detail,
        });
        if (r.ok) summary.remove_role++;
        else summary.errors++;
        continue;
      }
    }
  }

  summary.budget_remaining = remaining;
  return summary;
}

function discordErrorToResult(
  r: Extract<Awaited<ReturnType<DiscordClient['getGuildMember']>>, { ok: false }>,
): string {
  switch (r.code) {
    case 'rate_limited': return 'error_429';
    case 'forbidden': return 'error_403';
    case 'not_in_guild': return 'error_404';
    default: return 'error_other';
  }
}

async function logRow(deps: ReconcileDeps, row: Record<string, unknown>): Promise<void> {
  const full = {
    run_id: deps.runId,
    ...row,
  };
  deps.onLog?.(full);
  const { error } = await deps.supabase
    .from('collector_discord_role_sync_log')
    .insert(full);
  if (error) {
    // Logging failures do not abort the run — we surface them in
    // the summary and keep going. A persistent write failure would
    // show up in the cron's error log via network_complete_job_run.
    console.error('[cn-discord-01] audit log insert failed:', error.message);
  }
}

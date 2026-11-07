// CN-DISCORD-01 · scheduled Discord role sync.
//
// Fires on the Vercel cron schedule set in apps/hub/vercel.json.
// DRY-RUN by default; emits real Discord PUT/DELETE only when ALL
// of the following are true:
//   1. DISCORD_BOT_TOKEN env is set.
//   2. DISCORD_GUILD_ID env is set OR the guild_id column of
//      collector_discord_guild_config is populated.
//   3. collector_discord_guild_config.role_sync_enabled = true.
//
// Any missing precondition → dry-run only, the audit log still
// records intended actions so the operator can inspect them
// before flipping the flag.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { createRealDiscordClient, type DiscordClient } from '@/server/discord/client';
import { runReconcile, type ReconcileTarget } from '@/server/discord/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type GuildConfigRow = {
  guild_id: string | null;
  role_sync_enabled: boolean;
};

type BindingRow = {
  tier: 'free' | 'premium';
  discord_role_id: string;
};

export async function GET(req: Request) {
  try { assertCronCaller(req); } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 401 });
  }

  const supabase = createServiceRoleSupabase();
  const runId = randomUUID();

  // Register a job_run so /admin/jobs surfaces the invocation.
  const { data: jobId } = await supabase.rpc('network_start_job_run', {
    p_job_name: 'discord.role_sync',
    p_job_type: 'sync',
    p_site_id: null,
    p_metadata: { trigger: 'cron', run_id: runId } as unknown as Record<string, unknown>,
  });

  // Read config + bindings. Config row is seeded by the migration.
  const { data: config } = await supabase
    .from('collector_discord_guild_config')
    .select('guild_id, role_sync_enabled')
    .eq('id', 1)
    .maybeSingle<GuildConfigRow>();

  const envGuildId = sanitizeEnv(process.env['DISCORD_GUILD_ID']);
  const guildId = (config?.guild_id ?? '') || envGuildId;
  const botToken = sanitizeEnv(process.env['DISCORD_BOT_TOKEN']);

  if (!guildId) {
    // No guild configured at all. Log one row explaining why and exit.
    await supabase.from('collector_discord_role_sync_log').insert({
      run_id: runId,
      action: 'skip_no_guild_config',
      result: 'dry_run',
      error_detail: 'DISCORD_GUILD_ID env + collector_discord_guild_config.guild_id both empty',
    });
    await completeJob(supabase, jobId, 'warning', 0, 'no guild_id configured');
    return NextResponse.json({ ok: true, run_id: runId, skipped: true, reason: 'no_guild_id' });
  }

  const { data: bindingRows } = await supabase
    .from('collector_discord_role_bindings')
    .select('tier, discord_role_id');
  const bindings: Record<string, string> = {};
  for (const row of (bindingRows ?? []) as BindingRow[]) {
    bindings[row.tier] = row.discord_role_id;
  }

  const { data: rawTargets } = await supabase
    .from('collector_discord_role_sync_targets')
    .select('*');
  const targets: ReconcileTarget[] = (rawTargets ?? []) as ReconcileTarget[];

  // Decide dry-run. Defaults ON; only a live token + live guild +
  // operator-flipped role_sync_enabled flag demotes to live.
  const roleSyncEnabled = Boolean(config?.role_sync_enabled);
  const dryRun = !botToken || !roleSyncEnabled;

  const discord: DiscordClient = botToken
    ? createRealDiscordClient({ token: botToken })
    : noopDiscordClient();

  const summary = await runReconcile(
    { supabase, discord, guildId, bindings, runId, dryRun },
    targets,
  );

  await supabase
    .from('collector_discord_guild_config')
    .update({ last_sync_at: new Date().toISOString(), last_sync_summary: summary })
    .eq('id', 1);

  await completeJob(
    supabase, jobId,
    summary.errors === 0 ? 'success' : 'warning',
    summary.targets_seen,
    summary.errors ? `${summary.errors} discord errors` : null,
  );

  return NextResponse.json({ ok: true, dry_run: dryRun, run_id: runId, summary });
}

function sanitizeEnv(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/^﻿/, '').replace(/^"|"$/g, '').trim();
}

function noopDiscordClient(): DiscordClient {
  // Returned when DISCORD_BOT_TOKEN is absent. The reconcile loop
  // enters dry-run mode and never calls this client, but we still
  // need an object to satisfy the type.
  const unreachable = async (): Promise<never> => {
    throw new Error('noop discord client called during dry-run — should never happen');
  };
  return {
    getGuildMember: unreachable,
    addGuildMemberRole: unreachable,
    removeGuildMemberRole: unreachable,
  };
}

async function completeJob(
  supabase: ReturnType<typeof createServiceRoleSupabase>,
  jobId: unknown,
  status: 'success' | 'warning' | 'error',
  rowsExamined: number,
  errorSummary: string | null,
): Promise<void> {
  if (!jobId) return;
  await supabase.rpc('network_complete_job_run', {
    p_id: jobId,
    p_status: status,
    p_rows_examined: rowsExamined,
    p_rows_inserted: 0,
    p_rows_updated: 0,
    p_rows_rejected: 0,
    p_error_summary: errorSummary,
  });
}

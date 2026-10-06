'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { ingestImpactEpn } from '@/server/impact/ingest';

// Server action: run the 365-day canonical Impact EPN backfill.
//
// Preconditions enforced here:
//   1. Caller must be an admin.
//   2. EPN sources must exist in network_revenue_sources (checked
//      implicitly by the ingest module).
//
// We do NOT require the EPN event table to be empty — the ingest is
// idempotent via `impact:epn:<Id>` and the reset migration already
// cleared it. If the reset migration hasn't been applied, the first
// backfill will insert fresh and the second will no-op.
//
// Result is stashed in network_settings so the page can show the
// summary on next render (server actions can't return objects to the
// render pipeline cleanly; stash + revalidate is idiomatic).

export async function executeImpactBackfillAction(): Promise<void> {
  const { sb } = await requireAdmin('/admin/revenue/impact-reset/execute');
  const result = await ingestImpactEpn(sb, { totalDays: 365, windowDays: 45 });
  await sb.from('network_settings').upsert(
    {
      key: 'impact_last_backfill',
      value: result as unknown as Record<string, unknown>,
      description: 'Most recent /admin/revenue/impact-reset/execute backfill result',
    },
    { onConflict: 'key' },
  );
  revalidatePath('/admin/revenue/impact-reset/execute');
}

export async function executeImpactDailySyncAction(): Promise<void> {
  const { sb } = await requireAdmin('/admin/revenue/impact-reset/execute');
  const result = await ingestImpactEpn(sb, { totalDays: 7, windowDays: 7 });
  await sb.from('network_settings').upsert(
    {
      key: 'impact_last_daily_sync',
      value: result as unknown as Record<string, unknown>,
      description: 'Most recent manual daily-sync run from the reset executor page',
    },
    { onConflict: 'key' },
  );
  revalidatePath('/admin/revenue/impact-reset/execute');
}

import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';
import { HUB_MANAGED_SITES, type BrandSiteCode } from '@collector-network/email';
import { enqueue } from '@/server/emails/queue';
import { readHoldingSummary } from '@/server/emails/holdings';
import { CRON_BATCH_LIMIT, isWeeklyDigestEnabled } from '@/server/emails/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// CN-03 weekly digest cron.
//
// For each hub-managed site:
//   1. Find users with first_authenticated_at (so we have a real
//      consumer) and > 0 holdings.
//   2. Skip users whose weekly_last_sent_at was within the last 6
//      days (dedupe + jitter).
//   3. Enqueue a weekly_digest with holding count + simple top list.
//
// MVP: no synthetic value or week-over-week delta. Pricing wiring
// comes in a follow-up slice; the template already handles a null
// total gracefully ("simpler useful summary rather than misleading
// figures").
//
// Idempotency key format: cn03:<user>:<site>:weekly:<yyyy-ww>
// → same cron run twice in the same ISO week is a no-op.

function isoYearWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-${String(weekNum).padStart(2, '0')}`;
}

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  if (!isWeeklyDigestEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'disabled' });
  }

  const admin = createServiceRoleSupabase();
  const now = new Date();
  const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 3600 * 1000).toISOString();
  const week = isoYearWeek(now);
  const stats: Record<string, number> = { enqueued: 0, skipped_empty: 0, skipped_dedup: 0 };

  for (const site of HUB_MANAGED_SITES) {
    // Weekly-digest eligibility: ONLY users who already completed the
    // CN-03 welcome funnel. collector_site_onboarding.welcome_sent_at
    // is set only by the hub sender, which only ever sends to users
    // whose membership was enqueued by the scheduler — which requires
    // first_authenticated_at >= CN03_ONBOARDING_ELIGIBLE_AFTER. This
    // chain is the sole guarantee that no historical user ever
    // receives a weekly digest.
    const { data: onboarded } = await admin
      .from('collector_site_onboarding')
      .select('user_id, weekly_last_sent_at')
      .eq('site_code', site)
      .not('welcome_sent_at', 'is', null)
      .limit(CRON_BATCH_LIMIT);

    const memberList = (onboarded ?? []) as { user_id: string; weekly_last_sent_at: string | null }[];
    if (memberList.length === 0) continue;

    const userIds = memberList.map((m) => m.user_id);
    const lastByUser = new Map<string, string | null>();
    for (const row of memberList) {
      lastByUser.set(row.user_id, row.weekly_last_sent_at);
    }

    const { data: contacts } = await admin
      .from('email_contacts')
      .select('user_id, email_normalized')
      .in('user_id', userIds);
    const emailByUser = new Map<string, string>();
    for (const c of (contacts ?? []) as { user_id: string; email_normalized: string }[]) {
      if (c.user_id) emailByUser.set(c.user_id, c.email_normalized);
    }

    for (const m of memberList) {
      const last = lastByUser.get(m.user_id);
      if (last && last > sixDaysAgo) {
        stats.skipped_dedup = (stats.skipped_dedup ?? 0) + 1;
        continue;
      }
      const email = emailByUser.get(m.user_id);
      if (!email) continue;

      const summary = await readHoldingSummary(admin, m.user_id, site as BrandSiteCode);
      if (summary.holdingCount === 0) {
        stats.skipped_empty = (stats.skipped_empty ?? 0) + 1;
        continue;
      }

      // Capture an honest snapshot BEFORE enqueueing so the next week's
      // digest can show a real delta.
      try {
        await admin
          .from('collector_portfolio_snapshots')
          .insert({
            user_id: m.user_id,
            site_code: site,
            total_value_minor: summary.totalValueMinor,
            currency: summary.currency,
            holding_count: summary.holdingCount,
          });
      } catch {
        // snapshot optional
      }

      const firstDigest = !last;
      const idem = `cn03:${m.user_id}:${site}:weekly:${week}`;
      const q = await enqueue(admin, {
        userId: m.user_id,
        recipientEmail: email,
        siteCode: site as BrandSiteCode,
        templateKey: 'weekly_digest',
        category: 'weekly_report',
        variables: {
          holdingCount: summary.holdingCount,
          totalValueMinor: summary.totalValueMinor,
          currency: summary.currency,
          topHoldings: summary.topHoldings,
          firstDigest,
        },
        idempotencyKey: idem,
      });
      if (q.enqueued) stats.enqueued = (stats.enqueued ?? 0) + 1;
    }
  }

  return NextResponse.json({ ok: true, week, stats });
}

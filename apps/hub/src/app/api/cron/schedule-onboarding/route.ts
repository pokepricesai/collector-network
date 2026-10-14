import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';
import { HUB_MANAGED_SITES, isHubManagedSite } from '@collector-network/email';
import { enqueue } from '@/server/emails/queue';
import { CRON_BATCH_LIMIT, isScheduleOnboardingEnabled } from '@/server/emails/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// CN-03 scheduler.
//
// On each tick we:
//   1. Find collector_user_sites rows for hub-managed sites whose
//      first_authenticated_at is set but have no collector_site_onboarding
//      row yet. For each: enqueue welcome, create onboarding row with
//      welcome_enqueued_at.
//   2. For onboarding rows whose welcome_sent_at < now()-2d but
//      day2_enqueued_at IS NULL: enqueue day2.
//   3. For onboarding rows whose welcome_sent_at < now()-7d but
//      day7_enqueued_at IS NULL: enqueue day7.
//
// Each enqueue uses a deterministic idempotency key per (user, site,
// step). Running this cron twice does nothing on the second run.
//
// A hard eligibility cutoff env (CN03_ONBOARDING_ELIGIBLE_AFTER) lets us
// enable the system without automatically back-mailing historical users.
// Missing cutoff → scheduler no-ops (fail-safe).

interface MembershipRow {
  user_id: string;
  site_code: string;
  first_authenticated_at: string;
  email: string | null;
}

interface OnboardingRow {
  user_id: string;
  site_code: string;
  welcome_sent_at: string | null;
  day2_enqueued_at: string | null;
  day7_enqueued_at: string | null;
}

function sanitize(v: string | undefined): string {
  if (!v) return '';
  return v.replace(/^﻿/, '').replace(/^"|"$/g, '').trim();
}

function getCutoff(): Date | null {
  const raw = sanitize(process.env['CN03_ONBOARDING_ELIGIBLE_AFTER']);
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d;
}

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  if (!isScheduleOnboardingEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'disabled' });
  }
  const cutoff = getCutoff();
  if (!cutoff) {
    return NextResponse.json({ ok: true, skipped: 'cutoff_missing' });
  }

  const admin = createServiceRoleSupabase();
  const stats = { welcome: 0, day2: 0, day7: 0, errors: 0 };

  // Step 1: new memberships without an onboarding row.
  // Join user_sites to onboarding via a left-join emulated by two selects.
  const { data: memberships, error: mErr } = await admin
    .from('collector_user_sites')
    .select('user_id, site_code, first_authenticated_at')
    .in('site_code', HUB_MANAGED_SITES as unknown as string[])
    .gte('first_authenticated_at', cutoff.toISOString())
    .not('first_authenticated_at', 'is', null)
    .order('first_authenticated_at', { ascending: true })
    .limit(CRON_BATCH_LIMIT);
  if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });

  const typedMemberships = (memberships ?? []) as Omit<MembershipRow, 'email'>[];

  if (typedMemberships.length > 0) {
    const userIds = Array.from(new Set(typedMemberships.map((m) => m.user_id)));
    // Pull emails via admin.auth.admin.getUserById would be N calls;
    // instead use the auth.users table via a passthrough RPC if present,
    // otherwise query email_contacts (populated by signup) first.
    const { data: contacts } = await admin
      .from('email_contacts')
      .select('user_id, email_normalized')
      .in('user_id', userIds);
    const emailByUser = new Map<string, string>();
    for (const c of (contacts ?? []) as { user_id: string; email_normalized: string }[]) {
      if (c.user_id) emailByUser.set(c.user_id, c.email_normalized);
    }
    // Fallback: resolve missing via admin.auth.admin.getUserById.
    for (const uid of userIds) {
      if (emailByUser.has(uid)) continue;
      try {
        const res = await admin.auth.admin.getUserById(uid);
        const email = res?.data?.user?.email;
        if (email) emailByUser.set(uid, email.toLowerCase());
      } catch {
        /* ignore */
      }
    }

    // Pull existing onboarding rows to avoid duplicate welcomes.
    const { data: existing } = await admin
      .from('collector_site_onboarding')
      .select('user_id,site_code')
      .in('user_id', userIds);
    const seen = new Set<string>();
    for (const row of (existing ?? []) as { user_id: string; site_code: string }[]) {
      seen.add(`${row.user_id}:${row.site_code}`);
    }

    for (const m of typedMemberships) {
      const key = `${m.user_id}:${m.site_code}`;
      if (seen.has(key)) continue;
      if (!isHubManagedSite(m.site_code)) continue;
      const email = emailByUser.get(m.user_id);
      if (!email) continue;

      const idem = `cn03:${m.user_id}:${m.site_code}:welcome`;
      const q = await enqueue(admin, {
        userId: m.user_id,
        recipientEmail: email,
        siteCode: m.site_code as (typeof HUB_MANAGED_SITES)[number],
        templateKey: 'welcome',
        category: 'onboarding',
        variables: {},
        idempotencyKey: idem,
      });
      if (q.error) stats.errors++;
      if (q.enqueued || q.duplicate) {
        await admin
          .from('collector_site_onboarding')
          .upsert({
            user_id: m.user_id,
            site_code: m.site_code,
            welcome_enqueued_at: new Date().toISOString(),
            status: 'active',
          }, { onConflict: 'user_id,site_code' });
        if (q.enqueued) stats.welcome++;
      }
    }
  }

  // Step 2+3: due day2 / day7 enqueueing.
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: dueRows } = await admin
    .from('collector_site_onboarding')
    .select('user_id, site_code, welcome_sent_at, day2_enqueued_at, day7_enqueued_at')
    .in('site_code', HUB_MANAGED_SITES as unknown as string[])
    .eq('status', 'active')
    .not('welcome_sent_at', 'is', null)
    .limit(CRON_BATCH_LIMIT);

  const typedDue = (dueRows ?? []) as OnboardingRow[];
  if (typedDue.length > 0) {
    const uids = Array.from(new Set(typedDue.map((r) => r.user_id)));
    const { data: contacts } = await admin
      .from('email_contacts')
      .select('user_id, email_normalized')
      .in('user_id', uids);
    const emailByUser = new Map<string, string>();
    for (const c of (contacts ?? []) as { user_id: string; email_normalized: string }[]) {
      if (c.user_id) emailByUser.set(c.user_id, c.email_normalized);
    }

    // Count holdings per user per site to drive conditional copy.
    for (const row of typedDue) {
      if (!isHubManagedSite(row.site_code)) continue;
      const email = emailByUser.get(row.user_id);
      if (!email) continue;

      const needsDay2 =
        row.day2_enqueued_at === null &&
        row.welcome_sent_at !== null &&
        row.welcome_sent_at <= twoDaysAgo;
      const needsDay7 =
        row.day7_enqueued_at === null &&
        row.welcome_sent_at !== null &&
        row.welcome_sent_at <= sevenDaysAgo;

      if (!needsDay2 && !needsDay7) continue;

      // Query holding count once per user+site for both templates.
      const tableFor: Record<string, string> = {
        mtg: 'mtg_collection_items',
        ygo: 'ygo_collection_items',
        onepiece: 'onepiece_collection_items',
        lorcana: 'lorcana_collection_items',
      };
      const table = tableFor[row.site_code];
      let holdingCount = 0;
      if (table) {
        const { count } = await admin
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('user_id', row.user_id);
        holdingCount = count ?? 0;
      }
      const hasPortfolio = holdingCount > 0;

      if (needsDay2) {
        const idem = `cn03:${row.user_id}:${row.site_code}:day2`;
        const q = await enqueue(admin, {
          userId: row.user_id,
          recipientEmail: email,
          siteCode: row.site_code as (typeof HUB_MANAGED_SITES)[number],
          templateKey: 'onboarding_day2',
          category: 'onboarding',
          variables: { hasPortfolio, holdingCount },
          idempotencyKey: idem,
        });
        if (q.enqueued || q.duplicate) {
          await admin
            .from('collector_site_onboarding')
            .update({ day2_enqueued_at: new Date().toISOString() })
            .eq('user_id', row.user_id)
            .eq('site_code', row.site_code);
          if (q.enqueued) stats.day2++;
        } else if (q.error) stats.errors++;
      }

      if (needsDay7) {
        const idem = `cn03:${row.user_id}:${row.site_code}:day7`;
        const q = await enqueue(admin, {
          userId: row.user_id,
          recipientEmail: email,
          siteCode: row.site_code as (typeof HUB_MANAGED_SITES)[number],
          templateKey: 'onboarding_day7',
          category: 'onboarding',
          variables: { hasPortfolio },
          idempotencyKey: idem,
        });
        if (q.enqueued || q.duplicate) {
          await admin
            .from('collector_site_onboarding')
            .update({
              day7_enqueued_at: new Date().toISOString(),
              status: 'completed',
            })
            .eq('user_id', row.user_id)
            .eq('site_code', row.site_code);
          if (q.enqueued) stats.day7++;
        } else if (q.error) stats.errors++;
      }
    }
  }

  return NextResponse.json({ ok: true, stats });
}

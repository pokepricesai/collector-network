import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';
import {
  brandForSiteCode,
  renderTemplate,
  sendViaResend,
  unsubscribeUrl as buildUnsubscribeUrl,
  managePreferencesUrl,
  type BrandSiteCode,
  type TemplateKey,
} from '@collector-network/email';
import { claimPendingBatch, markSent, markFailed, markSkipped, markSuppressed, reclaimStaleSending } from '@/server/emails/queue';
import { checkConsent } from '@/server/emails/consent';
import {
  getResendApiKey,
  getUnsubscribeSecret,
  getPublicHubUrl,
  getEmailTestRedirect,
  isSendPendingEnabled,
  SEND_BATCH_LIMIT,
} from '@/server/emails/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Drains collector_email_queue. Idempotent at the Resend level via
// Idempotency-Key header, and at the queue level via the UNIQUE
// idempotency_key column.
//
// Hard safety: when CN03_SEND_PENDING_ENABLED is not 'true' we claim
// the batch and immediately mark skipped. This lets us validate the
// queue + scheduling pipeline before any real send.

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  const admin = createServiceRoleSupabase();
  // Self-heal: rows stuck in 'sending' > 5 min were orphaned by a
  // function timeout. Return them to 'pending' so this tick retries.
  // Safe because Resend sees the same Idempotency-Key and dedups.
  const reclaimed = await reclaimStaleSending(admin, 300);
  const batch = await claimPendingBatch(admin, SEND_BATCH_LIMIT);
  if (batch.length === 0) return NextResponse.json({ ok: true, drained: 0, reclaimed });

  if (!isSendPendingEnabled()) {
    for (const row of batch) {
      await markSkipped(admin, row.id, 'send_disabled');
    }
    return NextResponse.json({ ok: true, drained: 0, claimed: batch.length, skipped: 'send_disabled' });
  }

  const apiKey = getResendApiKey();
  const unsubSecret = getUnsubscribeSecret();
  const hubUrl = getPublicHubUrl();
  const testRedirect = getEmailTestRedirect();

  const stats = { sent: 0, failed: 0, skipped: 0, suppressed: 0 };

  for (const row of batch) {
    try {
      const brand = brandForSiteCode(row.site_code);
      if (brand.siteCode === 'network') {
        await markSkipped(admin, row.id, 'unknown_site');
        stats.skipped++;
        continue;
      }

      // Consent / suppression gate.
      if (row.user_id) {
        const consent = await checkConsent(admin, {
          userId: row.user_id,
          siteCode: row.site_code as BrandSiteCode,
          category: row.category === 'transactional' ? 'transactional' : (row.category === 'weekly_report' ? 'weekly_report' : 'onboarding'),
          recipientEmail: row.recipient_email,
        });
        if (!consent.allowed) {
          await markSuppressed(admin, row.id, consent.reason ?? 'opt_out');
          stats.suppressed++;
          continue;
        }
      }

      const unsubUrl = row.user_id
        ? buildUnsubscribeUrl(hubUrl, unsubSecret, {
            userId: row.user_id,
            siteCode: brand.siteCode,
            kind: 'site',
          })
        : `${hubUrl}/unsubscribe`;
      const manageUrl = managePreferencesUrl(brand.productUrl);

      const rendered = renderTemplate(row.template_key as TemplateKey, {
        brand,
        recipientEmail: row.recipient_email,
        unsubscribeUrl: unsubUrl,
        manageUrl,
        variables: row.variables,
      });

      const to = testRedirect ?? row.recipient_email;

      const result = await sendViaResend(apiKey, {
        brand,
        to,
        rendered,
        idempotencyKey: row.idempotency_key,
        listUnsubscribeUrl: unsubUrl,
        tags: [
          { name: 'cn_site', value: brand.siteCode },
          { name: 'cn_template', value: row.template_key },
          { name: 'cn_category', value: row.category },
        ],
      });

      if (!result.ok) {
        await markFailed(admin, row.id, result.error, row.attempts < 3);
        stats.failed++;
        continue;
      }

      await markSent(admin, row.id, result.id);
      stats.sent++;

      // Flip the onboarding timestamp for welcome/day2/day7 sends so
      // the scheduler knows the step has shipped.
      if (row.user_id && row.category === 'onboarding') {
        const field =
          row.template_key === 'welcome' ? 'welcome_sent_at'
          : row.template_key === 'onboarding_day2' ? 'day2_sent_at'
          : row.template_key === 'onboarding_day7' ? 'day7_sent_at'
          : null;
        if (field) {
          await admin
            .from('collector_site_onboarding')
            .update({ [field]: new Date().toISOString() })
            .eq('user_id', row.user_id)
            .eq('site_code', row.site_code);
        }
      }
      if (row.user_id && row.template_key === 'weekly_digest') {
        await admin
          .from('collector_site_onboarding')
          .upsert({
            user_id: row.user_id,
            site_code: row.site_code,
            weekly_last_sent_at: new Date().toISOString(),
            status: 'active',
          }, { onConflict: 'user_id,site_code' });
      }

      // Mirror to email_delivery_log for unified network observability.
      try {
        await admin
          .from('email_delivery_log')
          .insert({
            user_id: row.user_id,
            template_key: row.template_key,
            category: row.category,
            campaign_key: `cn03_${row.site_code}`,
            status: 'sent',
            idempotency_key: row.idempotency_key,
            resend_email_id: result.id,
            metadata_json: { site_code: row.site_code, source: 'cn03_hub' },
            sent_at: new Date().toISOString(),
          });
      } catch {
        // email_delivery_log may have a stricter schema (NOT NULL
        // contact_id). This is a best-effort mirror; the queue row
        // is still the source of truth for CN-03 jobs.
      }
    } catch (e) {
      await markFailed(admin, row.id, (e as Error).message, false);
      stats.failed++;
    }
  }

  return NextResponse.json({ ok: true, drained: batch.length, stats });
}

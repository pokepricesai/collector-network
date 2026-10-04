'use server';

// Revenue mutations. Admin-gated. Every write is auditable through
// network_audit_log (added here by the handler) + the record itself.
// Idempotency keys are computed when manual-entry is submitted
// through a form so a double-submit does not insert twice.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';

function toMinor(amount: string, currency: string): number {
  const n = Number.parseFloat(amount.replace(/,/g, '').trim());
  if (!Number.isFinite(n)) throw new Error(`invalid amount: ${amount}`);
  const minor = Math.round(n * 100);
  if (!Number.isSafeInteger(minor)) throw new Error(`amount out of range: ${amount}`);
  // currency is validated upstream; keeping the param so callers that
  // introduce fractional-unit currencies later can override.
  void currency;
  return minor;
}

export async function createRevenueEventAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/revenue/entries/new');

  const sourceId = String(formData.get('sourceId') ?? '').trim();
  const siteId = String(formData.get('siteId') ?? '').trim() || null;
  const occurredOn = String(formData.get('occurredOn') ?? '').trim();
  const amount = String(formData.get('amount') ?? '').trim();
  const currency = String(formData.get('currency') ?? 'GBP').trim().toUpperCase();
  const eventKind = String(formData.get('eventKind') ?? 'revenue').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const externalRef = String(formData.get('externalRef') ?? '').trim() || null;
  const sponsorshipId = String(formData.get('sponsorshipId') ?? '').trim() || null;
  const partnerId = String(formData.get('partnerId') ?? '').trim() || null;

  if (!sourceId) throw new Error('sourceId required');
  if (!occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) throw new Error('occurredOn must be YYYY-MM-DD');
  if (!amount) throw new Error('amount required');
  if (!['revenue', 'refund', 'adjustment', 'reversal'].includes(eventKind)) {
    throw new Error(`invalid eventKind: ${eventKind}`);
  }
  if (currency.length !== 3) throw new Error('currency must be 3-letter code');

  let amountMinor = toMinor(amount, currency);
  // Refunds and reversals must be stored negative so SUMs work.
  if ((eventKind === 'refund' || eventKind === 'reversal') && amountMinor > 0) {
    amountMinor = -amountMinor;
  }

  // Idempotency: a human-friendly, hash-free composite that catches
  // a true double-submit (same source/site/date/amount/externalRef/entered-by)
  // without blocking legitimate same-day entries.
  const idempotencyKey = [
    'manual', admin.adminRowId, sourceId, siteId ?? 'network',
    occurredOn, amountMinor, externalRef ?? '',
  ].join(':');

  const { error } = await sb.from('network_revenue_events').insert({
    source_id: sourceId,
    site_id: siteId,
    sponsorship_id: sponsorshipId,
    partner_id: partnerId,
    event_kind: eventKind,
    occurred_on: occurredOn,
    amount_minor: amountMinor,
    currency,
    description,
    external_ref: externalRef,
    entered_by: admin.adminRowId,
    idempotency_key: idempotencyKey,
  });

  if (error) {
    // Postgres unique_violation code is 23505; the client surfaces that
    // via error.code. If the duplicate collision is on the idempotency
    // unique index we accept it silently — the row was already there.
    if (error.code === '23505' && /idempotency|network_revenue_events_source_id_idempotency_key/i.test(error.message)) {
      // idempotent re-submission; proceed as success
    } else {
      throw new Error(`[revenue] insert: ${error.message}`);
    }
  }

  await sb.from('network_audit_log').insert({
    actor_type: 'human',
    actor_user_id: admin.authUserId,
    site_id: siteId,
    action: 'revenue.manual_entry',
    entity_type: 'network_revenue_events',
    new_value: {
      source_id: sourceId,
      site_id: siteId,
      occurred_on: occurredOn,
      amount_minor: amountMinor,
      currency,
      event_kind: eventKind,
      external_ref: externalRef,
    },
  });

  revalidatePath('/admin/revenue');
  revalidatePath('/admin/revenue/entries');
  redirect('/admin/revenue/entries?inserted=1');
}

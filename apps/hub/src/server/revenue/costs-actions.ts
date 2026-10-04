'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';

export async function createOpsCostAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/revenue/costs/new');

  const forDate = String(formData.get('forDate') ?? '').trim();
  const siteId = String(formData.get('siteId') ?? '').trim() || null;
  const category = String(formData.get('category') ?? '').trim();
  const provider = String(formData.get('provider') ?? '').trim() || null;
  const description = String(formData.get('description') ?? '').trim() || null;
  const amount = String(formData.get('amount') ?? '').trim();
  const currency = String(formData.get('currency') ?? 'GBP').trim().toUpperCase();
  const externalRef = String(formData.get('externalRef') ?? '').trim() || null;

  if (!forDate || !/^\d{4}-\d{2}-\d{2}$/.test(forDate)) throw new Error('forDate must be YYYY-MM-DD');
  if (!category) throw new Error('category required');
  if (!amount) throw new Error('amount required');
  if (currency.length !== 3) throw new Error('currency must be 3-letter code');
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n)) throw new Error(`invalid amount: ${amount}`);
  const amountMinor = Math.round(n * 100);

  const idempotencyKey = ['ops', admin.adminRowId, forDate, category, provider ?? '', amountMinor, externalRef ?? ''].join(':');

  const { error } = await sb.from('network_operating_costs').insert({
    for_date: forDate,
    site_id: siteId,
    category,
    provider,
    description,
    amount_minor: amountMinor,
    currency,
    external_ref: externalRef,
    entered_by: admin.adminRowId,
    idempotency_key: idempotencyKey,
  });
  if (error) {
    if (error.code === '23505') {
      // idempotent re-submission
    } else {
      throw new Error(`[costs] insert: ${error.message}`);
    }
  }

  await sb.from('network_audit_log').insert({
    actor_type: 'human',
    actor_user_id: admin.authUserId,
    site_id: siteId,
    action: 'cost.manual_entry',
    entity_type: 'network_operating_costs',
    new_value: {
      for_date: forDate, category, provider, amount_minor: amountMinor, currency, external_ref: externalRef,
    },
  });

  revalidatePath('/admin/revenue');
  revalidatePath('/admin/revenue/costs');
  redirect('/admin/revenue/costs?inserted=1');
}

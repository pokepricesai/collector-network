'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';

const TCG_SLUGS = new Set(['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana']);

export async function updatePartnerCn06aAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('id required');

  const vendorCategory = String(formData.get('vendorCategory') ?? '').trim() || null;
  const relevantTcgs = (formData.getAll('relevantTcgs') as FormDataEntryValue[])
    .map((v) => String(v).trim())
    .filter((v) => TCG_SLUGS.has(v));
  const usState = String(formData.get('usState') ?? '').trim().toUpperCase() || null;
  const isUsBusiness = formData.get('isUsBusiness') === 'on';
  const estimatedSize = String(formData.get('estimatedSize') ?? '').trim() || null;
  const confidence = String(formData.get('researchConfidence') ?? '').trim() || null;
  const sourcesRaw = String(formData.get('researchSources') ?? '').trim();
  const sources = sourcesRaw ? sourcesRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
  const recommendedOfferId = String(formData.get('recommendedOfferId') ?? '').trim() || null;
  const recommendedPrice = String(formData.get('recommendedPrice') ?? '').trim();
  const firstWave = formData.get('firstWave') === 'on';

  if (estimatedSize && !['small', 'medium', 'large'].includes(estimatedSize)) {
    throw new Error('estimatedSize must be small|medium|large');
  }
  if (confidence && !['high', 'medium', 'low'].includes(confidence)) {
    throw new Error('researchConfidence must be high|medium|low');
  }

  const patch: Record<string, unknown> = {
    vendor_category: vendorCategory,
    relevant_tcgs: relevantTcgs,
    us_state: usState,
    is_us_business: isUsBusiness,
    estimated_size: estimatedSize,
    research_confidence: confidence,
    research_sources: sources,
    recommended_offer_id: recommendedOfferId,
    first_wave: firstWave,
    last_researched_at: new Date().toISOString(),
  };
  if (recommendedPrice) {
    const n = Number.parseFloat(recommendedPrice);
    if (!Number.isFinite(n)) throw new Error('recommendedPrice must be numeric');
    patch.recommended_price_minor = Math.round(n * 100);
    patch.recommended_currency = String(formData.get('recommendedCurrency') ?? 'GBP').trim().toUpperCase();
  } else {
    patch.recommended_price_minor = null;
  }

  const { error } = await sb.from('network_partners').update(patch).eq('id', id);
  if (error) throw new Error(`[cn06a] partner update: ${error.message}`);

  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'partner.cn06a.updated', entity_type: 'network_partners', entity_id: id,
    new_value: patch,
  });

  revalidatePath(`/admin/partners/${id}`);
  revalidatePath('/admin/partners');
  revalidatePath('/admin/partners/first-wave');
  revalidatePath('/admin/partners/categories');
}

export async function recomputePartnerFitScoreAction(formData: FormData): Promise<void> {
  const { sb, admin } = await requireAdmin('/admin/partners');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('id required');

  const { data, error } = await sb.from('v_crm_vendor_scoring')
    .select('audience_pts, commercial_pts, placement_pts, contact_pts, cross_tcg_pts')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[cn06a] score read: ${error.message}`);
  if (!data) throw new Error('scoring view returned no row');

  const breakdown = {
    audience: data.audience_pts ?? 0,
    commercial: data.commercial_pts ?? 0,
    placement: data.placement_pts ?? 0,
    contact: data.contact_pts ?? 0,
    cross_tcg: data.cross_tcg_pts ?? 0,
  };
  const total = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0));

  const { error: upErr } = await sb.from('network_partners').update({
    fit_score: total,
    fit_score_breakdown: breakdown,
  }).eq('id', id);
  if (upErr) throw new Error(`[cn06a] score write: ${upErr.message}`);

  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'partner.cn06a.scored', entity_type: 'network_partners', entity_id: id,
    new_value: { fit_score: total, breakdown },
  });

  revalidatePath(`/admin/partners/${id}`);
  revalidatePath('/admin/partners');
}

export async function updateContactVerificationAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('id required');
  const verification = String(formData.get('emailVerification') ?? '').trim() || null;
  if (verification && !['public_listed', 'validated', 'confirmed'].includes(verification)) {
    throw new Error('invalid emailVerification value');
  }
  const sourceUrl = String(formData.get('sourceUrl') ?? '').trim() || null;
  const contactUrl = String(formData.get('contactUrl') ?? '').trim() || null;
  const suppressed = formData.get('suppressed') === 'on';
  const suppressedReason = String(formData.get('suppressedReason') ?? '').trim() || null;
  const priorityRaw = String(formData.get('priority') ?? '').trim();

  const patch: Record<string, unknown> = {
    email_verification: verification,
    source_url: sourceUrl,
    contact_url: contactUrl,
    suppressed,
    suppressed_reason: suppressed ? suppressedReason : null,
    suppressed_at: suppressed ? new Date().toISOString() : null,
  };
  if (verification === 'confirmed') patch.email_verified_at = new Date().toISOString();
  if (priorityRaw) {
    const n = Number.parseInt(priorityRaw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 5) patch.priority = n;
  }

  const { data, error } = await sb.from('network_partner_contacts')
    .update(patch).eq('id', id)
    .select('partner_id').maybeSingle();
  if (error) throw new Error(`[cn06a] contact verification: ${error.message}`);

  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'partner.contact.verification.updated', entity_type: 'network_partner_contacts', entity_id: id,
    new_value: patch,
  });

  if (data?.partner_id) revalidatePath(`/admin/partners/${data.partner_id}`);
}

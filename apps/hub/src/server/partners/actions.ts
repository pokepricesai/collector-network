'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function createPartnerAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners/new');
  const name = String(formData.get('name') ?? '').trim();
  const kind = String(formData.get('kind') ?? '').trim();
  const website = String(formData.get('website') ?? '').trim() || null;
  const description = String(formData.get('description') ?? '').trim() || null;
  const introSource = String(formData.get('introSource') ?? '').trim() || null;
  const priority = Number(formData.get('priority') ?? 3);
  const tags = String(formData.get('tags') ?? '').trim();
  if (!name) throw new Error('name required');
  if (!kind) throw new Error('kind required');
  const slug = slugify(name) || `partner-${Date.now()}`;
  const tagList = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const { data, error } = await sb.from('network_partners')
    .insert({
      slug, display_name: name, kind, website, description,
      intro_source: introSource, priority, tags: tagList,
      owner_user_id: admin.adminRowId,
    })
    .select('id')
    .single();
  if (error) throw new Error(`[partners] create: ${error.message}`);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'partner.created', entity_type: 'network_partners', entity_id: data.id,
    new_value: { slug, kind, name },
  });
  revalidatePath('/admin/partners');
  redirect(`/admin/partners/${data.id}`);
}

export async function updatePartnerAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('id required');
  const patch: Record<string, unknown> = {};
  const name = String(formData.get('displayName') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim();
  const kind = String(formData.get('kind') ?? '').trim();
  const website = String(formData.get('website') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const priorityRaw = String(formData.get('priority') ?? '').trim();
  const tags = String(formData.get('tags') ?? '').trim();
  const nextAction = String(formData.get('nextAction') ?? '').trim();
  const nextActionDue = String(formData.get('nextActionDue') ?? '').trim();
  if (name) patch.display_name = name;
  if (status) patch.status = status;
  if (kind) patch.kind = kind;
  if (website) patch.website = website; else patch.website = null;
  if (description) patch.description = description;
  if (priorityRaw) patch.priority = Number(priorityRaw);
  patch.tags = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
  patch.next_action = nextAction || null;
  patch.next_action_due = nextActionDue && /^\d{4}-\d{2}-\d{2}$/.test(nextActionDue) ? nextActionDue : null;

  const { error } = await sb.from('network_partners').update(patch).eq('id', id);
  if (error) throw new Error(`[partners] update: ${error.message}`);

  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'partner.updated', entity_type: 'network_partners', entity_id: id,
    new_value: patch,
  });
  revalidatePath(`/admin/partners/${id}`);
  revalidatePath('/admin/partners');
}

export async function createPartnerContactAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const partnerId = String(formData.get('partnerId') ?? '').trim();
  const fullName = String(formData.get('fullName') ?? '').trim();
  if (!partnerId || !fullName) throw new Error('partnerId + fullName required');
  const row = {
    partner_id: partnerId,
    full_name: fullName,
    role_title: String(formData.get('roleTitle') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    phone: String(formData.get('phone') ?? '').trim() || null,
    linkedin: String(formData.get('linkedin') ?? '').trim() || null,
    twitter: String(formData.get('twitter') ?? '').trim() || null,
    is_primary: formData.get('isPrimary') === 'on',
    notes: String(formData.get('notes') ?? '').trim() || null,
  };
  // If marked primary, demote existing primary first (partial unique index would reject otherwise).
  if (row.is_primary) {
    await sb.from('network_partner_contacts').update({ is_primary: false })
      .eq('partner_id', partnerId).eq('is_primary', true);
  }
  const { error } = await sb.from('network_partner_contacts').insert(row);
  if (error) throw new Error(`[partners] contact create: ${error.message}`);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'partner.contact.created', entity_type: 'network_partner_contacts',
    new_value: { partner_id: partnerId, name: fullName, is_primary: row.is_primary },
  });
  revalidatePath(`/admin/partners/${partnerId}`);
}

export async function logInteractionAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const partnerId = String(formData.get('partnerId') ?? '').trim();
  const kind = String(formData.get('kind') ?? '').trim();
  const summary = String(formData.get('summary') ?? '').trim();
  if (!partnerId || !kind || !summary) throw new Error('partnerId + kind + summary required');
  const direction = String(formData.get('direction') ?? 'outbound').trim();
  const contactId = String(formData.get('contactId') ?? '').trim() || null;
  const sponsorshipId = String(formData.get('sponsorshipId') ?? '').trim() || null;
  const detail = String(formData.get('detail') ?? '').trim() || null;
  const externalRef = String(formData.get('externalRef') ?? '').trim() || null;
  const occurredAt = String(formData.get('occurredAt') ?? '').trim();

  const { error } = await sb.from('network_partner_interactions').insert({
    partner_id: partnerId, contact_id: contactId, sponsorship_id: sponsorshipId,
    kind, direction, summary, detail, external_ref: externalRef,
    occurred_at: occurredAt && !Number.isNaN(Date.parse(occurredAt)) ? occurredAt : new Date().toISOString(),
    logged_by: admin.adminRowId,
  });
  if (error) throw new Error(`[partners] interaction: ${error.message}`);
  // Touch last_contact_at + updated_at on the partner.
  await sb.from('network_partners').update({ last_contact_at: new Date().toISOString() }).eq('id', partnerId);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'partner.interaction.logged', entity_type: 'network_partner_interactions',
    new_value: { partner_id: partnerId, kind, direction, summary_len: summary.length },
  });
  revalidatePath(`/admin/partners/${partnerId}`);
}

export async function createSponsorshipAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const partnerId = String(formData.get('partnerId') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const totalValue = String(formData.get('totalValue') ?? '').trim();
  const currency = String(formData.get('currency') ?? 'GBP').trim().toUpperCase();
  const termMonths = String(formData.get('termMonths') ?? '').trim();
  const startsOn = String(formData.get('startsOn') ?? '').trim();
  const endsOn = String(formData.get('endsOn') ?? '').trim();
  const cadence = String(formData.get('billingCadence') ?? 'monthly').trim();
  const siteIds = (formData.getAll('siteIds') as FormDataEntryValue[]).map(String).filter(Boolean);

  if (!partnerId || !title) throw new Error('partnerId + title required');
  const n = Number.parseFloat(totalValue || '0');
  if (!Number.isFinite(n)) throw new Error('totalValue must be numeric');

  const { data, error } = await sb.from('network_sponsorships').insert({
    partner_id: partnerId,
    title,
    total_value_minor: Math.round(n * 100),
    currency,
    term_months: termMonths ? Number(termMonths) : null,
    starts_on: startsOn && /^\d{4}-\d{2}-\d{2}$/.test(startsOn) ? startsOn : null,
    ends_on: endsOn && /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? endsOn : null,
    billing_cadence: cadence,
    status: 'draft',
    created_by: admin.adminRowId,
  }).select('id').single();
  if (error) throw new Error(`[sponsorships] create: ${error.message}`);
  const spId = data.id as string;

  if (siteIds.length) {
    const share = Number((1 / siteIds.length).toFixed(4));
    const rows = siteIds.map((site_id) => ({ sponsorship_id: spId, site_id, value_share: share }));
    const { error: sErr } = await sb.from('network_sponsorship_sites').insert(rows);
    if (sErr) throw new Error(`[sponsorships] sites: ${sErr.message}`);
  }

  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'sponsorship.created', entity_type: 'network_sponsorships', entity_id: spId,
    new_value: { partner_id: partnerId, title, total_value_minor: Math.round(n * 100), currency, site_ids: siteIds },
  });

  revalidatePath('/admin/partners');
  revalidatePath('/admin/partners/sponsorships');
  redirect(`/admin/partners/sponsorships/${spId}`);
}

export async function updateSponsorshipAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) throw new Error('id required');
  const patch: Record<string, unknown> = {};
  const status = String(formData.get('status') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const startsOn = String(formData.get('startsOn') ?? '').trim();
  const endsOn = String(formData.get('endsOn') ?? '').trim();
  const signedAt = String(formData.get('signedAt') ?? '').trim();
  const totalValue = String(formData.get('totalValue') ?? '').trim();
  const currency = String(formData.get('currency') ?? '').trim().toUpperCase();
  const cadence = String(formData.get('billingCadence') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  if (status) patch.status = status;
  if (title) patch.title = title;
  if (startsOn && /^\d{4}-\d{2}-\d{2}$/.test(startsOn)) patch.starts_on = startsOn;
  if (endsOn && /^\d{4}-\d{2}-\d{2}$/.test(endsOn)) patch.ends_on = endsOn;
  if (signedAt && !Number.isNaN(Date.parse(signedAt))) patch.signed_at = signedAt;
  if (totalValue) {
    const n = Number.parseFloat(totalValue);
    if (!Number.isFinite(n)) throw new Error('totalValue must be numeric');
    patch.total_value_minor = Math.round(n * 100);
  }
  if (currency && currency.length === 3) patch.currency = currency;
  if (cadence) patch.billing_cadence = cadence;
  patch.notes = notes || null;

  const { error } = await sb.from('network_sponsorships').update(patch).eq('id', id);
  if (error) throw new Error(`[sponsorships] update: ${error.message}`);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'sponsorship.updated', entity_type: 'network_sponsorships', entity_id: id,
    new_value: patch,
  });
  revalidatePath(`/admin/partners/sponsorships/${id}`);
  revalidatePath('/admin/partners/sponsorships');
}

export async function addDeliverableAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const sponsorshipId = String(formData.get('sponsorshipId') ?? '').trim();
  const offerId = String(formData.get('offerId') ?? '').trim() || null;
  const siteId = String(formData.get('siteId') ?? '').trim() || null;
  const displayName = String(formData.get('displayName') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();
  const quantity = Number(formData.get('quantity') ?? 1);
  const placementHint = String(formData.get('placementHint') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (!sponsorshipId || !displayName || !category) throw new Error('sponsorshipId + displayName + category required');

  // If offerId provided, freeze its label/category from the catalogue.
  let frozenName = displayName;
  let frozenCategory = category;
  if (offerId) {
    const { data } = await sb.from('network_commercial_offers').select('display_name, category').eq('id', offerId).maybeSingle();
    if (data) {
      frozenName = displayName || data.display_name;
      frozenCategory = category || data.category;
    }
  }

  const { error } = await sb.from('network_sponsorship_deliverables').insert({
    sponsorship_id: sponsorshipId,
    offer_id: offerId,
    site_id: siteId,
    display_name: frozenName,
    category: frozenCategory,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
    placement_hint: placementHint,
    status: 'planned',
    notes,
  });
  if (error) throw new Error(`[deliverables] insert: ${error.message}`);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'sponsorship.deliverable.added', entity_type: 'network_sponsorship_deliverables',
    new_value: { sponsorship_id: sponsorshipId, display_name: frozenName, category: frozenCategory, offer_id: offerId, site_id: siteId },
  });
  revalidatePath(`/admin/partners/sponsorships/${sponsorshipId}`);
}

export async function createOfferAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners/offers');
  const name = String(formData.get('name') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();
  if (!name || !category) throw new Error('name + category required');
  const slug = slugify(name) || `offer-${Date.now()}`;
  const description = String(formData.get('description') ?? '').trim() || null;
  const scope = String(formData.get('defaultScope') ?? 'single_site').trim();
  const unit = String(formData.get('defaultUnit') ?? 'month').trim();
  const priceRaw = String(formData.get('defaultPrice') ?? '').trim();
  const currency = String(formData.get('defaultCurrency') ?? 'GBP').trim().toUpperCase();
  const price = priceRaw ? Math.round(Number.parseFloat(priceRaw) * 100) : null;
  const { error } = await sb.from('network_commercial_offers').insert({
    slug, display_name: name, category, description,
    default_scope: scope, default_unit: unit, default_price_minor: price, default_currency: currency,
  });
  if (error) throw new Error(`[offers] insert: ${error.message}`);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'offer.created', entity_type: 'network_commercial_offers',
    new_value: { slug, name, category },
  });
  revalidatePath('/admin/partners/offers');
}

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';

// Release Tracker · CRUD Server Actions.
//
// All writes go through here so RLS stays strict and the change
// log (network_tcg_release_changes) is maintained consistently.
// v1 is manual-curation only; no scraper runs these actions.

const VALID_TCG = new Set(['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana']);
const VALID_PRODUCT_TYPE = new Set([
  'expansion', 'booster', 'starter_deck', 'structure_deck',
  'special_collection', 'premium', 'promo', 'other',
]);
const VALID_LANGUAGE = new Set(['en', 'ja', 'other']);
const VALID_PRECISION = new Set(['day', 'month', 'tbc']);
const VALID_STATUS = new Set([
  'confirmed', 'announced_tbc', 'rumoured',
  'postponed', 'released', 'cancelled',
]);

interface ReleasePayload {
  tcg: string;
  site_slug: string;
  set_name: string;
  set_name_original: string | null;
  set_name_translated: string | null;
  translation_official: boolean;
  set_code: string | null;
  product_type: string;
  language: string;
  region: string | null;
  release_date: string | null;
  release_date_precision: string;
  prerelease_date: string | null;
  confirmation_status: string;
  source_url: string | null;
  source_notes: string | null;
  site_set_url: string | null;
}

function readPayload(fd: FormData): { ok: true; value: ReleasePayload } | { ok: false; error: string } {
  const str = (k: string) => {
    const v = fd.get(k);
    if (typeof v !== 'string') return '';
    return v.trim();
  };
  const tcg = str('tcg');
  const site_slug = str('site_slug') || tcg;  // default site to the TCG
  const set_name = str('set_name');
  const product_type = str('product_type') || 'expansion';
  const language = str('language') || 'en';
  const precision = str('release_date_precision') || 'day';
  const status = str('confirmation_status') || 'confirmed';
  if (!VALID_TCG.has(tcg)) return { ok: false, error: 'tcg must be one of pokemon/mtg/ygo/onepiece/lorcana' };
  if (!VALID_TCG.has(site_slug)) return { ok: false, error: 'site_slug must be one of pokemon/mtg/ygo/onepiece/lorcana' };
  if (!set_name) return { ok: false, error: 'set name is required' };
  if (set_name.length > 240) return { ok: false, error: 'set name too long (max 240 chars)' };
  if (!VALID_PRODUCT_TYPE.has(product_type)) return { ok: false, error: 'product_type invalid' };
  if (!VALID_LANGUAGE.has(language)) return { ok: false, error: 'language invalid' };
  if (!VALID_PRECISION.has(precision)) return { ok: false, error: 'release_date_precision invalid' };
  if (!VALID_STATUS.has(status)) return { ok: false, error: 'confirmation_status invalid' };

  const dateRaw = str('release_date');
  // When precision is 'tbc' we store null; when 'month' we accept
  // YYYY-MM (coerced to YYYY-MM-01) OR YYYY-MM-DD.
  let release_date: string | null = null;
  if (precision !== 'tbc' && dateRaw) {
    if (/^\d{4}-\d{2}$/.test(dateRaw)) release_date = `${dateRaw}-01`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) release_date = dateRaw;
    else return { ok: false, error: 'release_date must be YYYY-MM-DD or YYYY-MM' };
  }

  const preRaw = str('prerelease_date');
  let prerelease_date: string | null = null;
  if (preRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(preRaw)) return { ok: false, error: 'prerelease_date must be YYYY-MM-DD' };
    prerelease_date = preRaw;
  }

  return {
    ok: true,
    value: {
      tcg,
      site_slug,
      set_name,
      set_name_original: str('set_name_original') || null,
      set_name_translated: str('set_name_translated') || null,
      translation_official: fd.get('translation_official') === 'on',
      set_code: str('set_code') || null,
      product_type,
      language,
      region: str('region') || null,
      release_date,
      release_date_precision: precision,
      prerelease_date,
      confirmation_status: status,
      source_url: str('source_url') || null,
      source_notes: str('source_notes') || null,
      site_set_url: str('site_set_url') || null,
    },
  };
}

export async function createReleaseAction(fd: FormData): Promise<void> {
  const { sb, admin } = await requireAdmin('/admin/intelligence/releases');
  const parsed = readPayload(fd);
  if (!parsed.ok) {
    const qs = new URLSearchParams({ create_error: parsed.error }).toString();
    redirect(`/admin/intelligence/releases?${qs}`);
  }
  const now = new Date().toISOString();
  const { error } = await sb.from('network_tcg_releases').insert({
    ...parsed.value,
    source_verified_at: now,
    verification_mode: 'manual',
    created_by: admin.adminRowId,
    updated_by: admin.adminRowId,
  });
  if (error) {
    const qs = new URLSearchParams({ create_error: error.message }).toString();
    redirect(`/admin/intelligence/releases?${qs}`);
  }
  revalidatePath('/admin/intelligence/releases');
  revalidatePath('/admin/intelligence');
  redirect('/admin/intelligence/releases?created=1');
}

export async function updateReleaseAction(fd: FormData): Promise<void> {
  const id = fd.get('id');
  if (typeof id !== 'string') redirect('/admin/intelligence/releases?update_error=missing_id');
  const { sb, admin } = await requireAdmin('/admin/intelligence/releases');
  const parsed = readPayload(fd);
  if (!parsed.ok) {
    const qs = new URLSearchParams({ update_error: parsed.error }).toString();
    redirect(`/admin/intelligence/releases/${id}?${qs}`);
  }

  // Load the existing row so we can detect a date change and
  // write a change-log entry.
  const { data: existing } = await sb.from('network_tcg_releases')
    .select('release_date, confirmation_status, source_url')
    .eq('id', id).maybeSingle();
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    ...parsed.value,
    source_verified_at: now,
    updated_by: admin.adminRowId,
  };
  const prev = existing as { release_date: string | null; confirmation_status: string; source_url: string | null } | null;
  if (prev && prev.release_date !== parsed.value.release_date && parsed.value.release_date) {
    update.previous_release_date = prev.release_date;
    update.date_changed_at = now;
  }

  const { error } = await sb.from('network_tcg_releases').update(update).eq('id', id);
  if (error) {
    const qs = new URLSearchParams({ update_error: error.message }).toString();
    redirect(`/admin/intelligence/releases/${id}?${qs}`);
  }

  // Audit entries for the changelog.
  if (prev) {
    if (prev.release_date !== parsed.value.release_date) {
      await sb.from('network_tcg_release_changes').insert({
        release_id: id, change_type: 'date_changed',
        previous_value: { release_date: prev.release_date },
        new_value: { release_date: parsed.value.release_date },
        changed_by: admin.adminRowId,
        change_source: 'operator',
      });
    }
    if (prev.confirmation_status !== parsed.value.confirmation_status) {
      await sb.from('network_tcg_release_changes').insert({
        release_id: id, change_type: 'status_changed',
        previous_value: { confirmation_status: prev.confirmation_status },
        new_value: { confirmation_status: parsed.value.confirmation_status },
        changed_by: admin.adminRowId,
        change_source: 'operator',
      });
    }
    if (prev.source_url !== parsed.value.source_url) {
      await sb.from('network_tcg_release_changes').insert({
        release_id: id, change_type: 'source_updated',
        previous_value: { source_url: prev.source_url },
        new_value: { source_url: parsed.value.source_url },
        changed_by: admin.adminRowId,
        change_source: 'operator',
      });
    }
  }

  revalidatePath('/admin/intelligence/releases');
  revalidatePath(`/admin/intelligence/releases/${id}`);
  revalidatePath('/admin/intelligence');
  redirect(`/admin/intelligence/releases/${id}?updated=1`);
}

export async function deleteReleaseAction(fd: FormData): Promise<void> {
  const id = fd.get('id');
  if (typeof id !== 'string') redirect('/admin/intelligence/releases');
  const { sb } = await requireAdmin('/admin/intelligence/releases');
  await sb.from('network_tcg_releases').delete().eq('id', id);
  revalidatePath('/admin/intelligence/releases');
  revalidatePath('/admin/intelligence');
  redirect('/admin/intelligence/releases?deleted=1');
}

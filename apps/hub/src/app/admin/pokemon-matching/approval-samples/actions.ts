'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';

export async function setSampleVerdict(
  sampleId: string,
  passed: boolean | null,
  reason: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching/approval-samples');

  const { error } = await sb.from('pokemon_tcg_mapping_approval_samples')
    .update({
      passed,
      reason: reason ?? null,
      checker: admin.email,
      checked_at: new Date().toISOString(),
    })
    .eq('id', sampleId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/pokemon-matching/approval-samples');
  revalidatePath('/admin/pokemon-matching');
  return { ok: true };
}

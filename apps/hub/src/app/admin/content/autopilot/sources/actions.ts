'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { setSourceEnabled } from '@/server/autopilot/sources';
import { runDiscovery } from '@/server/autopilot/discovery';
import type { AutopilotSiteSlug } from '@/server/autopilot/config';

export async function toggleSourceAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const value = formData.get('value') === 'true';
  if (!id) return;
  const { sb } = await requireAdmin('/admin/content/autopilot/sources');
  await setSourceEnabled(sb, id, value);
  revalidatePath('/admin/content/autopilot/sources');
}

export async function refreshDiscoveryAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('site_slug') ?? 'ygo') as AutopilotSiteSlug;
  const { sb } = await requireAdmin('/admin/content/autopilot/sources');
  await runDiscovery(sb, slug, { force: true });
  revalidatePath('/admin/content/autopilot/sources');
  revalidatePath('/admin/content/autopilot/preview');
}

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';
import { composeWeeklyNewsletter } from '@/server/newsletter/compose';

export async function composeNewsletterAction(): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/newsletter');
  const r = await composeWeeklyNewsletter(sb, admin.adminRowId);
  revalidatePath('/admin/newsletter');
  redirect(`/admin/newsletter/${r.newsletterId}`);
}

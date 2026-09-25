'use server';

// Server actions for collection writes. Every call runs with the
// authenticated user's Supabase session; RLS enforces ownership on
// insert/update/delete. Never accepts a user_id from client input.

import { revalidatePath } from 'next/cache';
import {
  addCollectionItem,
  deleteAllForCurrentUser,
  deleteCollectionItem,
  updateCollectionItem,
} from '../../server/collection';
import type { AddCollectionInput } from '../../lib/collection-types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  tableMissing?: boolean;
}

export async function addCollectionAction(
  input: Partial<AddCollectionInput>,
): Promise<ActionResult> {
  const r = await addCollectionItem(input);
  if (r.ok) {
    revalidatePath('/collection');
    return { ok: true };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

export async function updateCollectionAction(
  id: string,
  patch: Partial<AddCollectionInput>,
): Promise<ActionResult> {
  const r = await updateCollectionItem(id, patch);
  if (r.ok) {
    revalidatePath('/collection');
    return { ok: true };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

export async function deleteCollectionAction(id: string): Promise<ActionResult> {
  const r = await deleteCollectionItem(id);
  if (r.ok) {
    revalidatePath('/collection');
    return { ok: true };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

// Called from the danger-zone flow before user_metadata cleanup.
// Returns row-count deleted; a missing table is treated as ok=true, 0.
// NEVER touches auth.users — that identity is shared across every
// Collector Network site.
export async function deleteAllCollectionAction(): Promise<
  ActionResult & { deleted?: number }
> {
  const r = await deleteAllForCurrentUser();
  if (r.ok) {
    revalidatePath('/collection');
    return { ok: true, deleted: r.value };
  }
  // deleteAllForCurrentUser treats "table missing" as ok=true so
  // r.reason here is always 'failed'; keep the guard for symmetry.
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

'use server';

// Server actions for watchlist writes. Every call runs with the
// authenticated user's session; RLS enforces ownership. Never
// accepts a user_id from client input.

import { revalidatePath } from 'next/cache';
import {
  addWatchItem,
  deleteAllWatchlistForCurrentUser,
  removeWatchByPrinting,
  removeWatchItem,
  updateWatchTarget,
} from '../../server/watchlist';
import type { AddWatchInput, UpdateTargetInput } from '../../lib/watchlist-types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  tableMissing?: boolean;
}

export async function addWatchAction(
  input: Partial<AddWatchInput>,
): Promise<ActionResult> {
  const r = await addWatchItem(input);
  if (r.ok) {
    revalidatePath('/watchlist');
    return { ok: true };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

export async function removeWatchAction(id: string): Promise<ActionResult> {
  const r = await removeWatchItem(id);
  if (r.ok) {
    revalidatePath('/watchlist');
    return { ok: true };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

export async function removeWatchByPrintingAction(
  tcg_printing_id: string,
): Promise<ActionResult> {
  const r = await removeWatchByPrinting(tcg_printing_id);
  if (r.ok) {
    revalidatePath('/watchlist');
    return { ok: true };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

export async function updateTargetAction(
  id: string,
  patch: Partial<UpdateTargetInput>,
): Promise<ActionResult> {
  const r = await updateWatchTarget(id, patch);
  if (r.ok) {
    revalidatePath('/watchlist');
    return { ok: true };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

// Called by the DangerZone flow before user_metadata cleanup +
// sign-out. Never touches auth.users.
export async function deleteAllWatchlistAction(): Promise<
  ActionResult & { deleted?: number }
> {
  const r = await deleteAllWatchlistForCurrentUser();
  if (r.ok) {
    revalidatePath('/watchlist');
    return { ok: true, deleted: r.value };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

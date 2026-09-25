'use server';

// Exposed as a Server Action so DangerZone can wipe every deck row
// (which cascades to deck_cards) before user_metadata cleanup +
// sign-out. Never touches auth.users.

import { revalidatePath } from 'next/cache';
import { deleteAllDecksForCurrentUser } from '../../server/decks';

export interface DangerResult {
  ok: boolean;
  deleted?: number;
  error?: string;
  tableMissing?: boolean;
}

export async function deleteAllDecksAction(): Promise<DangerResult> {
  const r = await deleteAllDecksForCurrentUser();
  if (r.ok) {
    revalidatePath('/decks');
    return { ok: true, deleted: r.value };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

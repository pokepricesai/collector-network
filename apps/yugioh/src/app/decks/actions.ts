'use server';

// Deck server actions. Every call runs with the authenticated user's
// session; RLS enforces ownership on decks and (via subquery)
// deck_cards. Server-side identity + placement invariants (I1-I4)
// live in server/decks.ts.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createDeck,
  deleteDeck,
  duplicateDeck,
  renameDeck,
  setPreferredPrinting,
  upsertDeckCard,
  type AddCardInput,
} from '../../server/decks';

export interface ActionResult {
  ok: boolean;
  error?: string;
  tableMissing?: boolean;
}

export async function createDeckAction(input: {
  name: string;
  description?: string | null;
}): Promise<ActionResult & { id?: string }> {
  const r = await createDeck(input);
  if (r.ok) {
    revalidatePath('/decks');
    return { ok: true, id: r.value.id };
  }
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

export async function createDeckFormAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const r = await createDeck({ name, description });
  if (!r.ok) {
    // For the form-post path we just bounce back to /decks/new with
    // the error surfaced in a query param — the page reads it.
    const err = r.reason === 'table-missing' ? 'Storage pending' : r.error;
    redirect(`/decks/new?error=${encodeURIComponent(err)}`);
  }
  revalidatePath('/decks');
  redirect(`/decks/${r.value.id}`);
}

function fail(r: { reason: 'table-missing' } | { reason: 'failed'; error: string }): ActionResult {
  return r.reason === 'table-missing'
    ? { ok: false, tableMissing: true }
    : { ok: false, error: r.error };
}

export async function renameDeckAction(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<ActionResult> {
  const r = await renameDeck(id, patch);
  if (r.ok) {
    revalidatePath('/decks');
    revalidatePath(`/decks/${id}`);
    return { ok: true };
  }
  return fail(r);
}

export async function deleteDeckAction(id: string): Promise<ActionResult> {
  const r = await deleteDeck(id);
  if (r.ok) {
    revalidatePath('/decks');
    return { ok: true };
  }
  return fail(r);
}

export async function duplicateDeckAction(
  id: string,
): Promise<ActionResult & { id?: string }> {
  const r = await duplicateDeck(id);
  if (r.ok) {
    revalidatePath('/decks');
    return { ok: true, id: r.value.id };
  }
  return fail(r);
}

export async function upsertDeckCardAction(
  deckId: string,
  input: AddCardInput,
): Promise<ActionResult> {
  const r = await upsertDeckCard(deckId, input);
  if (r.ok) {
    revalidatePath(`/decks/${deckId}`);
    return { ok: true };
  }
  return fail(r);
}

export async function setPreferredPrintingAction(
  deckId: string,
  input: { card_key: string; preferred_tcg_printing_id: string | null },
): Promise<ActionResult> {
  const r = await setPreferredPrinting(deckId, input);
  if (r.ok) {
    revalidatePath(`/decks/${deckId}`);
    return { ok: true };
  }
  return fail(r);
}

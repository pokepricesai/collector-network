'use server';

// Owner sharing actions: change visibility, rotate share token,
// copy a shared deck to my decks. Rename is already handled by the
// existing renameDeckAction — we chain a slug-sync here so the URL
// prefix follows the deck name for public decks.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  copySharedDeckToMyDecks,
  regenerateShareToken,
  setDeckVisibility,
  syncPublicSlugAfterRename,
  type DeckRowWithSharing,
} from '../../server/deck-publishing';
import type { Visibility } from '../../lib/deck-sharing';

export interface ShareActionResult {
  ok: boolean;
  error?: string;
  visibility?: Visibility;
  public_slug?: string | null;
  share_token?: string | null;
}

function project(r: DeckRowWithSharing): ShareActionResult {
  return {
    ok: true,
    visibility: r.visibility,
    public_slug: r.public_slug,
    share_token: r.share_token,
  };
}

export async function setVisibilityAction(
  deckId: string,
  next: Visibility,
): Promise<ShareActionResult> {
  const r = await setDeckVisibility(deckId, next);
  if (r.ok) {
    revalidatePath('/decks');
    revalidatePath(`/decks/${deckId}`);
    if (r.value.public_slug) revalidatePath(`/deck/${r.value.public_slug}`);
    return project(r.value);
  }
  return { ok: false, error: r.reason === 'not-found' ? 'Deck not found' : r.error };
}

export async function regenerateTokenAction(
  deckId: string,
): Promise<ShareActionResult> {
  const r = await regenerateShareToken(deckId);
  if (r.ok) {
    revalidatePath(`/decks/${deckId}`);
    return project(r.value);
  }
  return { ok: false, error: r.reason === 'not-found' ? 'Deck not found' : r.error };
}

// Chained action: called after a rename to keep the public slug's
// human-readable prefix in sync (the 8-char suffix is preserved
// so existing links keep resolving).
export async function syncPublicSlugAction(deckId: string): Promise<void> {
  await syncPublicSlugAfterRename(deckId);
  revalidatePath(`/decks/${deckId}`);
}

// Copy a public or unlisted deck to the viewer's own private
// decks. Redirects into the new deck builder on success.
export async function copySharedDeckAction(
  input:
    | { kind: 'public'; slug: string }
    | { kind: 'unlisted'; token: string },
): Promise<void> {
  const r = await copySharedDeckToMyDecks({ source: input });
  if (!r.ok) {
    // Bounce back to whichever path we came from with an error
    // param; the shared renderer surfaces it.
    const back =
      input.kind === 'public'
        ? `/deck/${encodeURIComponent(input.slug)}`
        : `/deck/share/${encodeURIComponent(input.token)}`;
    const err = r.reason === 'not-found' ? 'Deck not found' : r.error;
    redirect(`${back}?copy_error=${encodeURIComponent(err)}`);
  }
  revalidatePath('/decks');
  redirect(`/decks/${r.value.id}`);
}

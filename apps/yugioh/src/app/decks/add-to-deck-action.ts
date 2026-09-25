'use server';

// Small server action used by the Add-to-Deck picker on card +
// printing pages. Returns a shortlist of the caller's decks with
// counts, so the picker can render "Snake-Eye Fiendsmith · 42 / 15
// / 0 · legal" without fetching each deck detail on the client.

import { upsertDeckCardAction } from './actions';
import type { Section } from '../../lib/deck-identity';
import type { LegalityState } from '../../lib/deck-legality';

interface DeckPickerItem {
  id: string;
  name: string;
  main: number;
  extra: number;
  side: number;
  state: LegalityState;
}

export interface ListDecksResult {
  ok: boolean;
  decks?: DeckPickerItem[];
  error?: string;
  tableMissing?: boolean;
  signedOut?: boolean;
}

export async function listMyDecksForPickerAction(): Promise<ListDecksResult> {
  const r = await listDecksForCurrentUserSummaries();
  return r;
}

async function listDecksForCurrentUserSummaries(): Promise<ListDecksResult> {
  // Reuse the existing list helper to avoid a duplicate query path.
  // Runs on the server with the caller's session, so RLS enforces
  // owner-only visibility.
  const { listDecksForCurrentUser: list } = await import('../../server/decks');
  const r = await list();
  if (!r.ok) {
    if (r.reason === 'table-missing') return { ok: false, tableMissing: true };
    return { ok: false, error: r.error };
  }
  return {
    ok: true,
    decks: r.value.map((d) => ({
      id: d.deck.id,
      name: d.deck.name,
      main: d.counts.main,
      extra: d.counts.extra,
      side: d.counts.side,
      state: d.legality.state,
    })),
  };
}

// Convenience wrapper so the picker calls one action per add. Just
// pipes through to the Slice F server action which already enforces
// invariants I1..I4 (card_key derived server-side, preferred printing
// verified, F&L cap and section placement checked).
export async function addCardToDeckAction(
  deckId: string,
  input: {
    tcg_printing_id?: string;
    tcg_card_id?: string;
    card_name?: string;
    section: Section;
    preferred_tcg_printing_id?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const r = await upsertDeckCardAction(deckId, {
    ...input,
    deltaQty: 1,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

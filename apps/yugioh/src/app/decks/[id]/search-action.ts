'use server';

import { searchCardsForDeck } from '../../../server/deck-search';
import type { DeckSearchResult } from '../../../server/deck-search';

export interface SearchResponse {
  ok: boolean;
  results?: DeckSearchResult[];
  error?: string;
}

export async function searchDeckCardsAction(opts: {
  text?: string;
  frame?: string;
  archetype?: string;
  extraOnly?: boolean;
  mainOnly?: boolean;
  limit?: number;
}): Promise<SearchResponse> {
  try {
    const results = await searchCardsForDeck(opts);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

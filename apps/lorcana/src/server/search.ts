import 'server-only';
import {
  getCardSuggestionsByPrefix,
  searchCardsByName,
  type CardSuggestion,
  type TcgCard,
} from '@collector-network/database';
import { getLorcanaClient, getLorcanaGameId } from './client';

/** Suggest cards for the header search dropdown. Prefix-based so it
 *  stays fast against the current indexes. */
export async function suggestCards(prefix: string, limit = 8): Promise<CardSuggestion[]> {
  const supabase = getLorcanaClient();
  const gameId = await getLorcanaGameId(supabase);
  return getCardSuggestionsByPrefix(supabase, gameId, prefix, limit);
}

/** Full name-search used by /cards/search. Slower than the prefix
 *  path — page surfaces the latency honestly in the UI. */
export async function searchCards(query: string, limit = 200): Promise<TcgCard[]> {
  const supabase = getLorcanaClient();
  const gameId = await getLorcanaGameId(supabase);
  return searchCardsByName(supabase, gameId, query, limit);
}

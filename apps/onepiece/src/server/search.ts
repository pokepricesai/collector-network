import 'server-only';
import {
  getCardSuggestionsByPrefix,
  searchCardsByName,
  type CardSuggestion,
  type TcgCard,
} from '@collector-network/database';
import { getOnepieceClient, getOnepieceGameId } from './client';

/** Suggest cards for the header search dropdown. Prefix-based so it
 *  stays fast against the current indexes. */
export async function suggestCards(prefix: string, limit = 8): Promise<CardSuggestion[]> {
  const supabase = getOnepieceClient();
  const gameId = await getOnepieceGameId(supabase);
  return getCardSuggestionsByPrefix(supabase, gameId, prefix, limit);
}

/** Full name-search used by /cards/search. Slower than the prefix
 *  path — page surfaces the latency honestly in the UI. */
export async function searchCards(query: string, limit = 200): Promise<TcgCard[]> {
  const supabase = getOnepieceClient();
  const gameId = await getOnepieceGameId(supabase);
  return searchCardsByName(supabase, gameId, query, limit);
}

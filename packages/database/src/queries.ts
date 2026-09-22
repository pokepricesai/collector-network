import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  TcgCard,
  TcgGame,
  TcgPrinting,
  TcgSet,
} from './types.js';

// Low-level read helpers over the shared tcg_* tables. Game-agnostic — do
// not put YGO/MTG/Pokémon semantics in here. Errors are re-thrown so that
// callers can decide how to surface them.

function throwOnError<T>({
  data,
  error,
  context,
}: {
  data: T | null;
  error: { message: string } | null;
  context: string;
}): T {
  if (error) {
    throw new Error(`[@collector-network/database] ${context}: ${error.message}`);
  }
  if (data === null) {
    throw new Error(`[@collector-network/database] ${context}: null result`);
  }
  return data;
}

export async function getGameBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<TcgGame | null> {
  const { data, error } = await supabase
    .from('tcg_games')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[@collector-network/database] getGameBySlug(${slug}): ${error.message}`,
    );
  }
  return (data as TcgGame | null) ?? null;
}

export async function getGameById(
  supabase: SupabaseClient,
  gameId: string,
): Promise<TcgGame | null> {
  const { data, error } = await supabase
    .from('tcg_games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[@collector-network/database] getGameById(${gameId}): ${error.message}`,
    );
  }
  return (data as TcgGame | null) ?? null;
}

export async function getSetById(
  supabase: SupabaseClient,
  setId: string,
): Promise<TcgSet | null> {
  const { data, error } = await supabase
    .from('tcg_sets')
    .select('*')
    .eq('id', setId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[@collector-network/database] getSetById(${setId}): ${error.message}`,
    );
  }
  return (data as TcgSet | null) ?? null;
}

export async function getSetsByIds(
  supabase: SupabaseClient,
  setIds: readonly string[],
): Promise<TcgSet[]> {
  if (setIds.length === 0) return [];
  const { data, error } = await supabase
    .from('tcg_sets')
    .select('*')
    .in('id', [...setIds]);
  return throwOnError<TcgSet[]>({
    data: (data as TcgSet[] | null) ?? [],
    error,
    context: 'getSetsByIds',
  });
}

export async function getSetByCode(
  supabase: SupabaseClient,
  gameId: string,
  code: string,
): Promise<TcgSet | null> {
  const { data, error } = await supabase
    .from('tcg_sets')
    .select('*')
    .eq('game_id', gameId)
    .eq('code', code)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[@collector-network/database] getSetByCode(${gameId}, ${code}): ${error.message}`,
    );
  }
  return (data as TcgSet | null) ?? null;
}

export async function getCardById(
  supabase: SupabaseClient,
  cardId: string,
): Promise<TcgCard | null> {
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('*')
    .eq('id', cardId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[@collector-network/database] getCardById(${cardId}): ${error.message}`,
    );
  }
  return (data as TcgCard | null) ?? null;
}

export interface GetCardsByNameOptions {
  exact?: boolean;
  limit?: number;
}

export async function getCardsByName(
  supabase: SupabaseClient,
  gameId: string,
  name: string,
  options: GetCardsByNameOptions = {},
): Promise<TcgCard[]> {
  const { exact = false, limit = 200 } = options;
  let query = supabase
    .from('tcg_cards')
    .select('*')
    .eq('game_id', gameId)
    .limit(limit);
  if (exact) {
    query = query.eq('name', name);
  } else {
    query = query.ilike('name', `%${name}%`);
  }
  const { data, error } = await query;
  return throwOnError<TcgCard[]>({
    data: (data as TcgCard[] | null) ?? [],
    error,
    context: `getCardsByName(${gameId}, ${name})`,
  });
}

export async function getCardsByCollectorNumber(
  supabase: SupabaseClient,
  gameId: string,
  collectorNumber: string,
): Promise<TcgCard[]> {
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('*')
    .eq('game_id', gameId)
    .eq('collector_number', collectorNumber);
  return throwOnError<TcgCard[]>({
    data: (data as TcgCard[] | null) ?? [],
    error,
    context: `getCardsByCollectorNumber(${gameId}, ${collectorNumber})`,
  });
}

export async function getPrintingById(
  supabase: SupabaseClient,
  printingId: string,
): Promise<TcgPrinting | null> {
  const { data, error } = await supabase
    .from('tcg_printings')
    .select('*')
    .eq('id', printingId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[@collector-network/database] getPrintingById(${printingId}): ${error.message}`,
    );
  }
  return (data as TcgPrinting | null) ?? null;
}

export async function getPrintingsForCard(
  supabase: SupabaseClient,
  cardId: string,
): Promise<TcgPrinting[]> {
  const { data, error } = await supabase
    .from('tcg_printings')
    .select('*')
    .eq('tcg_card_id', cardId);
  return throwOnError<TcgPrinting[]>({
    data: (data as TcgPrinting[] | null) ?? [],
    error,
    context: `getPrintingsForCard(${cardId})`,
  });
}

export async function getPrintingsForCards(
  supabase: SupabaseClient,
  cardIds: readonly string[],
): Promise<TcgPrinting[]> {
  if (cardIds.length === 0) return [];
  const { data, error } = await supabase
    .from('tcg_printings')
    .select('*')
    .in('tcg_card_id', [...cardIds]);
  return throwOnError<TcgPrinting[]>({
    data: (data as TcgPrinting[] | null) ?? [],
    error,
    context: 'getPrintingsForCards',
  });
}

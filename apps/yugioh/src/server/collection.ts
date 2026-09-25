// Slice D — collection CRUD + valuation composition.
//
// Every read/write goes through the caller's own Supabase session
// (@supabase/ssr createServerClient with the user's auth cookie),
// so Row-Level Security alone enforces owner-only access. No service
// role is ever loaded here.
//
// Valuation preserves the attribution invariant established in Slice
// A + Slice 8:
//   - raw holding    → tcg_market_prices_current (retail is always
//                       printing-scoped by nature)
//   - graded holding → tcg_graded_prices_current where
//                       attribution='printing' AND grader = X AND
//                       grade = Y. If none exists, fall back to
//                       attribution='card' for the same grader/grade
//                       and label the source explicitly.
// Missing prices are NEVER silently substituted; the return type
// carries a `source: 'none'` and the summariser leaves them out of
// totals.

import {
  getPrintingsForCards,
  getSetsByIds,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
} from '@collector-network/database';
import { createServerSupabase } from '@collector-network/auth';
import {
  getRetailQuotesForPrintings,
  selectPreferredRetailQuote,
} from '@collector-network/market-data';
import {
  summarise,
  validateAddCollectionInput,
  type AddCollectionInput,
  type CollectionItemRow,
  type CollectionSummary,
  type PricedItem,
} from '../lib/collection-types';

// Attempt a query and translate the "table missing" error into a
// distinct code so the UI can render a friendly "schema pending"
// panel until the shared-schema owner has applied the migration.
export interface TableMissing {
  ok: false;
  reason: 'table-missing';
}
export interface Failure {
  ok: false;
  reason: 'failed';
  error: string;
}
export interface Success<T> {
  ok: true;
  value: T;
}
export type CollectionResult<T> = Success<T> | TableMissing | Failure;

const TABLE = 'ygo_collection_items';

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  // PostgREST codes:
  // 42P01  → relation does not exist
  // PGRST205 → schemata reload signals missing table on the schema cache
  return (
    err.code === '42P01' ||
    err.code === 'PGRST205' ||
    /does not exist/i.test(err.message ?? '') ||
    /Could not find the table/i.test(err.message ?? '')
  );
}

// ── Public shapes ────────────────────────────────────────────────

export interface CollectionListItem {
  row: CollectionItemRow;
  card: TcgCard | null;
  printing: TcgPrinting | null;
  set: TcgSet | null;
  priced: PricedItem;
}

export interface CollectionPageData {
  items: CollectionListItem[];
  summary: CollectionSummary;
}

// ── List + hydrate + price ───────────────────────────────────────

export async function listCollectionForCurrentUser(): Promise<
  CollectionResult<CollectionPageData>
> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  const rows = (data as CollectionItemRow[] | null) ?? [];
  if (rows.length === 0) {
    return {
      ok: true,
      value: {
        items: [],
        summary: summarise([]),
      },
    };
  }

  // Batch fetch cards + printings + sets. tcg_printing_id is NOT NULL
  // on ygo_collection_items so every row contributes an id here.
  const cardIds = Array.from(new Set(rows.map((r) => r.tcg_card_id)));
  const [cardsById, printings] = await Promise.all([
    fetchCardsById(supabase, cardIds),
    getPrintingsForCards(supabase, cardIds),
  ]);
  const printingsById = new Map<string, TcgPrinting>();
  for (const p of printings) printingsById.set(p.id, p);
  const setIds = Array.from(new Set([...cardsById.values()].map((c) => c.set_id)));
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  // Price hydration — batch retail + graded, keep attribution intact.
  const priced = await priceHoldings(supabase, rows, printingsById);

  const items: CollectionListItem[] = rows.map((row, i) => {
    const card = cardsById.get(row.tcg_card_id) ?? null;
    const printing = printingsById.get(row.tcg_printing_id) ?? null;
    const set = card ? setsById.get(card.set_id) ?? null : null;
    return { row, card, printing, set, priced: priced[i]! };
  });

  return {
    ok: true,
    value: {
      items,
      summary: summarise(priced),
    },
  };
}

async function fetchCardsById(
  supabase: SupabaseClient,
  cardIds: readonly string[],
): Promise<Map<string, TcgCard>> {
  const out = new Map<string, TcgCard>();
  if (cardIds.length === 0) return out;
  const IN_BATCH = 100;
  for (let i = 0; i < cardIds.length; i += IN_BATCH) {
    const batch = cardIds.slice(i, i + IN_BATCH);
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('*')
      .in('id', batch as string[]);
    if (error) throw new Error(`[yugioh/collection] cards: ${error.message}`);
    for (const c of (data as TcgCard[] | null) ?? []) out.set(c.id, c);
  }
  return out;
}

// ── Valuation ────────────────────────────────────────────────────

async function priceHoldings(
  supabase: SupabaseClient,
  rows: readonly CollectionItemRow[],
  _printingsById: Map<string, TcgPrinting>,
): Promise<PricedItem[]> {
  const rawPrintingIds = new Set<string>();
  const gradedPrintingIds = new Set<string>();
  const gradedCardIds = new Set<string>();
  for (const r of rows) {
    if (r.is_graded) {
      gradedPrintingIds.add(r.tcg_printing_id);
      gradedCardIds.add(r.tcg_card_id);
    } else {
      rawPrintingIds.add(r.tcg_printing_id);
    }
  }

  // Raw: batch retail for the printing IDs.
  const retailByPrinting = new Map<string, ReturnType<typeof selectPreferredRetailQuote>>();
  if (rawPrintingIds.size > 0) {
    const quotes = await getRetailQuotesForPrintings(
      supabase,
      [...rawPrintingIds],
    );
    const byPrinting = new Map<string, typeof quotes>();
    for (const q of quotes) {
      const b = byPrinting.get(q.printingId) ?? [];
      b.push(q);
      byPrinting.set(q.printingId, b);
    }
    for (const pid of rawPrintingIds) {
      retailByPrinting.set(pid, selectPreferredRetailQuote(byPrinting.get(pid) ?? [], 'USD'));
    }
  }

  // Graded printing-scoped: query directly. Filter attribution +
  // grader + grade at the DB layer for tight results.
  interface GradedRow {
    tcg_printing_id: string | null;
    tcg_card_id: string | null;
    attribution: 'printing' | 'card';
    grader: string;
    grade: string;
    currency: string;
    price: number | null;
  }
  const printingGraded = new Map<string, GradedRow>();
  if (gradedPrintingIds.size > 0) {
    const { data, error } = await supabase
      .from('tcg_graded_prices_current')
      .select('tcg_printing_id, tcg_card_id, attribution, grader, grade, currency, price')
      .in('tcg_printing_id', [...gradedPrintingIds])
      .eq('attribution', 'printing')
      .eq('currency', 'USD')
      .not('price', 'is', null);
    if (!error) {
      for (const row of (data as GradedRow[] | null) ?? []) {
        const key = `${row.tcg_printing_id}|${row.grader}|${row.grade}`;
        printingGraded.set(key, row);
      }
    }
  }
  // Card-scoped fallback keyed by (card, grader, grade).
  const cardGraded = new Map<string, GradedRow>();
  if (gradedCardIds.size > 0) {
    const { data, error } = await supabase
      .from('tcg_graded_prices_current')
      .select('tcg_printing_id, tcg_card_id, attribution, grader, grade, currency, price')
      .in('tcg_card_id', [...gradedCardIds])
      .eq('attribution', 'card')
      .eq('currency', 'USD')
      .not('price', 'is', null);
    if (!error) {
      for (const row of (data as GradedRow[] | null) ?? []) {
        const key = `${row.tcg_card_id}|${row.grader}|${row.grade}`;
        cardGraded.set(key, row);
      }
    }
  }

  return rows.map((row) => {
    if (row.is_graded) {
      const printingKey = `${row.tcg_printing_id}|${row.grader}|${row.grade}`;
      const p = printingGraded.get(printingKey);
      if (p?.price != null) {
        return {
          row,
          unitValueUsd: p.price,
          valueUsdSource: 'printing-graded',
          currency: 'USD',
        };
      }
      const cardKey = `${row.tcg_card_id}|${row.grader}|${row.grade}`;
      const c = cardGraded.get(cardKey);
      if (c?.price != null) {
        return {
          row,
          unitValueUsd: c.price,
          valueUsdSource: 'card-graded-family',
          currency: 'USD',
        };
      }
      return { row, unitValueUsd: null, valueUsdSource: 'none', currency: 'USD' };
    }
    // Raw: retail.
    const retail = retailByPrinting.get(row.tcg_printing_id);
    if (retail?.price != null) {
      return {
        row,
        unitValueUsd: retail.price,
        valueUsdSource: 'printing-retail',
        currency: 'USD',
      };
    }
    return { row, unitValueUsd: null, valueUsdSource: 'none', currency: 'USD' };
  });
}

// ── Writes ───────────────────────────────────────────────────────

export async function addCollectionItem(
  input: Partial<AddCollectionInput>,
): Promise<CollectionResult<CollectionItemRow>> {
  const validation = validateAddCollectionInput(input);
  if (!validation.ok) return { ok: false, reason: 'failed', error: validation.errors.join('; ') };
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      // user_id is enforced by RLS WITH CHECK too, but we set it
      // explicitly so a well-formed insert doesn't rely on the
      // policy's default.
      user_id: user.id,
      tcg_card_id: validation.value.tcg_card_id,
      tcg_printing_id: validation.value.tcg_printing_id,
      quantity: validation.value.quantity,
      is_graded: validation.value.is_graded,
      grader: validation.value.grader,
      grade: validation.value.grade,
      condition: validation.value.condition,
      purchase_price: validation.value.purchase_price,
      purchase_currency: validation.value.purchase_currency,
      purchase_date: validation.value.purchase_date,
      notes: validation.value.notes,
    })
    .select('*')
    .single();
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: data as CollectionItemRow };
}

export async function updateCollectionItem(
  id: string,
  patch: Partial<AddCollectionInput>,
): Promise<CollectionResult<CollectionItemRow>> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const validation = validateAddCollectionInput({
    tcg_card_id: 'placeholder',
    tcg_printing_id: 'placeholder',
    ...patch,
  });
  if (!validation.ok) {
    return { ok: false, reason: 'failed', error: validation.errors.join('; ') };
  }
  const { tcg_card_id, tcg_printing_id, ...allowedPatch } = validation.value;
  // Silence unused warnings — those two fields are re-read from the
  // existing row, callers may pass them but we ignore them.
  void tcg_card_id;
  void tcg_printing_id;
  const { data, error } = await supabase
    .from(TABLE)
    .update(allowedPatch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: data as CollectionItemRow };
}

export async function deleteCollectionItem(
  id: string,
): Promise<CollectionResult<null>> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'table-missing' };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: null };
}

// Delete every YGO row owned by the caller. Used by the danger-zone
// "delete YGOPrices data" flow before auth-metadata cleanup + sign-
// out. Never touches auth.users.
export async function deleteAllForCurrentUser(): Promise<CollectionResult<number>> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'failed', error: 'Not signed in' };
  const { data, error, count } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', user.id)
    .select('id');
  if (error) {
    if (isMissingTable(error)) return { ok: true, value: 0 };
    return { ok: false, reason: 'failed', error: error.message };
  }
  return { ok: true, value: (count ?? data?.length ?? 0) };
}

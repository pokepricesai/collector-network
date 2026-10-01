// Shared user-collection state loader. One tiny query per request —
// returns the Set of tcg_card_ids the signed-in user owns across the
// entire Lorcana catalogue. Every surface that cares about ownership
// (characters index, character detail, set index, set detail,
// dashboard) feeds off the same set so counts stay consistent and
// nothing fans out into N queries.
//
// RLS: the lorcana_collection_items table enforces owner-only reads,
// so this is implicitly scoped to the current session's user. Signed
// out → empty set.

import 'server-only';
import { createServerSupabase } from '@collector-network/auth';

/** The set of tcg_card_ids the signed-in user has in their collection.
 *  Returns an empty set for signed-out users, so callers can .has(id)
 *  without a null-check. */
export async function getOwnedCardIdSetForCurrentUser(): Promise<Set<string>> {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return new Set();
  const owned = new Set<string>();
  // One scan of the user's collection. The table is modest in size
  // per-user (dozens → low thousands of rows) and the index on
  // user_id + tcg_card_id makes this a tight read.
  //  Paged over 1000-row chunks defensively in case a power user has
  //  thousands of distinct cards; PostgREST caps a single response at
  //  1000 rows.
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await sb
      .from('lorcana_collection_items')
      .select('tcg_card_id')
      .range(from, from + CHUNK - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data as { tcg_card_id: string }[]) {
      owned.add(row.tcg_card_id);
    }
    if (data.length < CHUNK) break;
  }
  return owned;
}

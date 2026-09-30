// Lorcana set-completion helper — powers the "Your collection: X / Y"
// widget on /set/[slug] and the dashboard's set-progress panel.
//
// Base-slot rule (verified via
//   scripts/lorcana-set-checklist-forensic.mjs on 2026-09-30):
//
//   Lorcana assigns every card its own collector_number within a set.
//   Enchanted / Iconic reprints of the same character get DIFFERENT
//   numbers (e.g. base slots 1..204, Enchanteds 205..223). Multi-art
//   variants use letter-suffixed collector_numbers (e.g. Dalmatian
//   Puppy 4a / 4b / 4c / 4d / 4e). All 216..229 tcg_cards rows in a
//   probed main set were 1:1 with their collector_numbers.
//
//   Consequence: every tcg_cards row IS a base checklist slot for
//   Lorcana. There are no "same-slot reprints" to collapse. The rule
//   is therefore: base slot = distinct tcg_card_id within a set.
//
// This is the natural (set_id, collector_number) rule the task
// requested — Lorcana simply has 1 tcg_cards row per collector_number,
// so counting tcg_card_ids and counting collector_numbers are
// equivalent. We use tcg_card_id because it's already the FK on
// lorcana_collection_items and cheaper to join.
//
// RLS is enforced via createServerSupabase() — the caller's own
// authenticated session. No service role. Signed-out callers get a
// null result and the page renders the sign-in CTA.

import 'server-only';
import { createServerSupabase } from '@collector-network/auth';
import type { SupabaseClient, TcgCard } from '@collector-network/database';

export interface SetCompletion {
  owned: number;
  total: number;
  missingSample: TcgCard[];
}

/**
 * Compute set-completion for the currently signed-in user, using the
 * base-slot rule above. Returns `null` if the caller isn't signed in.
 * Returns { owned: 0, total: <n> } if the set has cards but the user
 * owns none.
 */
export async function getSetCompletionForCurrentUser({
  setId,
  missingLimit = 12,
}: {
  setId: string;
  missingLimit?: number;
}): Promise<SetCompletion | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Total = distinct tcg_card_id rows in this set. Equivalent to the
  // distinct collector_number count per the base-slot rule above.
  // Narrow projection (2026-09-30 perf pass): the set page render
  // only needs id + name + collector_number + rarity to enumerate a
  // missing sample; pulling `*` was dragging gamedata JSON on every
  // set-page load for signed-in users.
  const { data: allCards, error: cardsErr } = await supabase
    .from('tcg_cards')
    .select('id, name, collector_number, rarity, set_id')
    .eq('set_id', setId);
  if (cardsErr) {
    throw new Error(`[lorcana/set-completion] cards ${setId}: ${cardsErr.message}`);
  }
  const cards = (allCards as TcgCard[] | null) ?? [];
  const total = cards.length;
  if (total === 0) return { owned: 0, total: 0, missingSample: [] };

  // Owned = distinct tcg_card_ids the user has in this set (any
  // quantity, raw or graded, both count).
  const { data: ownedRows, error: ownedErr } = await supabase
    .from('lorcana_collection_items')
    .select('tcg_card_id')
    .in(
      'tcg_card_id',
      cards.map((c) => c.id),
    );
  if (ownedErr) {
    // RLS-protected — a "no rows" outcome is not an error, but a real
    // failure (permissions, connection) is.
    throw new Error(`[lorcana/set-completion] owned ${setId}: ${ownedErr.message}`);
  }
  const ownedSet = new Set<string>();
  for (const r of (ownedRows as { tcg_card_id: string }[] | null) ?? []) {
    ownedSet.add(r.tcg_card_id);
  }
  const owned = ownedSet.size;

  // A small sample of the cards the user is missing — the "See
  // missing (N)" link target hydrates from this. Ordered by
  // collector_number so the sample feels intentional, not random.
  const missing = cards
    .filter((c) => !ownedSet.has(c.id))
    .sort((a, b) => {
      const an = a.collector_number ?? '';
      const bn = b.collector_number ?? '';
      // Numeric-then-letter sort: "4a" > "4" > "10".
      const am = /^(\d+)([a-z]?)$/.exec(an);
      const bm = /^(\d+)([a-z]?)$/.exec(bn);
      if (am && bm) {
        const diff = Number(am[1]) - Number(bm[1]);
        if (diff !== 0) return diff;
        return (am[2] ?? '').localeCompare(bm[2] ?? '');
      }
      return an.localeCompare(bn);
    })
    .slice(0, Math.max(1, missingLimit));

  return { owned, total, missingSample: missing };
}

/**
 * HEAD-count the total number of base checklist slots in a set, using
 * the same base-slot rule as `getSetCompletionForCurrentUser`.
 *
 * For Lorcana that is just the tcg_cards row count in the set. Kept as
 * a named helper so callers (dashboard, future imports/exports) share
 * one canonical implementation.
 */
export async function countBaseSlotsForSet(
  supabase: SupabaseClient,
  setId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('tcg_cards')
    .select('id', { count: 'exact', head: true })
    .eq('set_id', setId);
  if (error) {
    throw new Error(`[lorcana/set-completion] countBaseSlots ${setId}: ${error.message}`);
  }
  return count ?? 0;
}


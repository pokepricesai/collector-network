-- CN-06.06 corrections pass 2 · quarter precision + region-aware
-- uniqueness.
--
-- Two additive schema changes required by the publisher data we
-- actually need to seed:
--
--   * Lorcana Cosmic Quest is announced as "Q2 2027" with no month.
--     Honour it as a first-class precision rather than fabricating
--     a day or stripping it to 'tbc'. Precision='quarter' stores
--     the first day of the quarter in release_date (Q1→Jan 1,
--     Q2→Apr 1, Q3→Jul 1, Q4→Oct 1) for correct chronological
--     sorting; the UI renders "Q2 2027" and suppresses the
--     day-countdown.
--
--   * Yu-Gi-Oh! Magnificent Maestros, Glorious Victors and Maze
--     of Machines all have different EU vs NA release dates. The
--     base table's unique(tcg, set_code, language) rejects the
--     second region as a duplicate. Change the unique key to
--     (tcg, set_code, language, COALESCE(region, '')) so regional
--     variants coexist without collisions, with NULL region
--     coalesced to '' so legacy null-region rows still enforce
--     uniqueness within that scope.

-- ─────────────── release_date_precision: add 'quarter' ─────────────

alter table public.network_tcg_releases
  drop constraint if exists network_tcg_releases_release_date_precision_check;

alter table public.network_tcg_releases
  add constraint network_tcg_releases_release_date_precision_check
  check (release_date_precision in ('day','month','quarter','tbc'));

alter table public.network_tcg_releases
  drop constraint if exists network_tcg_releases_proposed_prec_check;

alter table public.network_tcg_releases
  add constraint network_tcg_releases_proposed_prec_check
  check (
    proposed_release_date_precision is null
    or proposed_release_date_precision in ('day','month','quarter','tbc')
  );

-- ─────────────── unique key (effective-identifier based) ──────────
--
-- Three different legitimate release shapes coexist on this table:
--   * Known official set code      (e.g. MTG "TRK", YGO "MAMS")
--   * No set code, name identifies (e.g. Pokémon "Delta Reign" —
--     press.pokemon.com advertises the product but no public code)
--   * Same code, different region  (e.g. YGO MAMS EU vs NA)
--
-- The original (tcg, set_code, language) base-table constraint
-- collapsed all no-code rows for a TCG into one slot, which blocks
-- three real Pokémon releases. A naive (tcg, COALESCE(set_code,''),
-- language, COALESCE(region,'')) replacement has the same defect
-- (all three Pokémon releases hash to 'pokemon|''|en|US').
--
-- Solution: use set_code when the publisher provides one, and
-- fall back to the set_name when they don't. The "name:" prefix
-- prevents a theoretical collision where a future set_code string
-- happens to equal a set_name. Key is deterministic, index-friendly,
-- and semantically honest: "two rows are duplicates iff they
-- identify the same product in the same region+language."

do $$
declare
  cname text;
begin
  -- Drop the auto-named base-table constraint (name is PG-generated,
  -- not hard-coded in the migration history).
  select conname into cname
  from pg_constraint
  where conrelid = 'public.network_tcg_releases'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%(tcg, set_code, language)%';
  if cname is not null then
    execute format('alter table public.network_tcg_releases drop constraint %I', cname);
  end if;
end $$;

-- Drop any PRIOR partial run of this migration that created the
-- less-correct region-only variant of the index. Safe no-op if
-- absent.
drop index if exists public.network_tcg_releases_unique_key;

-- Effective-identifier unique index. NULL set_code falls back to
-- 'name:' || set_name so no-code rows discriminate by product name.
create unique index if not exists network_tcg_releases_unique_key
  on public.network_tcg_releases
  (tcg,
   language,
   coalesce(region, ''),
   coalesce(set_code, 'name:' || set_name));

notify pgrst, 'reload schema';

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

-- ─────────────── unique(tcg, set_code, language, region) ───────────
--
-- Drop the auto-named base-table unique constraint via a pg_catalog
-- lookup — we don't hard-code the auto-generated name because PG's
-- naming is implementation-dependent.

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.network_tcg_releases'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%(tcg, set_code, language)%';
  if cname is not null then
    execute format('alter table public.network_tcg_releases drop constraint %I', cname);
  end if;
end $$;

-- Replace with a region-aware unique index. COALESCE on set_code
-- and region so NULL on either column still enforces uniqueness
-- within the (tcg, '', language, '') / (tcg, code, language, '')
-- scope. A plain unique constraint on the four columns wouldn't
-- catch duplicates when either is NULL (PG default).

create unique index if not exists network_tcg_releases_unique_key
  on public.network_tcg_releases
  (tcg, coalesce(set_code, ''), language, coalesce(region, ''));

notify pgrst, 'reload schema';

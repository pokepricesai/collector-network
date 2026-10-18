-- =============================================================
-- PP-TCG-MIGRATE-05: cycle_date on cursor + mapping sample table
-- =============================================================

-- 1. Explicit cycle_date on the chunk ingestion cursor
--
-- Prior MIGRATE-04 inferred "same UTC day" from cycle_started_at.
-- An explicit column lets us assert the invariant in a single
-- comparison (cursor.cycle_date = today) without timezone edge
-- cases, and makes it visible in the admin panel.

alter table public.pokemon_tcg_ingestion_cursor
  add column if not exists cycle_date date;

-- Backfill: nothing to migrate (cursor is empty), but we set the
-- current row's cycle_date null → the next chunk run begins a new
-- cycle immediately with today's date, which is the right semantic.

-- 2. Mapping approval samples (persistence of §6 stratified picks)

create table if not exists public.pokemon_tcg_mapping_approval_samples (
  id                 uuid primary key default gen_random_uuid(),
  cohort             text not null,                       -- 'en-modern','vintage','jp','variant-1st-ed',...
  pp_card_slug       text not null,     -- plain text; join to pokemon_tcg_mappings.pp_card_slug on read
  checked_at         timestamptz not null default now(),
  checker            text,                                -- 'auto' | admin email
  passed             boolean,                             -- null = pending operator review
  reason             text,
  notes              text
);
create index if not exists pokemon_tcg_mapping_approval_samples_cohort_idx
  on public.pokemon_tcg_mapping_approval_samples (cohort, checked_at desc);

alter table public.pokemon_tcg_mapping_approval_samples enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_mapping_approval_samples') then
    create policy pokemon_tcg_mapping_approval_samples_admin on public.pokemon_tcg_mapping_approval_samples
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- End of migration. Zero touch on cards / card_trends / public URLs.

-- PP-TCG-CUTOVER-PREP-01 §3 — pilot cohort allowlist.
--
-- A GLOBAL feature flag (PP_USE_TCGGRAPH_PRICES, _IMAGES, _HISTORY)
-- must NEVER activate all 37,224 approved mappings. This allowlist
-- is the second gate: even with the env flag on, the public adapter
-- serves TCGGraph data only for pp_card_slugs listed here, and only
-- for the features explicitly enabled per slug.
--
-- Semantics:
--   • row absence → not in pilot, adapter returns null (legacy serves)
--   • prices_enabled: adapter can return market_prices + graded_prices
--     (still subject to effective_eligibility ≤ market_only/bulk_safe)
--   • images_enabled: adapter can return image_normal/image_large
--     (still subject to effective_eligibility ≤ identity_only)
--   • history_enabled: adapter can return historical series
--     (requires effective_eligibility bulk_safe)
--   • deactivated_at NOT NULL → effectively off
--
-- All features default to false. Explicit activation per feature.

set local search_path = public, extensions;

create table if not exists public.pokemon_tcg_pilot_cohort (
  id                     uuid primary key default gen_random_uuid(),
  pp_card_slug           text not null unique,
  prices_enabled         boolean not null default false,
  images_enabled         boolean not null default false,
  history_enabled        boolean not null default false,
  notes                  text,
  activated_at           timestamptz,
  deactivated_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists pokemon_tcg_pilot_cohort_active_idx
  on public.pokemon_tcg_pilot_cohort (pp_card_slug) where deactivated_at is null;

alter table public.pokemon_tcg_pilot_cohort enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_pilot_cohort') then
    create policy pokemon_tcg_pilot_cohort_admin on public.pokemon_tcg_pilot_cohort
      for all using (public.network_is_admin()) with check (public.network_is_admin());
    create policy pokemon_tcg_pilot_cohort_read_anon on public.pokemon_tcg_pilot_cohort
      for select using (true);
  end if;
end $$;

comment on table public.pokemon_tcg_pilot_cohort is
  'PP-TCG-CUTOVER-PREP-01. Allowlist of pp_card_slugs where the public '
  'adapter is permitted to serve TCGGraph data. Second gate after '
  'the global PP_USE_TCGGRAPH_* env flags. Row absence = not in pilot. '
  'All three features default to false; must be explicitly enabled per slug.';

-- Convenience view: active rows only
create or replace view public.v_pokemon_tcg_pilot_active as
select
  pp_card_slug,
  prices_enabled,
  images_enabled,
  history_enabled,
  notes,
  activated_at,
  created_at,
  updated_at
from public.pokemon_tcg_pilot_cohort
where deactivated_at is null;

grant select on public.v_pokemon_tcg_pilot_active to service_role, authenticated, anon;

comment on view public.v_pokemon_tcg_pilot_active is
  'Convenience view of active pilot cohort entries. Public read allowed '
  '(the slug list is not sensitive). Behaviour: Row present with '
  'feature_enabled=true + env flag + approved mapping + eligible '
  'effective_eligibility = adapter serves the feature.';

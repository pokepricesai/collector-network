-- =============================================================
-- PP-TCG-MIGRATE-04: ingestion cursor + FX rates
-- =============================================================
--
-- Admin-only tables. No touch on cards / card_trends / public
-- pricing.

-- 1. pokemon_tcg_ingestion_cursor ------------------------------
-- Resumable cursor for the chunked daily ingestion. One row per
-- (provider, kind) pair; the cron reads this, picks the next set
-- after `last_set_code`, upserts, advances the cursor. When the
-- cursor reaches the end of the catalogue for the day, state goes
-- 'completed_for_day' and the next day resets it to 'idle'.

create table if not exists public.pokemon_tcg_ingestion_cursor (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'tcggraph' check (provider in ('tcggraph','justtcg')),
  kind               text not null check (kind in ('daily_catalogue')),
  state              text not null default 'idle' check (state in ('idle','running','completed_for_day','failed')),
  last_set_code      text,
  last_language      text,
  cycle_started_at   timestamptz,
  cycle_completed_at timestamptz,
  cycle_credits_spent integer not null default 0,
  cycle_sets_processed integer not null default 0,
  cycle_cards_upserted integer not null default 0,
  updated_at         timestamptz not null default now(),
  unique (provider, kind)
);

alter table public.pokemon_tcg_ingestion_cursor enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_ingestion_cursor') then
    create policy pokemon_tcg_ingestion_cursor_admin on public.pokemon_tcg_ingestion_cursor
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- Seed the daily cursor row
insert into public.pokemon_tcg_ingestion_cursor (provider, kind, state)
values ('tcggraph', 'daily_catalogue', 'idle')
on conflict (provider, kind) do nothing;

-- 2. pokemon_tcg_fx_rates --------------------------------------
-- Daily FX snapshots. Pulled by a daily cron from a public source
-- (ECB-style; no API key required). Used by the currency-selector
-- display helper. We never TCGGraph-request on currency change —
-- all conversions happen from these cached rates.

create table if not exists public.pokemon_tcg_fx_rates (
  id                 uuid primary key default gen_random_uuid(),
  as_of              date not null,
  base               text not null,       -- 'USD' or 'EUR'
  quote              text not null,       -- 'USD' or 'EUR'
  rate               numeric(14,8) not null,
  source             text not null,
  fetched_at         timestamptz not null default now(),
  unique (as_of, base, quote)
);
create index if not exists pokemon_tcg_fx_rates_recent_idx
  on public.pokemon_tcg_fx_rates (as_of desc, base, quote);

alter table public.pokemon_tcg_fx_rates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_fx_rates') then
    -- FX rates are not sensitive — allow authenticated reads so the
    -- public read path can use them when the time comes. Writes
    -- remain admin-only.
    create policy pokemon_tcg_fx_rates_read on public.pokemon_tcg_fx_rates
      for select using (true);
    create policy pokemon_tcg_fx_rates_admin on public.pokemon_tcg_fx_rates
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- 3. Promo set grouping (admin-only metadata, not public SEO yet) --
-- Maps a TCGGraph specific promo-set code to its proposed public
-- display status. Phase 1: operator reviews proposals via the admin
-- analysis page. Phase 2 (next ticket): if approved, create public
-- routes.

create table if not exists public.pokemon_tcg_promo_set_proposals (
  id                 uuid primary key default gen_random_uuid(),
  tcg_set_code       text not null unique,
  tcg_set_name       text not null,
  tcg_language       text not null,
  pp_rows_mapped     integer not null default 0,       -- how many PP card_slugs would move under this set
  proposed_public_slug text,                           -- e.g. 'sv-black-star-promos'
  review_state       text not null default 'proposed'
                       check (review_state in ('proposed','approved','rejected','needs_more_data')),
  notes              text,
  created_at         timestamptz not null default now(),
  reviewed_at        timestamptz,
  reviewed_by        uuid references auth.users(id) on delete set null
);
create index if not exists pokemon_tcg_promo_proposals_state_idx
  on public.pokemon_tcg_promo_set_proposals (review_state, pp_rows_mapped desc);

alter table public.pokemon_tcg_promo_set_proposals enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_promo_set_proposals') then
    create policy pokemon_tcg_promo_proposals_admin on public.pokemon_tcg_promo_set_proposals
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- End of migration. Zero touch on cards / card_trends / sitemap /
-- any public pricing surface.

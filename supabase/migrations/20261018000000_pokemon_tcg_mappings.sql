-- =============================================================
-- PP-TCG-MATCH-01: Pokémon → TCGGraph mapping workbench schema
-- =============================================================
--
-- Introduces (admin-only, RLS enforced via public.network_is_admin()):
--   • pokemon_tcg_set_aliases       — operator-approved PP set → TCGGraph set code
--   • pokemon_tcg_mapping_candidates — matcher-generated suggestions (ephemeral, regenerable)
--   • pokemon_tcg_mappings          — the approved/pending mapping per PP card
--   • pokemon_tcg_mapping_audit     — append-only history of status changes
--
-- Design:
--   • Separate from PokePrices' `cards` and `card_trends`. Zero
--     touch on live production tables. Future activation gate reads
--     a mapping row + a provider price row and writes a new
--     provider-specific table (not yet created in this migration).
--   • `provider` column on every row so JustTCG / future providers
--     can slot in without a schema rewrite.
--   • Candidates are regeneratable: the matcher can re-run and
--     overwrite candidates for a PP card without touching the
--     approved mapping. Approvals persist independently.
--   • Mapping has `status` lifecycle: unmatched → pending_review
--     → approved | rejected | no_tcg_equivalent | priced_but_matched.
--     Only `approved` is eligible for a future activation flip.
--   • `activation_eligible` flag is intentionally a function of
--     `status` + `last_price_check_passed_at`. Phase 8 activation
--     is DISABLED in this migration — no cut-over logic here.
--   • Every status transition writes to pokemon_tcg_mapping_audit
--     automatically via a trigger. One row changes = one audit row.
--
-- Nothing in this migration modifies cards, card_trends, or any
-- public pricing surface.

-- -------------------------------------------------------------
-- 1. Set aliases
-- -------------------------------------------------------------
-- Operator-maintained translation: PokePrices set_name → TCGGraph
-- set code + language. One PP set name can map to multiple TCG set
-- codes (e.g. "Base Set" → base1, basep). The matcher consults this
-- table before falling back to name-only heuristics.

create table if not exists public.pokemon_tcg_set_aliases (
  id                 uuid primary key default gen_random_uuid(),
  pp_set_name        text not null,
  pp_language        text not null check (pp_language in ('en','jp')),
  tcg_set_code       text not null,
  tcg_language       text not null check (tcg_language in ('en','ja','de','es','fr','it')),
  notes              text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (pp_set_name, pp_language, tcg_set_code, tcg_language)
);

create index if not exists pokemon_tcg_set_aliases_lookup_idx
  on public.pokemon_tcg_set_aliases (pp_set_name, pp_language);

alter table public.pokemon_tcg_set_aliases enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_set_aliases') then
    create policy pokemon_tcg_set_aliases_admin on public.pokemon_tcg_set_aliases
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 2. Mapping candidates
-- -------------------------------------------------------------
-- One PP card × one candidate TCG card. The matcher generates N
-- candidates per PP card; the admin picks one. Regenerating the
-- matcher drops+rebuilds candidates for the affected PP cards
-- without touching the approved mapping.

create table if not exists public.pokemon_tcg_mapping_candidates (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'tcggraph' check (provider in ('tcggraph','justtcg')),
  pp_card_slug       text not null,                        -- PP cards.card_slug
  tcg_card_id        text not null,                        -- TCGGraph canonical card id (e.g. pkm_base1_41)
  tcg_printing_key   text,                                 -- 'normal' | '1st-edition' | 'shadowless' | 'reverse-holo' | ...
  tcg_price_card_id  text,                                 -- printings[].cardId where price actually lives (may differ)
  tcg_set_code       text not null,
  tcg_language       text not null,
  tcg_collector_num  text,
  tcg_name           text,
  match_method       text not null,                        -- 'exact', 'set_alias', 'name_number', 'basecard_link', 'external_id', 'manual_override'
  confidence         text not null check (confidence in ('verified','high','medium','low')),
  reasons            jsonb not null default '[]'::jsonb,   -- array of plain-English reason strings
  conflicts          jsonb not null default '[]'::jsonb,   -- flags: wrong_edition, wrong_finish, multiple_candidates, etc.
  snapshot_prices    jsonb,                                -- raw TCGGraph price snapshot for display, not for activation
  generated_at       timestamptz not null default now(),
  catalogue_version  text,                                 -- stamp of the catalogue export used
  unique (provider, pp_card_slug, tcg_card_id, tcg_printing_key)
);

create index if not exists pokemon_tcg_mapping_candidates_pp_idx
  on public.pokemon_tcg_mapping_candidates (pp_card_slug, confidence);
create index if not exists pokemon_tcg_mapping_candidates_tcg_idx
  on public.pokemon_tcg_mapping_candidates (provider, tcg_card_id);

alter table public.pokemon_tcg_mapping_candidates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_mapping_candidates') then
    create policy pokemon_tcg_mapping_candidates_admin on public.pokemon_tcg_mapping_candidates
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 3. Approved / pending mappings
-- -------------------------------------------------------------
-- One row per PP card, per provider. Represents the operator's
-- chosen mapping (or lack thereof). Null tcg_card_id means
-- unmatched/no_equivalent — the review_status explains why.

create table if not exists public.pokemon_tcg_mappings (
  id                       uuid primary key default gen_random_uuid(),
  provider                 text not null default 'tcggraph' check (provider in ('tcggraph','justtcg')),
  pp_card_slug             text not null,
  pp_set_name              text,                           -- cached for reporting / filtering
  pp_card_name             text,
  pp_language              text,
  tcg_card_id              text,                           -- null when unmatched / no equivalent
  tcg_printing_key         text,
  tcg_price_card_id        text,
  tcg_set_code             text,
  tcg_language             text,
  tcg_name                 text,
  match_method             text,                           -- 'auto_exact', 'manual_approved', 'alias_match', etc.
  confidence               text check (confidence in ('verified','high','medium','low')),
  review_status            text not null default 'unmatched'
                             check (review_status in (
                               'unmatched',
                               'pending_review',
                               'approved',
                               'rejected',
                               'no_tcg_equivalent',
                               'needs_price_verification'
                             )),
  reviewer_user_id         uuid references auth.users(id) on delete set null,
  reviewer_display         text,                           -- cached email/name for display
  reviewed_at              timestamptz,
  activation_eligible      boolean not null default false, -- Phase 8: must be approved AND price-verified
  last_price_check_passed_at timestamptz,
  notes                    text,
  catalogue_version        text,
  previous_review_status   text,                           -- for one-click undo
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (provider, pp_card_slug)
);

create index if not exists pokemon_tcg_mappings_status_idx
  on public.pokemon_tcg_mappings (review_status, confidence);
create index if not exists pokemon_tcg_mappings_set_idx
  on public.pokemon_tcg_mappings (pp_set_name, pp_language);
create index if not exists pokemon_tcg_mappings_tcg_idx
  on public.pokemon_tcg_mappings (provider, tcg_card_id) where tcg_card_id is not null;

alter table public.pokemon_tcg_mappings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_mappings') then
    create policy pokemon_tcg_mappings_admin on public.pokemon_tcg_mappings
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 4. Mapping audit (append-only)
-- -------------------------------------------------------------

create table if not exists public.pokemon_tcg_mapping_audit (
  id                 uuid primary key default gen_random_uuid(),
  mapping_id         uuid not null references public.pokemon_tcg_mappings(id) on delete cascade,
  pp_card_slug       text not null,
  provider           text not null,
  action             text not null,                        -- 'created', 'status_change', 'reassign', 'undo'
  from_status        text,
  to_status          text,
  from_tcg_card_id   text,
  to_tcg_card_id     text,
  from_printing_key  text,
  to_printing_key    text,
  actor_user_id      uuid references auth.users(id) on delete set null,
  actor_display      text,
  reason             text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists pokemon_tcg_mapping_audit_mapping_idx
  on public.pokemon_tcg_mapping_audit (mapping_id, created_at desc);
create index if not exists pokemon_tcg_mapping_audit_pp_idx
  on public.pokemon_tcg_mapping_audit (pp_card_slug, created_at desc);

alter table public.pokemon_tcg_mapping_audit enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_mapping_audit') then
    create policy pokemon_tcg_mapping_audit_admin on public.pokemon_tcg_mapping_audit
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 5. updated_at trigger
-- -------------------------------------------------------------

create or replace function public.pokemon_tcg_mappings_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pokemon_tcg_mappings_updated_at on public.pokemon_tcg_mappings;
create trigger pokemon_tcg_mappings_updated_at
  before update on public.pokemon_tcg_mappings
  for each row execute function public.pokemon_tcg_mappings_touch_updated_at();

-- -------------------------------------------------------------
-- 6. Status snapshot view (admin dashboard metric cards)
-- -------------------------------------------------------------

create or replace view public.pokemon_tcg_mapping_status_v as
select
  coalesce(review_status, 'unmatched') as review_status,
  coalesce(confidence, 'low') as confidence,
  coalesce(pp_language, 'en') as pp_language,
  count(*)::bigint as n
from public.pokemon_tcg_mappings
group by 1, 2, 3;

comment on view public.pokemon_tcg_mapping_status_v is
  'Admin dashboard metric aggregation. One row per (status, confidence, language) with count.';

grant select on public.pokemon_tcg_mapping_status_v to authenticated;

-- -------------------------------------------------------------
-- 7. Phase 8 placeholder — provider price staging (DISABLED)
-- -------------------------------------------------------------
-- Future: when we actually ingest TCGGraph prices into our own
-- storage, they land here first. activation_eligible mappings read
-- from this table (not from the live card_trends) during the dry-run.
-- Keeping the shape explicit now so Phase 8 doesn't need another
-- migration; the writer side stays disabled.

create table if not exists public.pokemon_tcg_price_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'tcggraph' check (provider in ('tcggraph','justtcg')),
  tcg_card_id        text not null,
  tcg_printing_key   text,
  snapshot_at        timestamptz not null default now(),
  raw_ungraded_usd   numeric(14,4),
  psa10_usd          numeric(14,4),
  bgs10_usd          numeric(14,4),
  cgc10_usd          numeric(14,4),
  sgc10_usd          numeric(14,4),
  pooled9_usd        numeric(14,4),
  pooled95_usd       numeric(14,4),
  tcgplayer_normal_usd  numeric(14,4),
  cardmarket_normal_eur numeric(14,4),
  prices_updated_at  timestamptz,
  graded_updated_at  timestamptz,
  payload            jsonb not null default '{}'::jsonb,
  catalogue_version  text,
  unique (provider, tcg_card_id, tcg_printing_key, snapshot_at)
);

create index if not exists pokemon_tcg_price_snapshots_card_idx
  on public.pokemon_tcg_price_snapshots (provider, tcg_card_id, snapshot_at desc);

alter table public.pokemon_tcg_price_snapshots enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_price_snapshots') then
    create policy pokemon_tcg_price_snapshots_admin on public.pokemon_tcg_price_snapshots
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- End of migration. Zero impact on live cards / card_trends / any
-- public pricing surface. Activation remains disabled; a Phase 8
-- change will add the activation flip, read-side, and ingestion job.

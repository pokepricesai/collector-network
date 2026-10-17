-- =============================================================
-- PP-TCG-MATCH-01A: safety + usability pass
-- =============================================================
--
-- Adds:
--   • pokemon_tcg_mappings.pricing_eligibility  — separates "card
--     identity verified" from "price applicability verified".
--   • pokemon_tcg_mappings.commercial_rank  — Google Search Console
--     90-day click rank, if the card appears in that export.
--   • pokemon_tcg_bulk_batches  — resumable progress record for
--     batched bulk-approval runs.
--
-- Nothing in this migration modifies cards, card_trends, or any
-- public pricing surface.

-- 1. pricing_eligibility --------------------------------------------
--
-- bulk_safe        : no PP [Variant] tag, tcg printing_key='normal',
--                    languages match, no promo-reprint markers, no
--                    duplicate PP-target clash. Safe to bulk-approve
--                    the mapping identity AND to use TCGGraph's
--                    aggregate raw/psa10 at Phase-8 activation.
--
-- market_only      : identity-safe (variant printing_key matches the
--                    PP tag), but graded prices are per-card
--                    aggregate — would misreport the variant.
--                    Approval of identity is OK; Phase-8 activation
--                    may only use per-finish TCGplayer/Cardmarket
--                    quotes for pricing. Never aggregate graded.
--
-- identity_only    : identity match is confirmed, but Phase-8 price
--                    activation is unsafe (variant tag with no TCG
--                    printing key, PP duplicate target clash, promo
--                    reprint marker, language mismatch). The admin
--                    may still approve the mapping identity for
--                    reporting/analytics, but the row will never
--                    become activation_eligible without manual
--                    override.
--
-- not_eligible     : unmatched / rejected / no_tcg_equivalent.
--
-- uncertain        : stamped by seed when matcher cannot classify
--                    yet. Fallback value for backfills.

alter table public.pokemon_tcg_mappings
  add column if not exists pricing_eligibility text
    check (pricing_eligibility in ('bulk_safe','market_only','identity_only','not_eligible','uncertain'))
    default 'uncertain';

create index if not exists pokemon_tcg_mappings_pricing_elig_idx
  on public.pokemon_tcg_mappings (pricing_eligibility, review_status);

comment on column public.pokemon_tcg_mappings.pricing_eligibility is
  'Phase-8 safety gate. Decouples card identity verification from '
  'the price applicability decision. Phase-8 activation reads this.';

-- 2. commercial_rank ------------------------------------------------

alter table public.pokemon_tcg_mappings
  add column if not exists commercial_rank integer;

create index if not exists pokemon_tcg_mappings_commercial_rank_idx
  on public.pokemon_tcg_mappings (commercial_rank asc nulls last)
  where commercial_rank is not null;

comment on column public.pokemon_tcg_mappings.commercial_rank is
  'GSC 90-day clicks rank for the PP card URL. 1 = most-clicked. '
  'NULL = no GSC data for this card. Used for manual-review sorting.';

-- 3. bulk-approval batches ------------------------------------------

create table if not exists public.pokemon_tcg_bulk_batches (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('bulk_approve')),
  pricing_eligibility text not null,
  pp_language        text,
  requested_by       uuid references auth.users(id) on delete set null,
  requested_by_email text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  state              text not null default 'running'
                       check (state in ('running','completed','failed','cancelled')),
  total_eligible     integer not null default 0,
  rows_approved      integer not null default 0,
  rows_skipped       integer not null default 0,
  last_checkpoint_at timestamptz,
  last_pp_slug       text,                    -- for resume continuation
  error_message      text,
  metadata           jsonb not null default '{}'::jsonb
);

create index if not exists pokemon_tcg_bulk_batches_state_idx
  on public.pokemon_tcg_bulk_batches (state, started_at desc);

alter table public.pokemon_tcg_bulk_batches enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_bulk_batches') then
    create policy pokemon_tcg_bulk_batches_admin on public.pokemon_tcg_bulk_batches
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

comment on table public.pokemon_tcg_bulk_batches is
  'Resumable record of bulk-approval runs. Each run processes rows '
  'in 500-row batches and updates last_pp_slug for continuation on '
  'timeout / disconnect.';

-- 4. updated_at trigger (ensure it fires for new columns) -----------
-- (Trigger already exists from the base migration; no changes.)

-- End of migration. Zero touch on cards / card_trends / public
-- pricing. Activation still disabled.

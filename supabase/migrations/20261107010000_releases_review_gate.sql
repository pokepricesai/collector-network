-- CN-06.06 corrections · Human approval gate.
--
-- The architecture review of PR #6/#7 flagged that automated
-- ingestion was treating third-party discovery as publisher
-- confirmation. This migration adds the review gate the brief
-- requires:
--
--   * Automated discovery → review_status='pending_review'
--     (invisible to the public feed)
--   * Operator approves → review_status='approved' (visible)
--   * Operator rejects → review_status='rejected' (invisible)
--   * Date change on an approved row → writes to a PROPOSED date
--     column, NOT release_date. Operator explicitly accepts the
--     change (promotes to release_date) or rejects it.
--
-- Also adds parent_release_id for grouping sub-products under a
-- primary release event (Scryfall's Star Trek = TRK expansion +
-- TRC Commander + SDS masterpiece — one calendar event, three
-- catalogue rows). Public view returns only primaries.

-- ─────────────────── review_status ───────────────────

alter table public.network_tcg_releases
  add column if not exists review_status text not null default 'pending_review';

alter table public.network_tcg_releases
  drop constraint if exists network_tcg_releases_review_status_check;

alter table public.network_tcg_releases
  add constraint network_tcg_releases_review_status_check
  check (review_status in ('pending_review','approved','rejected'));

create index if not exists network_tcg_releases_review_idx
  on public.network_tcg_releases (review_status, release_date);

-- ─────────────────── proposed_* (reviewable date change) ───

alter table public.network_tcg_releases
  add column if not exists proposed_release_date           date,
  add column if not exists proposed_release_date_precision text,
  add column if not exists proposed_change_at              timestamptz,
  add column if not exists proposed_change_source          text;

alter table public.network_tcg_releases
  drop constraint if exists network_tcg_releases_proposed_prec_check;
alter table public.network_tcg_releases
  add constraint network_tcg_releases_proposed_prec_check
  check (
    proposed_release_date_precision is null
    or proposed_release_date_precision in ('day','month','tbc')
  );

-- ─────────────────── parent_release_id (grouping) ───────────

alter table public.network_tcg_releases
  add column if not exists parent_release_id uuid
    references public.network_tcg_releases (id) on delete set null;

create index if not exists network_tcg_releases_parent_idx
  on public.network_tcg_releases (parent_release_id)
  where parent_release_id is not null;

-- Prevent self-parent loops. One row cannot be its own parent and
-- (at this depth of grouping) we don't need to support deeper
-- chains — a sub-product points directly at the primary.
alter table public.network_tcg_releases
  drop constraint if exists network_tcg_releases_no_self_parent;
alter table public.network_tcg_releases
  add constraint network_tcg_releases_no_self_parent
  check (parent_release_id is null or parent_release_id <> id);

-- ─────────────────── change-log: new change_type ─────────────

alter table public.network_tcg_release_changes
  drop constraint if exists network_tcg_release_changes_change_type_check;

alter table public.network_tcg_release_changes
  add constraint network_tcg_release_changes_change_type_check
  check (change_type in (
    'date_changed',
    'date_proposed',       -- ingester proposed a date shift on an approved row
    'date_accepted',       -- operator accepted a proposed shift
    'date_rejected',       -- operator rejected a proposed shift
    'status_changed',
    'source_updated',
    'readiness_action_created',
    'review_status_changed' -- operator approved / rejected a row
  ));

-- ─────────────────── public view: tighten filter ────────────

drop view if exists public.network_tcg_releases_public;

create view public.network_tcg_releases_public
with (security_invoker = false, security_barrier = true)
as
  select
    id,
    tcg,
    site_slug,
    set_name,
    set_name_translated,
    translation_official,
    set_code,
    product_type,
    language,
    region,
    release_date,
    release_date_precision,
    prerelease_date,
    confirmation_status,
    source_url,
    site_set_url,
    previous_release_date,
    date_changed_at,
    updated_at
  from public.network_tcg_releases
  where confirmation_status in ('confirmed', 'announced_tbc', 'postponed', 'released')
    and review_status = 'approved'
    and parent_release_id is null;

revoke all on public.network_tcg_releases_public from public;
grant select on public.network_tcg_releases_public to anon, authenticated;

comment on view public.network_tcg_releases_public is
  'CN-06.06 public release calendar. Shows only review_status=approved rows with public-safe confirmation_status AND only primary events (parent_release_id IS NULL). Pending / rejected rows and sub-products stay admin-only.';

-- Optional companion view: sub-products for a given primary. Not
-- in the public feed yet; the admin UI can use this to render
-- the grouped structure.
drop view if exists public.network_tcg_releases_subproducts;
create view public.network_tcg_releases_subproducts
with (security_invoker = false, security_barrier = true)
as
  select
    id,
    parent_release_id,
    tcg,
    set_name,
    set_code,
    product_type,
    language,
    release_date,
    release_date_precision,
    confirmation_status,
    source_url
  from public.network_tcg_releases
  where parent_release_id is not null
    and review_status = 'approved'
    and confirmation_status in ('confirmed', 'announced_tbc', 'postponed', 'released');

revoke all on public.network_tcg_releases_subproducts from public;
grant select on public.network_tcg_releases_subproducts to anon, authenticated;

notify pgrst, 'reload schema';

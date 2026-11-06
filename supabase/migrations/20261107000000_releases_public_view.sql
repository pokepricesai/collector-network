-- CN-06.06 · Public release calendar view.
--
-- Projects a safe subset of network_tcg_releases to anon/authenticated
-- so the Hub public feed (/api/public/releases/[tcg]) and any future
-- direct-Supabase reader can serve release data without exposing
-- operator-only columns (source_notes, source_verified_at,
-- verification_mode, metadata, created_by, updated_by, created_at).
--
-- Also filters to the public-safe confirmation statuses:
--   * confirmed      — publisher-confirmed date
--   * announced_tbc  — announced but date not final
--   * postponed      — date slipped (keep visible so sites can show
--                      the delay honestly)
--   * released       — date has passed
-- Excluded:
--   * rumoured   — not publisher-sourced, do not surface publicly
--   * cancelled  — would confuse readers; keep for internal audit only
--
-- Security model:
--   - Base table network_tcg_releases keeps its admin-only RLS. No
--     new policy is added there.
--   - The view uses `security_invoker = false` so it runs as the
--     view owner (migration runner, typically postgres). Anon reads
--     via the view bypass the base table's admin-only RLS, but ONLY
--     through the projected columns and the status filter below.
--   - security_barrier = true blocks side-channel column leaks via
--     lazy function evaluation (CVE-class defense-in-depth).
--   - GRANT is explicit: revoke all, then grant SELECT to anon +
--     authenticated. No INSERT/UPDATE/DELETE path through the view.

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
  where confirmation_status in ('confirmed', 'announced_tbc', 'postponed', 'released');

revoke all on public.network_tcg_releases_public from public;
grant select on public.network_tcg_releases_public to anon, authenticated;

comment on view public.network_tcg_releases_public is
  'CN-06.06 public release calendar projection. Anon-readable subset of network_tcg_releases, filtered to public-safe confirmation statuses and stripped of operator-only columns. Consumed by the Hub /api/public/releases/[tcg] feed.';

notify pgrst, 'reload schema';

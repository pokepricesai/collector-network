-- =============================================================
-- Phase 6 Checkpoint B.3 · Source health columns + enum value
-- =============================================================
-- The B.2 live test showed all 20 discovered signals came from a
-- single source. We need to see WHY the other sources contributed
-- zero — rate-limited, parse-failed, filtered to zero, or simply
-- no feed.
--
-- Also adds `listing_page` to the discovery_method enum so the
-- Konami / Yu-Gi-Oh! TCG official URLs can be read deterministically
-- by the new adapter. The data update that USES this new enum value
-- lives in the next migration (Postgres doesn't allow a newly-added
-- enum value to be used in the same transaction).

alter type public.network_autopilot_discovery_method add value if not exists 'listing_page';

do $$
begin
  alter table public.network_autopilot_sources
    add column if not exists last_error_at              timestamptz,
    add column if not exists last_error                 text,
    add column if not exists last_successful_fetch_at   timestamptz,
    add column if not exists last_signals_retained      integer,
    add column if not exists requires_game_filter       boolean not null default false;
end $$;

-- Tag the mixed-game feed so discovery only applies the YGO filter
-- where it's actually needed. YGO-dedicated feeds skip the filter.
update public.network_autopilot_sources
   set requires_game_filter = true
 where site_slug = 'ygo'
   and domain = 'infinite.tcgplayer.com';

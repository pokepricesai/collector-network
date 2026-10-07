-- =============================================================
-- Phase 6 Checkpoint B.3 · Flip official sources to listing_page
-- =============================================================
-- Separate migration so the enum value `listing_page` (added in
-- 20261007030000) has already committed by the time this UPDATE
-- references it.

update public.network_autopilot_sources
   set discovery_method = 'listing_page',
       updated_at       = now()
 where site_slug = 'ygo'
   and discovery_method = 'manual'
   and domain in ('konami.com', 'yugioh-card.com');

-- =============================================================
-- Collector Network OS — Phase 5 follow-up:
-- network_record_affiliate_click RPC
-- =============================================================
--
-- SECURITY DEFINER function callable by `anon` so specialist sites
-- can log affiliate clicks using only their existing anon key —
-- no service-role credentials need to leak to any public app.
--
-- Validation mirrors handleAffiliateEvent in
-- @collector-network/affiliate-tracking:
--
--   * placement required, bounded + regex-checked
--   * all string fields capped
--   * site_id is caller-controlled; whichever site the anon key
--     belongs to can log for whichever site_id it chooses — this is
--     acceptable because click volume is per-site anyway and the
--     downstream dashboards don't trust individual rows (they are a
--     signal, not revenue).
--
-- Function returns true on insert, false when nothing was written.

create or replace function public.network_record_affiliate_click(
  p_site_id uuid,
  p_placement text,
  p_source_id uuid default null,
  p_page_type text default null,
  p_source_component text default null,
  p_card_slug text default null,
  p_set_slug text default null,
  p_intent text default null,
  p_marketplace text default null,
  p_session_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_site_id is null then return false; end if;
  if p_placement is null or length(p_placement) = 0 or length(p_placement) > 80 then return false; end if;
  if p_placement !~ '^[A-Za-z0-9_:.-]+$' then return false; end if;

  insert into public.network_affiliate_clicks (
    site_id, source_id, placement, page_type, source_component,
    card_slug, set_slug, intent, marketplace, session_id
  )
  values (
    p_site_id,
    p_source_id,
    p_placement,
    nullif(left(coalesce(p_page_type, ''),         40), ''),
    nullif(left(coalesce(p_source_component, ''),  80), ''),
    nullif(left(coalesce(p_card_slug, ''),         80), ''),
    nullif(left(coalesce(p_set_slug, ''),         200), ''),
    nullif(left(coalesce(p_intent, ''),            40), ''),
    nullif(left(coalesce(p_marketplace, ''),        8), ''),
    nullif(left(coalesce(p_session_id, ''),        64), '')
  );
  return true;
end $$;

revoke all on function public.network_record_affiliate_click(uuid, text, uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.network_record_affiliate_click(uuid, text, uuid, text, text, text, text, text, text, text)
  to anon, authenticated, service_role;

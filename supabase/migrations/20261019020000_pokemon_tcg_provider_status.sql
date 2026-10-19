-- PP-TCG-PRINTING-RECLASS-FIX — non-destructive supersession state
-- for pokemon_tcg_provider_cards.
--
-- Problem: when TCGGraph changes a card's printing_key (e.g. a card
-- originally returned with key='normal' is now returned with
-- key='foil'), the chunk route's upsert creates a NEW row for the
-- new key and the OLD row stays with its old catalogue_version.
-- That old row is a reclassification orphan — the card still exists
-- but the printing_key does not.
--
-- This migration adds a non-destructive status column. Default:
-- 'active'. Operator-run reconciliation scripts may mark specific
-- rows 'superseded' when verified against a COMPLETE API response.
-- No rows are deleted; historical prices_market / prices_graded
-- rows remain intact.
--
-- Public adapters MUST filter by provider_status='active' for
-- current price and image reads. Matcher candidate generation
-- MUST filter by provider_status='active' when proposing new
-- mappings. Historical reads (price history, audit) must NOT
-- filter — the data is preserved pending the licensing decision.

set local search_path = public, extensions;

-- 1. Status column
alter table public.pokemon_tcg_provider_cards
  add column if not exists provider_status text not null default 'active'
    check (provider_status in ('active', 'superseded'));

-- 2. Supersession audit metadata (optional; populated only when
--    an operator script marks a row). Preserves evidence of WHY
--    it was superseded without touching the original row's
--    catalogue_version / ingested_at / raw_payload.
alter table public.pokemon_tcg_provider_cards
  add column if not exists superseded_at timestamptz;
alter table public.pokemon_tcg_provider_cards
  add column if not exists superseded_reason text;
alter table public.pokemon_tcg_provider_cards
  add column if not exists superseded_by_printing_key text;

-- 3. Index: adapters filter by (card_id, printing_key, status),
--    so include provider_status in the common lookup path.
create index if not exists pokemon_tcg_provider_cards_active_idx
  on public.pokemon_tcg_provider_cards (provider, tcg_card_id, tcg_printing_key)
  where provider_status = 'active';

-- 4. Convenience view: active rows only. Adapters MAY read from
--    this view instead of adding filters inline.
create or replace view public.v_pokemon_tcg_provider_cards_active as
select
  id, provider, tcg_card_id, tcg_printing_key, tcg_set_code, tcg_set_name,
  tcg_language, tcg_card_name, tcg_collector_number, tcg_rarity,
  base_card_id, english_id, image_small, image_normal, image_large,
  image_source, price_status, prices_updated_at, graded_updated_at,
  catalogue_version, ingested_at, raw_payload
from public.pokemon_tcg_provider_cards
where provider_status = 'active';

grant select on public.v_pokemon_tcg_provider_cards_active to service_role, authenticated, anon;

comment on column public.pokemon_tcg_provider_cards.provider_status is
  'PP-TCG-PRINTING-RECLASS-FIX. active (default) OR superseded. Only '
  'set to superseded when a complete, successful API response for the '
  'same (set, language) returns the same tcg_card_id with a DIFFERENT '
  'tcg_printing_key — strong evidence that this specific printing_key '
  'has been reclassified by TCGGraph. Never set superseded on evidence '
  'from a partial or failed response. The row and its historical prices '
  'are preserved; only new matches and public price reads filter it out.';

comment on view public.v_pokemon_tcg_provider_cards_active is
  'Filtered view used by the public card adapter and the matcher '
  'candidate generator. Hides rows marked superseded. Does NOT hide '
  'prices_market / prices_graded / price history — historical price '
  'data remains addressable by tcg_card_id (+ printing_key where '
  'applicable) regardless of status.';

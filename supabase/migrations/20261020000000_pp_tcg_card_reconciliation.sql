-- PP-TCG-MATCH-FINAL §1 — one-row-per-PP-card reconciliation view.
--
-- Reuses existing tables (no new storage). Admin workbench and
-- ad-hoc operator queries read from this view to see every PP card's
-- explicit outcome: identity status, printing status, pricing
-- eligibility, image availability, historical pricing, exact
-- exception reason.
--
-- Field-level semantics:
--   • `pp_*`           — the PokePrices source of truth (`cards` table)
--   • `tcg_*`          — the TCGGraph target the matcher chose
--   • `review_status`  — the identity approval state
--   • `risk_class`     — the QA classification
--   • `effective_eligibility` — the MOST RESTRICTIVE of (mapping, qa recommended),
--                               the authoritative value the public adapter uses
--   • `printing_active` — provider_status of the exact (card_id, printing_key)
--                         pair the mapping points at. If 'superseded', the
--                         public adapter fails closed.
--   • `has_image`, `has_market`, `has_graded`, `has_history` — booleans
--   • `outcome`        — single-word explicit disposition for the operator

set local search_path = public, extensions;

create or replace view public.v_pp_tcg_card_reconciliation as
select
  c.card_slug                                  as pp_card_slug,
  c.card_name                                  as pp_card_name,
  c.set_name                                   as pp_set_name,
  c.card_number                                as pp_card_number,
  c.language                                   as pp_language,
  case when c.card_name ~ '\[(.+?)\]' then substring(c.card_name from '\[(.+?)\]') else null end as pp_variant_tag,
  case when c.set_name is not null and c.card_url_slug is not null
       then 'https://www.pokeprices.io/set/' || replace(c.set_name, ' ', '%20') || '/card/' || c.card_url_slug
       else null end                           as pp_canonical_url,

  m.tcg_card_id,
  m.tcg_printing_key,
  m.tcg_set_code,
  m.tcg_language,
  m.tcg_name,
  m.confidence,
  m.review_status,
  m.pricing_eligibility                        as matcher_eligibility,
  q.risk_class,
  q.recommended_pricing_eligibility            as qa_recommended_eligibility,
  eff.effective_eligibility,

  pc.provider_status                           as printing_active_status,
  pc.image_normal is not null                  as has_image,
  pc.catalogue_version                         as printing_catalogue_version,

  -- Price/history availability (checked only when identity + printing are usable)
  exists(
    select 1 from public.pokemon_tcg_prices_market pm
     where pm.tcg_card_id = m.tcg_card_id
       and pm.tcg_printing_key = m.tcg_printing_key
       and pm.provider = 'tcggraph'
  )                                            as has_market_prices,
  exists(
    select 1 from public.pokemon_tcg_prices_graded pg
     where pg.tcg_card_id = m.tcg_card_id
       and pg.provider = 'tcggraph'
  )                                            as has_graded_prices,
  exists(
    select 1 from public.pokemon_tcg_prices_history ph
     where ph.tcg_card_id = m.tcg_card_id
       and ph.provider = 'tcggraph'
  )                                            as has_history,

  -- Explicit single-word outcome for the operator. Precedence top → bottom.
  case
    when m.tcg_card_id is null and m.review_status = 'no_tcg_equivalent' then 'no_tcg_equivalent'
    when m.tcg_card_id is null and m.review_status = 'unmatched'         then 'unmatched'
    when pc.provider_status = 'superseded'                               then 'printing_superseded'
    when q.risk_class = 'ambiguous_variant'                              then 'ambiguous_variant'
    when q.risk_class = 'conflicting_identity'                           then 'conflicting_identity'
    when q.risk_class = 'unverifiable'                                   then 'unverifiable'
    when m.review_status = 'approved' and q.risk_class in ('catalogue_corroborated','internally_consistent','pricing_restriction') then 'approved_active'
    when m.review_status = 'pending_review' and q.risk_class in ('catalogue_corroborated','internally_consistent','pricing_restriction') then 'identity_safe_pending_review'
    else 'other'
  end                                          as outcome,

  m.commercial_rank                            as gsc_rank
from public.cards c
left join public.pokemon_tcg_mappings m
  on m.pp_card_slug = c.card_slug and m.provider = 'tcggraph'
left join public.pokemon_tcg_mapping_qa q
  on q.mapping_id = m.id
left join public.pokemon_tcg_provider_cards pc
  on pc.provider = 'tcggraph'
     and pc.tcg_card_id = m.tcg_card_id
     and pc.tcg_printing_key = m.tcg_printing_key
left join public.v_pokemon_tcg_effective_eligibility eff
  on eff.mapping_id = m.id
where c.is_sealed is not true;

grant select on public.v_pp_tcg_card_reconciliation to service_role, authenticated, anon;

comment on view public.v_pp_tcg_card_reconciliation is
  'PP-TCG-MATCH-FINAL §1 reconciliation. One row per non-sealed PP card. '
  'Operator queries this view (or the admin workbench, which reads from it) '
  'to see every card''s explicit outcome: identity status, printing status, '
  'pricing eligibility, image, market, graded, history availability. The '
  '`outcome` column is a single-word disposition suitable for grouping. '
  'Historical price data is preserved in the underlying tables regardless of '
  'how the view classifies the row.';

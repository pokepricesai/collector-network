-- PP-TCG-MATCH: helper views for operator bulk approval.
--
-- v_pokemon_tcg_bulk_approve_candidates returns ONLY mappings
-- classified verified_independent AND whose recommendation
-- matches the matcher's assignment (no silent eligibility change).
-- The operator can scope the bulk-approval batch to this view.
--
-- v_pokemon_tcg_pricing_eligibility_corrections returns mappings
-- whose recommendation differs from their current assignment —
-- the operator reviews and applies these as a separate, explicit
-- step before approving.

create or replace view public.v_pokemon_tcg_bulk_approve_candidates as
select
  m.id          as mapping_id,
  m.pp_card_slug,
  m.tcg_card_id,
  m.tcg_printing_key,
  m.pricing_eligibility,
  q.has_tcgplayer_ref,
  q.has_cardmarket_ref
from public.pokemon_tcg_mappings m
join public.pokemon_tcg_mapping_qa q on q.mapping_id = m.id
where q.risk_class = 'verified_independent'
  and m.review_status in ('pending_review', 'unmatched')
  and m.confidence = 'verified'
  and q.recommended_pricing_eligibility = m.pricing_eligibility;

create or replace view public.v_pokemon_tcg_pricing_eligibility_corrections as
select
  m.id             as mapping_id,
  m.pp_card_slug,
  m.pp_card_name,
  m.tcg_card_id,
  m.tcg_printing_key,
  m.pricing_eligibility      as current_eligibility,
  q.recommended_pricing_eligibility as recommended_eligibility,
  q.risk_class,
  q.sibling_printings,
  q.warnings
from public.pokemon_tcg_mappings m
join public.pokemon_tcg_mapping_qa q on q.mapping_id = m.id
where q.recommended_pricing_eligibility is not null
  and q.recommended_pricing_eligibility <> coalesce(m.pricing_eligibility, 'uncertain');

grant select on public.v_pokemon_tcg_bulk_approve_candidates to service_role;
grant select on public.v_pokemon_tcg_pricing_eligibility_corrections to service_role;

comment on view public.v_pokemon_tcg_bulk_approve_candidates is
  'PP-TCG-MATCH: the subset of mappings that passed QA with risk_class=verified_independent '
  'AND the QA agrees with the matcher''s pricing_eligibility. Safe for an operator-authorised '
  'bulk approval. Does NOT include mappings whose eligibility needs correction (see corrections view).';

comment on view public.v_pokemon_tcg_pricing_eligibility_corrections is
  'PP-TCG-MATCH: mappings whose recommended_pricing_eligibility differs from the current '
  'assignment. Operator reviews and applies as an explicit step before bulk approval.';

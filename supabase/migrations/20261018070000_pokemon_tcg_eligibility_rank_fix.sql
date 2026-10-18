-- PP-TCG-QA-FINAL §3 — fix precedence so uncertain is treated as
-- the MOST restrictive, not the least.
--
-- Original ranking placed uncertain=0 (least restrictive). The LEAST(a,b)
-- picked uncertain over bulk_safe, which was fine coincidentally
-- (both inputs the same) but semantically backwards: uncertain means
-- "we don't know whether this is safe", which should default to the
-- SAFEST (highest-restriction) display mode. Fix: uncertain = 5, higher
-- than not_eligible, so any uncertain input dominates.

set local search_path = public, extensions;

create or replace function public.pokemon_tcg_eligibility_rank(e text)
returns integer language sql immutable as $$
  select case e
    when 'uncertain'      then 5     -- treat unknown as MORE restrictive than not_eligible
    when 'not_eligible'   then 4
    when 'identity_only'  then 3
    when 'market_only'    then 2
    when 'bulk_safe'      then 1
    else 5                            -- NULL/unexpected → safest
  end;
$$;

-- Rewrite the effective view with explicit null-safety and
-- "default to most restrictive" semantics.
create or replace view public.v_pokemon_tcg_effective_eligibility as
select
  m.id                        as mapping_id,
  m.provider,
  m.pp_card_slug,
  m.tcg_card_id,
  m.tcg_printing_key,
  m.review_status,
  m.pricing_eligibility       as matcher_eligibility,
  q.recommended_pricing_eligibility as qa_recommended_eligibility,
  q.risk_class,
  case
    when q.recommended_pricing_eligibility is null and m.pricing_eligibility is null
      then 'uncertain'::text
    when q.recommended_pricing_eligibility is null
      then m.pricing_eligibility
    when m.pricing_eligibility is null
      then q.recommended_pricing_eligibility
    when public.pokemon_tcg_eligibility_rank(q.recommended_pricing_eligibility)
       >= public.pokemon_tcg_eligibility_rank(m.pricing_eligibility)
      then q.recommended_pricing_eligibility
    else m.pricing_eligibility
  end                          as effective_eligibility
from public.pokemon_tcg_mappings m
left join public.pokemon_tcg_mapping_qa q on q.mapping_id = m.id;

grant select on public.v_pokemon_tcg_effective_eligibility to service_role;

comment on view public.v_pokemon_tcg_effective_eligibility is
  'PP-TCG-MATCH / QA-FINAL safety view. Returns the MOST RESTRICTIVE of '
  '(mappings.pricing_eligibility, pokemon_tcg_mapping_qa.recommended_pricing_eligibility). '
  'The public provider adapter MUST read eligibility through this view and must '
  'FAIL CLOSED (treat as not_eligible / return null snapshot) if the view read '
  'fails, returns no row, or returns a null effective value. Precedence: '
  'uncertain > not_eligible > identity_only > market_only > bulk_safe.';

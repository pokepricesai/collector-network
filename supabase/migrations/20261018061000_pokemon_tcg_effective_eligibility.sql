-- PP-TCG-MATCH §6 — safety net so the public provider adapter
-- cannot use a stale bulk_safe assignment when the QA pass has
-- recommended a stricter eligibility.
--
-- `pokemon_tcg_mappings.pricing_eligibility` is a WRITABLE column
-- the matcher assigns at mapping time. The QA pass computed a
-- `recommended_pricing_eligibility` which may be strictly tighter
-- (bulk_safe → market_only, bulk_safe → identity_only). Until the
-- correction is applied, the two columns can disagree.
--
-- `v_pokemon_tcg_effective_eligibility` always returns the MOST
-- RESTRICTIVE of (current, QA recommendation). The public provider
-- adapter is required to read eligibility through this view, not
-- the raw mapping column. This defends against:
--   - a mapping-approval step that forgets to apply the correction
--   - a future matcher run that re-assigns bulk_safe without an
--     accompanying QA re-run
--   - a stale cache / unseen migration

set local search_path = public, extensions;

-- Precedence (most restrictive → least restrictive)
--   not_eligible  >  identity_only  >  market_only  >  bulk_safe  >  uncertain
--
-- `uncertain` is treated as least-restrictive sentinel; it must
-- never satisfy a bulk display check — the adapter is expected to
-- treat `uncertain` as `identity_only` at read time. Encoded in the
-- rank function below.

create or replace function public.pokemon_tcg_eligibility_rank(e text)
returns integer language sql immutable as $$
  select case e
    when 'not_eligible'   then 4
    when 'identity_only'  then 3
    when 'market_only'    then 2
    when 'bulk_safe'      then 1
    when 'uncertain'      then 0
    else 0
  end;
$$;

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
  -- The effective eligibility used by the public adapter: the MORE
  -- RESTRICTIVE of (matcher, QA recommendation).
  case
    when q.recommended_pricing_eligibility is null then m.pricing_eligibility
    when public.pokemon_tcg_eligibility_rank(q.recommended_pricing_eligibility)
       > public.pokemon_tcg_eligibility_rank(m.pricing_eligibility)
      then q.recommended_pricing_eligibility
    else m.pricing_eligibility
  end                          as effective_eligibility
from public.pokemon_tcg_mappings m
left join public.pokemon_tcg_mapping_qa q on q.mapping_id = m.id;

grant select on public.v_pokemon_tcg_effective_eligibility to service_role;

comment on view public.v_pokemon_tcg_effective_eligibility is
  'PP-TCG-MATCH safety net. Returns the most restrictive of '
  '(mappings.pricing_eligibility, pokemon_tcg_mapping_qa.recommended_pricing_eligibility). '
  'The public provider adapter MUST read eligibility through this view so a stale '
  'bulk_safe assignment cannot be used when the QA has flagged a printing-contamination '
  'risk. Precedence (most → least restrictive): not_eligible > identity_only > market_only '
  '> bulk_safe > uncertain.';

-- Rebuild the correction views (dropped by rename migration) using
-- the new class name.
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
where q.risk_class = 'catalogue_corroborated'
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

-- The identity-safe cohort = catalogue_corroborated + pricing_restriction
-- + internally_consistent. These are all mappings whose identity we
-- consider correct; pricing eligibility is handled separately via
-- the QA recommendation.
create or replace view public.v_pokemon_tcg_identity_safe_cohort as
select
  m.id             as mapping_id,
  m.pp_card_slug,
  m.pp_card_name,
  m.tcg_card_id,
  m.tcg_printing_key,
  m.pricing_eligibility      as matcher_eligibility,
  q.recommended_pricing_eligibility as recommended_eligibility,
  q.risk_class
from public.pokemon_tcg_mappings m
join public.pokemon_tcg_mapping_qa q on q.mapping_id = m.id
where q.risk_class in (
    'catalogue_corroborated',
    'internally_consistent',
    'pricing_restriction'
  )
  and m.review_status in ('pending_review', 'unmatched')
  and m.confidence = 'verified';

grant select on public.v_pokemon_tcg_identity_safe_cohort to service_role;

comment on view public.v_pokemon_tcg_identity_safe_cohort is
  'The mappings whose IDENTITY is confirmed by automated QA — safe to '
  'approve as a mapping (review_status=approved). This is NOT the same '
  'as "safe for aggregate graded pricing" — that is governed by '
  'v_pokemon_tcg_effective_eligibility. Approving a mapping and ENABLING '
  'bulk pricing are two independent operator decisions.';

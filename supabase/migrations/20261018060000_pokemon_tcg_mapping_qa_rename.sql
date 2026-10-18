-- PP-TCG-MATCH reconciliation — rename risk class so the label
-- doesn't overclaim independence.
--
-- 'verified_independent' suggested cross-reference against a
-- catalogue external to TCGGraph. In reality the signal we use —
-- TCGplayer / Cardmarket external IDs on each printing — lives
-- INSIDE TCGGraph's provider response. It is CORROBORATION
-- (the printing is also listable at a major third-party
-- marketplace catalogue) not INDEPENDENT VERIFICATION
-- (an external catalogue agrees name/number/set/release).
--
-- Renaming to `catalogue_corroborated` makes the semantics
-- explicit.

set local search_path = public, extensions;

-- Drop the dependent views first (they reference risk_class values)
drop view if exists public.v_pokemon_tcg_bulk_approve_candidates;
drop view if exists public.v_pokemon_tcg_pricing_eligibility_corrections;

-- Rewrite the check constraint and backfill existing rows
alter table public.pokemon_tcg_mapping_qa
  drop constraint if exists pokemon_tcg_mapping_qa_risk_class_check;

update public.pokemon_tcg_mapping_qa
  set risk_class = 'catalogue_corroborated'
  where risk_class = 'verified_independent';

alter table public.pokemon_tcg_mapping_qa
  add constraint pokemon_tcg_mapping_qa_risk_class_check
  check (risk_class in (
    'catalogue_corroborated',
    'internally_consistent',
    'ambiguous_variant',
    'conflicting_identity',
    'pricing_restriction',
    'unverifiable'
  ));

comment on column public.pokemon_tcg_mapping_qa.risk_class is
  'Six operator-defined classes. catalogue_corroborated (previously '
  'verified_independent) means the mapping passed all internal checks '
  'AND the printing has a reference in a third-party marketplace '
  'catalogue (TCGplayer or Cardmarket external ID). This is '
  'CORROBORATION, not independent catalogue verification — the external '
  'IDs live inside TCGGraph''s own response.';

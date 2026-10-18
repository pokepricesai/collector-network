-- PP-TCG-QA-FINAL §3 refinement — tie uncertain and not_eligible at
-- rank 4. Both block ALL display at the adapter (canReturnMarket,
-- canReturnGraded, canReturnImages = false for both). Treating them
-- as the same rank means the effective-eligibility view can accept
-- either as a valid quarantine state without preferring one.
--
-- This also lets the correction-apply guard treat `uncertain → not_eligible`
-- as a same-rank re-categorisation (allowed) rather than a less-restrictive
-- change (blocked).

set local search_path = public, extensions;

create or replace function public.pokemon_tcg_eligibility_rank(e text)
returns integer language sql immutable as $$
  select case e
    when 'uncertain'      then 4    -- tied with not_eligible — both block display
    when 'not_eligible'   then 4
    when 'identity_only'  then 3
    when 'market_only'    then 2
    when 'bulk_safe'      then 1
    else 4                           -- NULL / unexpected → quarantine
  end;
$$;

comment on function public.pokemon_tcg_eligibility_rank is
  'Precedence: {uncertain, not_eligible}=4 (block display) > identity_only=3 '
  '(image only) > market_only=2 (image + prices, no graded aggregate) > '
  'bulk_safe=1 (all display). Higher is more restrictive. The effective '
  'view uses >= so when ranks tie, qa.recommended wins — the audited '
  'intent takes priority over the matcher assignment.';

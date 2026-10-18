-- PP-TCG-MATCH: automated QA for mapping candidates.
--
-- Problem being solved. The pricing_eligibility flag on
-- pokemon_tcg_mappings answers "can we show card-level graded
-- values for this card?" at the matcher level, but it does NOT
-- consider the SIBLING-printing contamination problem. If a TCG
-- card has multiple printings (e.g. normal + reverse-holo +
-- pokemon-center), the TCGGraph graded_prices feed aggregates
-- sales across ALL printings into the SAME card-level row.
-- Applying that aggregate to any specific printing (including the
-- "normal" one) introduces price bias.
--
-- This table stores the result of a comprehensive automated QA
-- pass over every mapping — one row per mapping — with:
--   • a risk class (6 operator-defined classes)
--   • the deterministic checks that passed/failed
--   • independent-evidence pointers (external marketplace IDs)
--   • a derived recommended pricing_eligibility correction
--
-- The operator reviews the SMALL residual (ambiguous / conflicting
-- / pricing_restriction) and explicitly approves the clean cohort
-- in one action. No autopromotion.

set local search_path = public, extensions;

create table if not exists public.pokemon_tcg_mapping_qa (
  id                        uuid primary key default gen_random_uuid(),
  mapping_id                uuid references public.pokemon_tcg_mappings(id) on delete cascade,
  pp_card_slug              text not null,
  tcg_card_id               text,
  tcg_printing_key          text,
  -- 6 operator-defined classes:
  --   verified_independent    — all internal checks pass + has independent marketplace reference
  --   internally_consistent   — all internal checks pass, no independent corroboration
  --   ambiguous_variant       — multiple PP rows mapped to same tcg_card_id with different printings (one of them is a variant missed)
  --   conflicting_identity    — name/number/set/language mismatch between PP and TCG
  --   pricing_restriction     — identity OK but graded-aggregate is unsafe (multi-printing on the TCG card) → recommend market_only
  --   unverifiable            — no tcg_card_id, orphan, or insufficient data
  risk_class                text not null
                              check (risk_class in (
                                'verified_independent',
                                'internally_consistent',
                                'ambiguous_variant',
                                'conflicting_identity',
                                'pricing_restriction',
                                'unverifiable'
                              )),
  -- Pre-existing bulk_safe/market_only/identity_only/not_eligible/uncertain assignment at QA time
  prior_pricing_eligibility text,
  -- Derived recommendation after accounting for printing-contamination risk
  recommended_pricing_eligibility text,
  -- Independent corroboration — true if the chosen printing has an external marketplace ID
  has_tcgplayer_ref         boolean not null default false,
  has_cardmarket_ref        boolean not null default false,
  -- Deterministic check results (false = failed)
  name_exact_match          boolean not null default false,
  number_exact_match        boolean not null default false,
  set_match                 boolean not null default false,
  language_match            boolean not null default false,
  image_available           boolean not null default false,
  market_price_available    boolean not null default false,
  single_printing           boolean not null default false,
  -- Context for the operator review surface
  sibling_printings         jsonb,       -- array of printing_keys available on the TCG card
  evidence                  jsonb,       -- detailed per-check evidence (what PP says vs what TCG says)
  warnings                  jsonb,       -- array of human-readable warning strings
  -- When did we last audit this mapping?
  audited_at                timestamptz not null default now(),
  audit_version             text not null default 'v1',
  unique (mapping_id)
);

create index if not exists pokemon_tcg_mapping_qa_class_idx
  on public.pokemon_tcg_mapping_qa (risk_class, audit_version);
create index if not exists pokemon_tcg_mapping_qa_rec_idx
  on public.pokemon_tcg_mapping_qa (recommended_pricing_eligibility);
create index if not exists pokemon_tcg_mapping_qa_slug_idx
  on public.pokemon_tcg_mapping_qa (pp_card_slug);

alter table public.pokemon_tcg_mapping_qa enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_mapping_qa') then
    create policy pokemon_tcg_mapping_qa_admin on public.pokemon_tcg_mapping_qa
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

comment on table public.pokemon_tcg_mapping_qa is
  'PP-TCG-MATCH: per-mapping automated QA results. '
  'The matcher proposes a mapping with a pricing_eligibility label; '
  'the QA pass validates that label against name/number/set/language/'
  'image/market/printing-contamination checks and produces a '
  'recommended_pricing_eligibility the operator can accept in bulk.';

comment on column public.pokemon_tcg_mapping_qa.risk_class is
  '6 classes. verified_independent + internally_consistent are safe to bulk approve. '
  'ambiguous_variant / conflicting_identity / pricing_restriction / unverifiable '
  'require operator review.';

comment on column public.pokemon_tcg_mapping_qa.single_printing is
  'True when the TCG card has exactly one printing. Multi-printing '
  'cards are NOT safe for card-level graded aggregates because the '
  'TCGGraph graded_prices feed is keyed by (card_id, grader, grade) '
  'with NO printing dimension — the aggregate is contaminated across '
  'reverse-holo / pokemon-center / prize-pack siblings.';

-- PP-TCG-QA-FINAL §4 — audited, transactional, resumable corrections.
--
-- Design:
--   • pokemon_tcg_qa_correction_runs tracks the batch itself.
--     run_id is persisted BEFORE any writes. Status flips to
--     'completed' or 'failed' when the function returns.
--   • apply_pokemon_tcg_qa_correction_batch(run_id, batch_size)
--     processes up to `batch_size` corrections per call, inside
--     a single implicit transaction (plpgsql function = txn).
--     On error it rolls back (plpgsql semantics) and the run row
--     stays 'in_progress' — safe to call again.
--   • Audit insert happens in the same transaction as the UPDATE.
--     Impossible to leave the mapping changed without an audit row.
--   • Each correction is tagged with the run_id in audit.metadata.
--     Reverting = SELECT from audit WHERE run_id=X and apply
--     metadata->>'from_eligibility' back onto mapping.

set local search_path = public, extensions;

create table if not exists public.pokemon_tcg_qa_correction_runs (
  id                       uuid primary key default gen_random_uuid(),
  run_id                   text not null unique,
  status                   text not null check (status in ('in_progress', 'completed', 'failed')),
  started_at               timestamptz not null default now(),
  completed_at             timestamptz,
  corrections_total        integer not null default 0,
  corrections_applied      integer not null default 0,
  initiated_by             text,
  dry_run_snapshot         jsonb,
  error_detail             text
);

alter table public.pokemon_tcg_qa_correction_runs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_qa_correction_runs') then
    create policy pokemon_tcg_qa_correction_runs_admin on public.pokemon_tcg_qa_correction_runs
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- Resumable batch processor. Called repeatedly by the script until
-- it reports `remaining=0`. Each call processes `p_batch_size`
-- corrections in a single transaction.
create or replace function public.apply_pokemon_tcg_qa_correction_batch(
  p_run_id text,
  p_batch_size integer default 500
)
returns table (
  applied integer,
  remaining integer
)
language plpgsql
security definer
as $$
declare
  v_run_row public.pokemon_tcg_qa_correction_runs%rowtype;
  v_applied integer := 0;
  v_remaining integer := 0;
begin
  -- Ensure the run exists and is in_progress
  select * into v_run_row from public.pokemon_tcg_qa_correction_runs
    where run_id = p_run_id for update;
  if not found then
    raise exception 'run_id % not registered — call pokemon_tcg_qa_correction_runs INSERT first', p_run_id;
  end if;
  if v_run_row.status <> 'in_progress' then
    raise exception 'run_id % is %, not in_progress — refuse to apply', p_run_id, v_run_row.status;
  end if;

  -- Pick corrections that have NOT yet been audited under this run_id.
  -- The audit log is the source of truth for "applied".
  with to_apply as (
    select
      v.mapping_id,
      v.current_eligibility,
      v.recommended_eligibility,
      v.risk_class,
      v.pp_card_slug
    from public.v_pokemon_tcg_pricing_eligibility_corrections v
    where not exists (
      select 1 from public.pokemon_tcg_mapping_audit a
      where a.mapping_id = v.mapping_id
        and a.action = 'qa_eligibility_correction'
        and a.metadata->>'run_id' = p_run_id
    )
    limit p_batch_size
  ),
  updated as (
    update public.pokemon_tcg_mappings m
      set pricing_eligibility = ta.recommended_eligibility,
          updated_at = now()
      from to_apply ta
     where m.id = ta.mapping_id
    returning m.id, ta.current_eligibility, ta.recommended_eligibility, ta.risk_class, ta.pp_card_slug
  ),
  inserted_audit as (
    insert into public.pokemon_tcg_mapping_audit (
      mapping_id, pp_card_slug, provider, action, reason, actor_display, metadata
    )
    select
      u.id,
      u.pp_card_slug,
      'tcggraph',
      'qa_eligibility_correction',
      coalesce(u.current_eligibility, 'null') || ' → ' || coalesce(u.recommended_eligibility, 'null') || ' · risk=' || u.risk_class,
      'rpc:apply_pokemon_tcg_qa_correction_batch',
      jsonb_build_object(
        'run_id', p_run_id,
        'from_eligibility', u.current_eligibility,
        'to_eligibility', u.recommended_eligibility,
        'risk_class', u.risk_class
      )
    from updated u
    returning 1
  )
  select count(*) into v_applied from inserted_audit;

  -- Count remaining
  select count(*) into v_remaining
    from public.v_pokemon_tcg_pricing_eligibility_corrections v
    where not exists (
      select 1 from public.pokemon_tcg_mapping_audit a
      where a.mapping_id = v.mapping_id
        and a.action = 'qa_eligibility_correction'
        and a.metadata->>'run_id' = p_run_id
    );

  -- Update run progress
  update public.pokemon_tcg_qa_correction_runs
    set corrections_applied = corrections_applied + v_applied
   where run_id = p_run_id;

  if v_remaining = 0 then
    update public.pokemon_tcg_qa_correction_runs
      set status = 'completed', completed_at = now()
     where run_id = p_run_id;
  end if;

  return query select v_applied, v_remaining;
end;
$$;

comment on function public.apply_pokemon_tcg_qa_correction_batch is
  'PP-TCG-QA-FINAL §4. Processes one batch of pricing_eligibility corrections '
  'per call inside a single transaction. UPDATE + audit INSERT atomic — '
  'impossible to leave a mapping changed without an audit row. Idempotent + '
  'resumable: picks corrections that have no audit row for the given run_id, '
  'so re-running after a failure continues where it left off. Returns '
  '(applied, remaining); caller loops until remaining=0.';

grant execute on function public.apply_pokemon_tcg_qa_correction_batch to service_role;

-- Rollback function — reverses all mapping writes for a given run_id.
-- Writes new audit rows for the rollback so the trail is bidirectional.
create or replace function public.rollback_pokemon_tcg_qa_correction_run(
  p_run_id text
)
returns integer
language plpgsql
security definer
as $$
declare
  v_rolled_back integer := 0;
begin
  with rollback_targets as (
    select
      a.mapping_id,
      a.pp_card_slug,
      a.metadata->>'from_eligibility' as prior,
      a.metadata->>'to_eligibility'   as applied,
      a.metadata->>'risk_class'       as risk_class
    from public.pokemon_tcg_mapping_audit a
    where a.action = 'qa_eligibility_correction'
      and a.metadata->>'run_id' = p_run_id
      -- only roll back the LATEST qa correction for this (mapping, run)
      -- (should always be a single row — audit is append-only)
  ),
  reverted as (
    update public.pokemon_tcg_mappings m
      set pricing_eligibility = rt.prior,
          updated_at = now()
      from rollback_targets rt
     where m.id = rt.mapping_id
     returning m.id, rt.pp_card_slug, rt.prior, rt.applied, rt.risk_class
  ),
  rollback_audit as (
    insert into public.pokemon_tcg_mapping_audit (
      mapping_id, pp_card_slug, provider, action, reason, actor_display, metadata
    )
    select
      r.id, r.pp_card_slug, 'tcggraph',
      'qa_eligibility_correction_rollback',
      coalesce(r.applied, 'null') || ' → ' || coalesce(r.prior, 'null') || ' (rollback of run ' || p_run_id || ')',
      'rpc:rollback_pokemon_tcg_qa_correction_run',
      jsonb_build_object(
        'rollback_of_run_id', p_run_id,
        'from_eligibility', r.applied,
        'to_eligibility', r.prior,
        'risk_class', r.risk_class
      )
    from reverted r
    returning 1
  )
  select count(*) into v_rolled_back from rollback_audit;

  update public.pokemon_tcg_qa_correction_runs
    set status = 'failed', error_detail = 'rolled back at ' || now()::text
   where run_id = p_run_id;

  return v_rolled_back;
end;
$$;

grant execute on function public.rollback_pokemon_tcg_qa_correction_run to service_role;

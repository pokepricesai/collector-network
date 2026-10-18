-- PP-TCG-APPROVAL — audited, transactional, resumable identity
-- approval. Mirrors the correction-run infrastructure (migration
-- 20261018080000) but writes review_status='approved' instead of
-- pricing_eligibility, scoped strictly to v_pokemon_tcg_identity_safe_cohort.
--
-- Design parity:
--   • pokemon_tcg_identity_approval_runs persists run_id BEFORE writes
--   • apply_pokemon_tcg_identity_approval_batch RPC = 1 txn per batch
--     — UPDATE + audit INSERT atomic
--   • Resumable: picks mappings in the cohort view that don't yet
--     have an audit row for this run_id
--   • Rollback: reverses review_status back to pending_review
--
-- Approval is INDEPENDENT of pricing_eligibility — approving a mapping
-- confirms identity. Pricing visibility remains governed by the
-- effective-eligibility view and the public PP_USE_TCGGRAPH_* flags.

set local search_path = public, extensions;

create table if not exists public.pokemon_tcg_identity_approval_runs (
  id                       uuid primary key default gen_random_uuid(),
  run_id                   text not null unique,
  status                   text not null check (status in ('in_progress', 'completed', 'failed')),
  started_at               timestamptz not null default now(),
  completed_at             timestamptz,
  approvals_total          integer not null default 0,
  approvals_applied        integer not null default 0,
  initiated_by             text,
  dry_run_snapshot         jsonb,
  error_detail             text
);

alter table public.pokemon_tcg_identity_approval_runs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_identity_approval_runs') then
    create policy pokemon_tcg_identity_approval_runs_admin on public.pokemon_tcg_identity_approval_runs
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

create or replace function public.apply_pokemon_tcg_identity_approval_batch(
  p_run_id text,
  p_batch_size integer default 500
)
returns table (
  approved integer,
  remaining integer
)
language plpgsql
security definer
as $$
declare
  v_run_row public.pokemon_tcg_identity_approval_runs%rowtype;
  v_approved integer := 0;
  v_remaining integer := 0;
begin
  select * into v_run_row from public.pokemon_tcg_identity_approval_runs
    where run_id = p_run_id for update;
  if not found then
    raise exception 'run_id % not registered', p_run_id;
  end if;
  if v_run_row.status <> 'in_progress' then
    raise exception 'run_id % is %, not in_progress', p_run_id, v_run_row.status;
  end if;

  with to_approve as (
    select
      v.mapping_id,
      v.pp_card_slug,
      v.pp_card_name,
      v.matcher_eligibility,
      v.recommended_eligibility,
      v.risk_class
    from public.v_pokemon_tcg_identity_safe_cohort v
    where not exists (
      select 1 from public.pokemon_tcg_mapping_audit a
      where a.mapping_id = v.mapping_id
        and a.action = 'qa_identity_approval'
        and a.metadata->>'run_id' = p_run_id
    )
    limit p_batch_size
  ),
  updated as (
    update public.pokemon_tcg_mappings m
      set
        previous_review_status = m.review_status,
        review_status = 'approved',
        reviewed_at = now(),
        reviewer_display = 'automation:apply_pokemon_tcg_identity_approval_batch',
        updated_at = now()
      from to_approve ta
     where m.id = ta.mapping_id
       and m.review_status in ('pending_review', 'unmatched')
       and m.confidence = 'verified'
    returning m.id, ta.pp_card_slug, ta.pp_card_name, m.previous_review_status, ta.matcher_eligibility, ta.risk_class
  ),
  inserted_audit as (
    insert into public.pokemon_tcg_mapping_audit (
      mapping_id, pp_card_slug, provider, action, from_status, to_status, reason, actor_display, metadata
    )
    select
      u.id, u.pp_card_slug, 'tcggraph',
      'qa_identity_approval',
      u.previous_review_status,
      'approved',
      'identity-safe cohort approval · risk=' || u.risk_class,
      'rpc:apply_pokemon_tcg_identity_approval_batch',
      jsonb_build_object(
        'run_id', p_run_id,
        'from_status', u.previous_review_status,
        'to_status', 'approved',
        'matcher_eligibility', u.matcher_eligibility,
        'risk_class', u.risk_class
      )
    from updated u
    returning 1
  )
  select count(*) into v_approved from inserted_audit;

  select count(*) into v_remaining
    from public.v_pokemon_tcg_identity_safe_cohort v
    where not exists (
      select 1 from public.pokemon_tcg_mapping_audit a
      where a.mapping_id = v.mapping_id
        and a.action = 'qa_identity_approval'
        and a.metadata->>'run_id' = p_run_id
    );

  update public.pokemon_tcg_identity_approval_runs
    set approvals_applied = approvals_applied + v_approved
   where run_id = p_run_id;

  if v_remaining = 0 then
    update public.pokemon_tcg_identity_approval_runs
      set status = 'completed', completed_at = now()
     where run_id = p_run_id;
  end if;

  return query select v_approved, v_remaining;
end;
$$;

grant execute on function public.apply_pokemon_tcg_identity_approval_batch to service_role;

create or replace function public.rollback_pokemon_tcg_identity_approval_run(
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
      coalesce(a.metadata->>'from_status', a.from_status, 'pending_review') as prior_status
    from public.pokemon_tcg_mapping_audit a
    where a.action = 'qa_identity_approval'
      and a.metadata->>'run_id' = p_run_id
  ),
  reverted as (
    update public.pokemon_tcg_mappings m
      set review_status = rt.prior_status,
          previous_review_status = 'approved',
          updated_at = now()
      from rollback_targets rt
     where m.id = rt.mapping_id
    returning m.id, rt.pp_card_slug, rt.prior_status
  ),
  rollback_audit as (
    insert into public.pokemon_tcg_mapping_audit (
      mapping_id, pp_card_slug, provider, action, from_status, to_status, reason, actor_display, metadata
    )
    select
      r.id, r.pp_card_slug, 'tcggraph',
      'qa_identity_approval_rollback',
      'approved',
      r.prior_status,
      'rollback of run ' || p_run_id,
      'rpc:rollback_pokemon_tcg_identity_approval_run',
      jsonb_build_object(
        'rollback_of_run_id', p_run_id,
        'from_status', 'approved',
        'to_status', r.prior_status
      )
    from reverted r
    returning 1
  )
  select count(*) into v_rolled_back from rollback_audit;

  update public.pokemon_tcg_identity_approval_runs
    set status = 'failed', error_detail = 'rolled back at ' || now()::text
   where run_id = p_run_id;

  return v_rolled_back;
end;
$$;

grant execute on function public.rollback_pokemon_tcg_identity_approval_run to service_role;

-- =============================================================
-- Phase 6 Checkpoint A — affiliate status reconciliation
-- =============================================================
-- Before this migration, EPN rows were deduped with
-- `ignoreDuplicates: true`, so a later CSV that showed a transaction
-- clearing from pending → confirmed, pending → reversed, or an
-- amount correction, was SILENTLY DROPPED. The dashboard displayed
-- stale first-seen state forever.
--
-- This migration lays the schema for a reconciling importer:
--
--  * `ledger_status` text — the current status reported by the
--    affiliate network for this ledger row. Lives on the main
--    revenue event so it's indexable (previously buried in
--    source_detail jsonb). Nullable: non-EPN sources leave it null.
--
--  * `first_seen_at` timestamptz — when WE first observed this
--    transaction via an import. Preserved across status transitions.
--
--  * `status_changed_at` timestamptz — when we observed the current
--    status being set. Nullable: for rows imported before this
--    migration, we DO NOT KNOW when they changed status so this
--    column is left null and we must not fabricate a date.
--
--  * `network_affiliate_status_history` — append-only log of
--    (from_status, to_status, from_amount, to_amount) transitions.
--    For historical rows we insert one row with from_status=null to
--    represent "first observation at import — unknown prior state".
--
-- Backfill rules:
--  * ledger_status = source_detail->>'status' (if present) — this
--    is the value the importer was writing to source_detail all
--    along; just lift it onto the column.
--  * first_seen_at = recorded_at — closest truthful proxy. The
--    event's business date (occurred_on) is not when we imported
--    it, so we use recorded_at (when the row was persisted).
--  * status_changed_at stays NULL — we have no history data to
--    truthfully populate it.

do $$
begin
  alter table public.network_revenue_events
    add column if not exists ledger_status      text,
    add column if not exists first_seen_at      timestamptz,
    add column if not exists status_changed_at  timestamptz;
end $$;

-- Backfill ledger_status from the jsonb we were already writing.
update public.network_revenue_events
   set ledger_status = source_detail->>'status'
 where ledger_status is null
   and source_detail ? 'status';

-- Backfill first_seen_at.
update public.network_revenue_events
   set first_seen_at = recorded_at
 where first_seen_at is null;

-- Index to support ageing queries: pending rows by source + occurred_on.
create index if not exists network_revenue_events_status_idx
  on public.network_revenue_events (source_id, ledger_status, occurred_on)
  where ledger_status is not null;

-- ─────────────────────────────────────────────────────────────
-- Append-only history of status / amount transitions
-- ─────────────────────────────────────────────────────────────

create table if not exists public.network_affiliate_status_history (
  id                   uuid primary key default gen_random_uuid(),
  revenue_event_id     uuid not null references public.network_revenue_events (id) on delete cascade,
  observed_at          timestamptz not null default now(),
  from_status          text,                               -- null = first observation
  to_status            text not null,
  from_amount_minor    bigint,                             -- null = first observation
  to_amount_minor      bigint not null,
  from_event_kind      text,
  to_event_kind        text,
  import_file_name     text,
  notes                text,
  created_at           timestamptz not null default now()
);

create index if not exists network_affiliate_status_history_event_idx
  on public.network_affiliate_status_history (revenue_event_id, observed_at desc);

alter table public.network_affiliate_status_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'network_affiliate_status_history'
      and policyname = 'network_affiliate_status_history_admin'
  ) then
    create policy network_affiliate_status_history_admin
      on public.network_affiliate_status_history
      for all
      using (public.network_is_admin())
      with check (public.network_is_admin());
  end if;
end $$;

-- Seed history with one "first observation" row per existing event, so
-- going forward every event has at least one history row. from_status
-- is NULL to be explicit that we don't know the prior state for
-- historically-imported transactions.
insert into public.network_affiliate_status_history
  (revenue_event_id, observed_at, from_status, to_status,
   from_amount_minor, to_amount_minor, from_event_kind, to_event_kind,
   import_file_name, notes)
select
  e.id,
  e.recorded_at,
  null,
  coalesce(e.ledger_status, 'unknown'),
  null,
  e.amount_minor,
  null,
  e.event_kind,
  e.source_detail->>'file_name',
  'Seeded from pre-reconciliation import. Prior state unknown.'
  from public.network_revenue_events e
 where e.ledger_status is not null
   and not exists (
     select 1 from public.network_affiliate_status_history h
      where h.revenue_event_id = e.id
   );

-- Same shape on the conversion ledger. network_affiliate_conversions
-- also silently skipped updates; mirror the same columns + history
-- rows so a future reconciliation can detect provider_payload
-- changes on the conversion side too.

do $$
begin
  alter table public.network_affiliate_conversions
    add column if not exists ledger_status      text,
    add column if not exists first_seen_at      timestamptz,
    add column if not exists status_changed_at  timestamptz;
end $$;

update public.network_affiliate_conversions
   set ledger_status = provider_payload->>'status'
 where ledger_status is null
   and provider_payload ? 'status';

update public.network_affiliate_conversions
   set first_seen_at = recorded_at
 where first_seen_at is null;

create index if not exists network_affiliate_conversions_status_idx
  on public.network_affiliate_conversions (source_id, ledger_status, occurred_on)
  where ledger_status is not null;

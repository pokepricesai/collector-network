-- =============================================================
-- Phase 6B · EPN ledger RESET (backup + scoped delete)
-- =============================================================
-- Prepares the ledger for the canonical Impact API rebuild:
--
--   1. Snapshots every EPN-scoped row into archive.epn_* backup
--      tables (private, service_role-only).
--   2. Verifies archive counts match the live source counts.
--   3. Deletes the EPN rows ONLY (events + conversions + daily;
--      status_history cascades on the events delete).
--
-- Everything runs inside a single PL/pgSQL block, which executes in
-- the migration's implicit transaction. If any assertion fails, the
-- whole transaction rolls back — no half-state possible.
--
-- Non-EPN rows (sponsorships, costs, tasks, approvals, Whatnot, other
-- affiliate sources) are UNTOUCHED. The EPN source rows themselves
-- in network_revenue_sources are preserved — only their events are
-- deleted — so the ingest module can continue to reference them.
--
-- Idempotency: the backup tables use `create table if not exists`
-- so re-running (which should not happen under normal migration
-- flow) will not clobber. The deletes will simply remove nothing
-- the second time around.

do $$
declare
  v_epn_src_ids           uuid[];
  v_evt_before            bigint;
  v_evt_backup_count      bigint;
  v_evt_after             bigint;
  v_conv_before           bigint;
  v_conv_backup_count     bigint;
  v_conv_after            bigint;
  v_hist_before           bigint;
  v_hist_backup_count     bigint;
  v_hist_after            bigint;
  v_daily_before          bigint;
  v_daily_backup_count    bigint;
  v_daily_after           bigint;
  v_click_before          bigint;
  v_click_backup_count    bigint;
begin
  -- Resolve EPN source UUIDs.
  select array_agg(id)
    into v_epn_src_ids
    from public.network_revenue_sources
   where kind = 'ebay_epn';

  if v_epn_src_ids is null or array_length(v_epn_src_ids, 1) is null then
    raise exception
      'EPN reset: no network_revenue_sources rows with kind = ebay_epn. Nothing to reset.';
  end if;

  -- ───── Pre-counts ────────────────────────────────────────────
  select count(*) into v_evt_before
    from public.network_revenue_events where source_id = any (v_epn_src_ids);
  select count(*) into v_conv_before
    from public.network_affiliate_conversions where source_id = any (v_epn_src_ids);
  select count(*) into v_hist_before
    from public.network_affiliate_status_history h
   where exists (
     select 1 from public.network_revenue_events e
      where e.id = h.revenue_event_id
        and e.source_id = any (v_epn_src_ids)
   );
  select count(*) into v_daily_before
    from public.network_revenue_daily where source_id = any (v_epn_src_ids);
  select count(*) into v_click_before
    from public.network_affiliate_clicks where source_id = any (v_epn_src_ids);

  raise notice 'EPN reset: pre-counts → events=%, conversions=%, status_history=%, daily=%, clicks=%',
    v_evt_before, v_conv_before, v_hist_before, v_daily_before, v_click_before;

  -- ───── Backup tables (archive schema) ────────────────────────
  -- The archive schema was created in 20261006000000_archive_schema.
  -- Each backup table carries the raw rows + `_source_slug` for the
  -- events table (debug column — restore excludes it via a named-
  -- column INSERT, documented on the reset page).

  create table if not exists archive.epn_events_backup_20261006 as
  select e.*, s.slug as _source_slug
    from public.network_revenue_events e
    join public.network_revenue_sources s on s.id = e.source_id
   where e.source_id = any (v_epn_src_ids);
  alter table archive.epn_events_backup_20261006 enable row level security;
  revoke all on archive.epn_events_backup_20261006 from anon, authenticated, public;
  comment on table archive.epn_events_backup_20261006
    is 'EPN revenue_events snapshot before API rebuild (2026-10-06).';

  create table if not exists archive.epn_conversions_backup_20261006 as
  select c.*
    from public.network_affiliate_conversions c
   where c.source_id = any (v_epn_src_ids);
  alter table archive.epn_conversions_backup_20261006 enable row level security;
  revoke all on archive.epn_conversions_backup_20261006 from anon, authenticated, public;

  create table if not exists archive.epn_status_history_backup_20261006 as
  select h.*
    from public.network_affiliate_status_history h
   where exists (
     select 1 from public.network_revenue_events e
      where e.id = h.revenue_event_id
        and e.source_id = any (v_epn_src_ids)
   );
  alter table archive.epn_status_history_backup_20261006 enable row level security;
  revoke all on archive.epn_status_history_backup_20261006 from anon, authenticated, public;

  create table if not exists archive.epn_daily_backup_20261006 as
  select d.*
    from public.network_revenue_daily d
   where d.source_id = any (v_epn_src_ids);
  alter table archive.epn_daily_backup_20261006 enable row level security;
  revoke all on archive.epn_daily_backup_20261006 from anon, authenticated, public;

  create table if not exists archive.epn_clicks_backup_20261006 as
  select cl.*
    from public.network_affiliate_clicks cl
   where cl.source_id = any (v_epn_src_ids);
  alter table archive.epn_clicks_backup_20261006 enable row level security;
  revoke all on archive.epn_clicks_backup_20261006 from anon, authenticated, public;

  -- ───── Verify backup counts ───────────────────────────────────
  select count(*) into v_evt_backup_count   from archive.epn_events_backup_20261006;
  select count(*) into v_conv_backup_count  from archive.epn_conversions_backup_20261006;
  select count(*) into v_hist_backup_count  from archive.epn_status_history_backup_20261006;
  select count(*) into v_daily_backup_count from archive.epn_daily_backup_20261006;
  select count(*) into v_click_backup_count from archive.epn_clicks_backup_20261006;

  raise notice 'EPN reset: backup counts → events=%, conversions=%, status_history=%, daily=%, clicks=%',
    v_evt_backup_count, v_conv_backup_count, v_hist_backup_count, v_daily_backup_count, v_click_backup_count;

  if v_evt_backup_count   <> v_evt_before   then raise exception 'EPN reset: events backup count mismatch (% vs %)',   v_evt_backup_count,   v_evt_before;   end if;
  if v_conv_backup_count  <> v_conv_before  then raise exception 'EPN reset: conversions backup count mismatch (% vs %)',  v_conv_backup_count,  v_conv_before;  end if;
  if v_hist_backup_count  <> v_hist_before  then raise exception 'EPN reset: status_history backup count mismatch (% vs %)', v_hist_backup_count,  v_hist_before;  end if;
  if v_daily_backup_count <> v_daily_before then raise exception 'EPN reset: daily backup count mismatch (% vs %)', v_daily_backup_count, v_daily_before; end if;
  if v_click_backup_count <> v_click_before then raise exception 'EPN reset: clicks backup count mismatch (% vs %)', v_click_backup_count, v_click_before; end if;

  -- ───── Scoped delete ─────────────────────────────────────────
  -- Order:
  --   1. network_affiliate_conversions (FK source_id ON DELETE RESTRICT →
  --      must delete these explicitly; revenue_event_id would already
  --      be set to NULL once events go, but we delete the whole row).
  --   2. network_revenue_daily (CASCADE on source — we keep sources,
  --      so delete rollups explicitly).
  --   3. network_revenue_events (triggers CASCADE on
  --      network_affiliate_status_history via revenue_event_id).
  --
  -- Clicks are left in place (FK is SET NULL, not CASCADE). Click
  -- data is independent of transaction identity, and the backup
  -- captures them for parity.

  delete from public.network_affiliate_conversions
   where source_id = any (v_epn_src_ids);

  delete from public.network_revenue_daily
   where source_id = any (v_epn_src_ids);

  delete from public.network_revenue_events
   where source_id = any (v_epn_src_ids);

  -- ───── Post-counts (invariants) ───────────────────────────────
  select count(*) into v_evt_after
    from public.network_revenue_events where source_id = any (v_epn_src_ids);
  select count(*) into v_conv_after
    from public.network_affiliate_conversions where source_id = any (v_epn_src_ids);
  select count(*) into v_hist_after
    from public.network_affiliate_status_history h
   where exists (
     select 1 from public.network_revenue_events e
      where e.id = h.revenue_event_id
        and e.source_id = any (v_epn_src_ids)
   );
  select count(*) into v_daily_after
    from public.network_revenue_daily where source_id = any (v_epn_src_ids);

  if v_evt_after   > 0 then raise exception 'EPN reset: % events remain after delete',   v_evt_after;   end if;
  if v_conv_after  > 0 then raise exception 'EPN reset: % conversions remain after delete', v_conv_after; end if;
  if v_hist_after  > 0 then raise exception 'EPN reset: % status_history rows remain after delete', v_hist_after; end if;
  if v_daily_after > 0 then raise exception 'EPN reset: % daily rows remain after delete', v_daily_after; end if;

  raise notice 'EPN reset: complete. Backup counts match source counts; EPN ledger is empty and ready for canonical API rebuild.';
end $$;

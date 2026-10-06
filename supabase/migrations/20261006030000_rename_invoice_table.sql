-- =============================================================
-- Phase 6B · Rename impact_invoices → network_affiliate_invoices
-- =============================================================
-- The table was created empty in 20261006010000_impact_invoices.sql
-- Convention in this codebase is `network_*` for the public-schema
-- business tables, so the earlier name was out of style. The table
-- was never populated — rename is safe.
--
-- All indexes, constraints, RLS and policies carry over
-- automatically via ALTER TABLE RENAME.

alter table if exists public.impact_invoices
  rename to network_affiliate_invoices;

do $$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'impact_invoices_source_date_idx'
  ) then
    alter index public.impact_invoices_source_date_idx
      rename to network_affiliate_invoices_source_date_idx;
  end if;
  if exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'impact_invoices_payment_status_idx'
  ) then
    alter index public.impact_invoices_payment_status_idx
      rename to network_affiliate_invoices_payment_status_idx;
  end if;
end $$;

-- Rename the RLS policy created on the old table name, if present.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'network_affiliate_invoices'
      and policyname = 'impact_invoices_admin_rw'
  ) then
    alter policy impact_invoices_admin_rw
      on public.network_affiliate_invoices
      rename to network_affiliate_invoices_admin_rw;
  end if;
end $$;

comment on table public.network_affiliate_invoices
  is 'Settlement / payment layer from the Impact /Invoices endpoint. Separate from network_revenue_events — do NOT mix invoice totals into transaction revenue.';

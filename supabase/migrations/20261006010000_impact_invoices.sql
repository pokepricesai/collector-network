-- =============================================================
-- Phase 6B · Impact invoice / settlement layer
-- =============================================================
-- Invoices are NOT transaction revenue. They are the settlement /
-- payment layer that lets us compare:
--
--     earned confirmed commission (network_revenue_events + API)
--  vs actually invoiced / settled   (this table)
--
-- Keeping invoices in their own table avoids any confusion between
-- "what we're owed" and "what we've been paid". Dashboards must query
-- them separately.
--
-- Idempotency: (source_id, provider_invoice_id).

create table if not exists public.impact_invoices (
  id                     uuid primary key default gen_random_uuid(),
  source_id              uuid not null references public.network_revenue_sources (id)
                         on delete restrict,
  provider_invoice_id    text not null,                       -- Impact's own invoice Id
  invoice_date           date,
  period_start_on        date,
  period_end_on          date,
  currency               text not null default 'GBP'
                         check (char_length(currency) = 3),
  total_minor            bigint not null default 0,           -- in smallest currency unit
  vat_minor              bigint,
  recipient              text,
  payment_status         text,                                -- e.g. 'paid', 'issued', 'pending'
  paid_on                date,
  provider_payload       jsonb not null default '{}'::jsonb,  -- raw /Invoices record
  first_seen_at          timestamptz not null default now(),
  recorded_at            timestamptz not null default now(),
  unique (source_id, provider_invoice_id)
);

create index if not exists impact_invoices_source_date_idx
  on public.impact_invoices (source_id, invoice_date desc);
create index if not exists impact_invoices_payment_status_idx
  on public.impact_invoices (payment_status)
  where payment_status is not null;

alter table public.impact_invoices enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'impact_invoices'
      and policyname = 'impact_invoices_admin_rw'
  ) then
    create policy impact_invoices_admin_rw
      on public.impact_invoices
      for all
      using (public.network_is_admin())
      with check (public.network_is_admin());
  end if;
end $$;

comment on table public.impact_invoices
  is 'Settlement / payment layer from the Impact /Invoices endpoint. Separate from network_revenue_events — do NOT mix invoice totals into transaction revenue.';

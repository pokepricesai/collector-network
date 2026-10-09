-- Rename intelligence `tone` -> `signal_kind` to match the Phase 1
-- product spec vocabulary. Values are unchanged
-- (opportunity|risk|warning|positive|informational).
--
-- The existing enum type network_intelligence_tone is renamed in
-- place via ALTER TYPE RENAME; the column rename follows. Safe
-- because no production data has been written yet (the engine was
-- shipped but not run).

alter type public.network_intelligence_tone rename to network_intelligence_signal_kind;

alter table public.network_intelligence_items rename column tone to signal_kind;

comment on column public.network_intelligence_items.signal_kind is
  'opportunity | risk | warning | positive | informational. Independent of category — a REVENUE item may be a warning or a positive.';

-- Tasks Phase 1: lightweight manual + intelligence task tracker.
--
-- Decision: reuse network_tasks. Do not create a competing table.
-- The existing schema already carries almost every field we need
-- (title, site_id, priority, status, description, metadata,
-- evidence, task_type, completed_at). Two columns need adding:
--
--   • task_kind   — 'fix' | 'improvement'. Top-level filter the
--                   operator uses to triage the inbox at a glance.
--                   Existing rows are all improvements.
--
--   • task_source — 'manual' | 'intelligence' | 'system'. Where the
--                   task came from, as distinct from the existing
--                   `source_code` which is an FK into
--                   network_data_sources (gsc, ga4, scryfall …).
--                   Keeping these separate: source_code answers
--                   "which upstream data produced this?",
--                   task_source answers "did a human or an engine
--                   open this card?".
--
-- Backfill:
--   • task_kind on every row → 'improvement'.
--   • task_source: 'intelligence' when task_type='intelligence',
--     'system' everywhere else.
--
-- Also adds an index to accelerate the admin inbox + Morning Brief
-- queries, and a PostgREST schema reload so the new columns are
-- selectable immediately post-apply.

alter table public.network_tasks
  add column if not exists task_kind text default 'improvement';
alter table public.network_tasks
  add column if not exists task_source text default 'system';

update public.network_tasks
set task_kind = 'improvement'
where task_kind is null;

update public.network_tasks
set task_source = case
  when task_type = 'intelligence' then 'intelligence'
  else 'system'
end
where task_source is null
   or task_source not in ('manual', 'intelligence', 'system');

alter table public.network_tasks
  alter column task_kind set not null,
  alter column task_source set not null;

alter table public.network_tasks
  drop constraint if exists network_tasks_task_kind_check;
alter table public.network_tasks
  add constraint network_tasks_task_kind_check
  check (task_kind in ('fix', 'improvement'));

alter table public.network_tasks
  drop constraint if exists network_tasks_task_source_check;
alter table public.network_tasks
  add constraint network_tasks_task_source_check
  check (task_source in ('manual', 'intelligence', 'system'));

create index if not exists network_tasks_open_by_site_idx
  on public.network_tasks (site_id, status, created_at desc)
  where status in ('open', 'in_progress', 'waiting');

notify pgrst, 'reload schema';

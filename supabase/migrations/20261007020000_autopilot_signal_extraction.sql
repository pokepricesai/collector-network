-- =============================================================
-- Phase 6 Checkpoint B.1 · Discovered-signal extraction fields
-- =============================================================
-- When the autopilot selects an external signal for a research pack
-- it fetches the full source page and extracts a compact text snapshot
-- (title + main text + og:image + published_at) via a deterministic
-- HTML parser. Those extracted fields land on the signal row so a
-- future autopilot run can reuse them without re-fetching.

do $$
begin
  alter table public.network_autopilot_discovered_signals
    add column if not exists extracted_text text,
    add column if not exists content_hash   text,
    add column if not exists og_image_url_extracted text;
end $$;

create index if not exists network_autopilot_signals_content_hash_idx
  on public.network_autopilot_discovered_signals (content_hash)
  where content_hash is not null;

comment on column public.network_autopilot_discovered_signals.extracted_text is
  'Compact bounded text extracted from the source page. Used by the writer as research material only — never reproduced verbatim.';
comment on column public.network_autopilot_discovered_signals.content_hash is
  'sha256 of the extracted_text, lets us dedupe when the same article is re-fetched or syndicated across sources.';

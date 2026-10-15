-- =============================================================
-- CN-04 Slice C · Automated publishing, scheduling, indexing
-- =============================================================
-- No behaviour change on its own; sets up the state we need for:
--   * server-to-server delivery to PokePrices + MTGPrices
--   * explicit "scheduled by" audit trail (scheduled_for already
--     exists on network_articles from Phase 3)
--   * duplicate-publication prevention
--   * per-article indexing checklist (Google manual, Bing IndexNow)
--   * site-level IndexNow configuration

-- --- 1. Indexing checklist columns on articles --------------------
alter table public.network_articles
  add column if not exists google_index_requested_at   timestamptz,
  add column if not exists google_index_requested_by   uuid references public.network_admin_users (id) on delete set null,
  add column if not exists bing_index_submitted_at     timestamptz,
  add column if not exists bing_index_submission_response jsonb,
  add column if not exists bing_index_submitted_by     uuid references public.network_admin_users (id) on delete set null,
  add column if not exists scheduled_by                uuid references public.network_admin_users (id) on delete set null;

-- --- 2. External publish artefacts --------------------------------
--
-- target_record_id already exists on network_content_publications
-- for the external row id (PokePrices.insights.id). commit_sha
-- already exists for the markdown target. We just add indexes so
-- the duplicate-check query stays O(1).

create index if not exists network_content_publications_article_status_idx
  on public.network_content_publications (article_id, status);

-- --- 3. IndexNow key per site -------------------------------------
--
-- Keys are public (served at <origin>/<key>.txt) but storing them on
-- the site row keeps the hub side driven by data, not env sprawl.

alter table public.network_sites
  add column if not exists indexnow_key text,
  add column if not exists indexnow_enabled boolean not null default false;

comment on column public.network_sites.indexnow_key is
  'Public IndexNow key served at <canonical_url>/<key>.txt. Null = not configured.';

-- --- 4. Scheduled-publish advisory-lock RPC -----------------------
--
-- The scheduler cron fires every N minutes. Two overlapping fires
-- could both see the same due article and double-publish. This RPC
-- grabs a short per-article advisory lock then CAS-flips the
-- status so the second concurrent caller returns `claimed=false`
-- and skips. Partner publishActionAtomic in TypeScript handles the
-- rest.

create or replace function public.network_claim_scheduled_article(
  p_article_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key   bigint;
  v_claimed    integer := 0;
begin
  -- Per-article advisory lock keyed on the UUID hash. Short-lived;
  -- release at transaction commit/rollback.
  v_lock_key := hashtextextended(p_article_id::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  update public.network_articles
     set status = 'publishing'
   where id = p_article_id
     and status = 'scheduled';
  get diagnostics v_claimed = row_count;
  return v_claimed > 0;
end $$;

revoke all on function public.network_claim_scheduled_article(uuid) from public;
grant execute on function public.network_claim_scheduled_article(uuid) to authenticated, service_role;

-- --- 5. Duplicate-publication guard -------------------------------
--
-- Historic CN-04A pilots have multiple success rows per article (the
-- Oct-14 push mixed preview + publish adapter calls). A unique index
-- would reject the migration. Belt-and-braces at the app layer
-- instead — publishArticle() checks for an existing success row
-- before writing a new one.

-- Non-unique composite index for lookups.
create index if not exists network_content_publications_success_lookup_idx
  on public.network_content_publications (article_id, status)
  where status = 'success';

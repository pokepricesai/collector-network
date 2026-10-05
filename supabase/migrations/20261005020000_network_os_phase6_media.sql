-- =============================================================
-- Collector Network OS — Phase 6B: article media + content structure
-- =============================================================
--
-- Adds the editorial media library + sanitised rich-text column, both
-- backed by the existing network_articles / Phase 3 content system.
-- Keeps the markdown body in place: body (text) remains the canonical
-- source for markdown drafts and existing AI output. The new
-- body_rich jsonb column holds the editor-side rich representation
-- (TipTap JSON) when the article was authored or re-edited in the
-- rich editor. Public renderers prefer body_rich when present and
-- fall back to body (markdown) otherwise.
--
-- Nothing in this migration mutates existing data. All ALTER TABLE
-- statements use ADD COLUMN IF NOT EXISTS; the new tables + storage
-- bucket are purely additive.

-- --- 1. network_media -------------------------------------------
--
-- Media library row. One record per uploaded asset. Lives in the
-- Supabase Storage bucket `network-media`. Stable public_url is the
-- URL every renderer uses so a slug/filename change on the storage
-- side can be absorbed centrally.

create table if not exists public.network_media (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid references public.network_sites (id) on delete set null,
  storage_bucket  text not null default 'network-media',
  storage_key     text not null unique,            -- bucket path, e.g. 'articles/2026/10/<uuid>.jpg'
  public_url      text not null,
  file_name       text not null,                   -- original (sanitised) upload name
  mime_type       text not null check (mime_type in (
                    'image/jpeg','image/png','image/webp','image/gif','image/avif','image/svg+xml'
                  )),
  byte_size       bigint not null check (byte_size >= 0 and byte_size <= 15 * 1024 * 1024),
  width           integer,
  height          integer,
  alt_text        text,
  caption         text,
  attribution     text,                            -- credit / source line
  uploaded_by     uuid references public.network_admin_users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists network_media_site_created_idx
  on public.network_media (site_id, created_at desc);
create index if not exists network_media_uploaded_by_idx
  on public.network_media (uploaded_by, created_at desc);

-- --- 2. network_article_media (join) -----------------------------
--
-- Explicit relation between an article and the media rows it uses.
-- `role = 'featured'` is the hero image, `og` is the Open Graph
-- image (optional override — defaults to featured), `inline` is
-- every image embedded in the article body with an optional
-- position for stable ordering.

create table if not exists public.network_article_media (
  article_id      uuid not null references public.network_articles (id) on delete cascade,
  media_id        uuid not null references public.network_media (id) on delete cascade,
  role            text not null check (role in ('featured', 'og', 'inline')),
  position        integer,
  created_at      timestamptz not null default now(),
  primary key (article_id, media_id, role)
);

create index if not exists network_article_media_article_role_idx
  on public.network_article_media (article_id, role);

-- --- 3. network_articles extensions ------------------------------

alter table public.network_articles
  add column if not exists body_rich jsonb,
  add column if not exists og_image_url text,
  add column if not exists featured_image_id uuid
    references public.network_media (id) on delete set null,
  add column if not exists standfirst text,       -- short lede above the body
  add column if not exists is_scheduled_dispatched boolean not null default false;

create index if not exists network_articles_scheduled_pending_idx
  on public.network_articles (scheduled_for)
  where status = 'scheduled' and scheduled_for is not null and not is_scheduled_dispatched;

-- --- 4. RLS enablement + policies -------------------------------

alter table public.network_media         enable row level security;
alter table public.network_article_media enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_media',
    'network_article_media'
  ])
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('create policy %I on public.%I for select using (public.network_is_admin())', t || '_admin_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all using (public.network_is_admin()) with check (public.network_is_admin())', t || '_admin_write', t);
  end loop;
end $$;

-- Public anonymous read on network_media rows (just metadata, not the
-- file). The actual bytes are served via the public bucket URL. This
-- keeps the public site insights route able to resolve image alt text
-- + captions without going through a server function.
drop policy if exists network_media_public_select on public.network_media;
create policy network_media_public_select
  on public.network_media
  for select
  using (true);

-- Mirror for the join table so public site renderers can resolve
-- featured/inline media for a given article.
drop policy if exists network_article_media_public_select on public.network_article_media;
create policy network_article_media_public_select
  on public.network_article_media
  for select
  using (true);

-- --- 5. Storage bucket ------------------------------------------
--
-- `network-media` is a public bucket (same posture as every other
-- editorial image library at the site network). Uploads are
-- restricted to the admin API — no public write path. Reads are
-- public so the <img src="..."> on each product site works without
-- a signed URL per request.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'network-media',
  'network-media',
  true,
  15 * 1024 * 1024,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/svg+xml']
)
on conflict (id) do nothing;

-- Storage object policies. Public read; admin-only write via the
-- service role (hub actions sign requests via the service_role key
-- held server-side in the hub).

do $$
begin
  -- Public read on this specific bucket's objects.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'network_media_public_read'
  ) then
    execute $pol$
      create policy network_media_public_read
        on storage.objects
        for select
        using (bucket_id = 'network-media')
    $pol$;
  end if;
end $$;

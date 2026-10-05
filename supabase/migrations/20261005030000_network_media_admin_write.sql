-- =============================================================
-- Phase 6B follow-up: let admins write to the network-media bucket
-- using their own session (no service-role key required in the hub)
-- =============================================================
--
-- The initial Phase 6B migration created the bucket with a public
-- read policy only. Writes default-deny, which forces the hub to use
-- the service-role key. We prefer the admin's session so there is no
-- long-lived super-user credential sitting in the hub Vercel env for
-- the Collector Network OS Supabase project.
--
-- This migration adds matching INSERT / UPDATE / DELETE policies
-- gated on `public.network_is_admin()`.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'network_media_admin_write_insert'
  ) then
    execute $pol$
      create policy network_media_admin_write_insert
        on storage.objects
        for insert
        with check (
          bucket_id = 'network-media'
          and public.network_is_admin()
        )
    $pol$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'network_media_admin_write_update'
  ) then
    execute $pol$
      create policy network_media_admin_write_update
        on storage.objects
        for update
        using (bucket_id = 'network-media' and public.network_is_admin())
        with check (bucket_id = 'network-media' and public.network_is_admin())
    $pol$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'network_media_admin_write_delete'
  ) then
    execute $pol$
      create policy network_media_admin_write_delete
        on storage.objects
        for delete
        using (bucket_id = 'network-media' and public.network_is_admin())
    $pol$;
  end if;
end $$;

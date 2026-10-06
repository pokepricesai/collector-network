-- =============================================================
-- Phase 6B · Private archive schema
-- =============================================================
-- Dedicated schema for point-in-time archival snapshots (e.g. the
-- pre-API-rebuild backup of the legacy EPN ledger). Deliberately
-- NOT exposed via Postgrest:
--
--   * Supabase's `db-schemas` config lists only `public, storage,
--     graphql_public` by default. Not adding `archive` means the
--     REST layer cannot see this schema.
--
--   * USAGE on the schema is revoked from `anon` and
--     `authenticated` as belt-and-suspenders — even if the
--     Postgrest config were widened, the app roles still cannot
--     reach into archive.
--
--   * Tables created here will additionally have RLS enabled with
--     no permissive policies by the migration that creates them.
--
-- Only the `postgres` role (migrations) and `service_role`
-- (admin-side maintenance) have access.

create schema if not exists archive;

revoke all on schema archive from public;
revoke all on schema archive from anon;
revoke all on schema archive from authenticated;

grant usage, create on schema archive to postgres;
grant usage on schema archive to service_role;

-- Ensure future tables created in archive do NOT accidentally inherit
-- default privileges that would expose them to the app roles.
alter default privileges in schema archive revoke all on tables from anon, authenticated, public;
alter default privileges in schema archive revoke all on sequences from anon, authenticated, public;
alter default privileges in schema archive revoke all on functions from anon, authenticated, public;

comment on schema archive is 'Private archival snapshots. Not exposed via Postgrest. service_role / postgres only.';

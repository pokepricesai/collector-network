-- Force PostgREST to reload its schema cache after the signal_kind
-- rename in 20261009010000. PostgREST caches column + enum names on
-- startup and does NOT automatically refresh after ALTER TYPE RENAME
-- or ALTER TABLE RENAME COLUMN. The signal is a standard
-- `NOTIFY pgrst, 'reload schema'` which PostgREST subscribes to and
-- picks up within ~5 seconds.
--
-- Keeping this as a dedicated migration (rather than tacking it onto
-- the rename) so future schema renames can call the same signal
-- without needing to replay the rename itself.

notify pgrst, 'reload schema';

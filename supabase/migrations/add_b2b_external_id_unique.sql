-- B2B webhook upserts on external_id; the table never had a unique index on it,
-- so any B2B event carrying an appointment id was rejected (Postgres 42P10).
-- Must be a plain (non-partial) unique index: ON CONFLICT (external_id) as sent
-- by supabase-js cannot match a partial index. NULLs remain allowed.
DO $$
BEGIN
  IF to_regclass('public.b2b_events') IS NULL THEN RETURN; END IF;
  DROP INDEX IF EXISTS b2b_events_external_id_key;
  CREATE UNIQUE INDEX b2b_events_external_id_key ON b2b_events (external_id);
END $$;

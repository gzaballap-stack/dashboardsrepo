-- B2B webhook upserts on external_id; the table never had a unique index on it,
-- so any B2B event carrying an appointment id was rejected (Postgres 42P10).
DO $$
BEGIN
  IF to_regclass('public.b2b_events') IS NULL THEN RETURN; END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS b2b_events_external_id_key
    ON b2b_events (external_id) WHERE external_id IS NOT NULL;
END $$;

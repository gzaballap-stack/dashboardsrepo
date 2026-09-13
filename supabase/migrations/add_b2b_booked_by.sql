-- Who booked the demo: 'self' (the lead, via the calendar link) or 'team' (us).
DO $$
BEGIN
  IF to_regclass('public.b2b_events') IS NULL THEN RETURN; END IF;
  ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS booked_by text;
END $$;

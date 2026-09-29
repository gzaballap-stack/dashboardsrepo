-- Fake / funnel-hacker submissions: flagged as spam, excluded from every count,
-- never deleted (so the gap against Meta's numbers stays visible).
ALTER TABLE events     DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events     ADD CONSTRAINT events_event_type_check CHECK (event_type IN ('dial','lead','appointment_booked','show','no_show','callback_booked','closed','funnel_visit','vsl_watch','precall_watch','visit_landing','visit_calendar','visit_thankyou','spam_lead','spam_appointment'));
DO $$ BEGIN
  IF to_regclass('public.b2b_events') IS NULL THEN RETURN; END IF;   -- V2 has no B2B tables
  ALTER TABLE b2b_events DROP CONSTRAINT IF EXISTS b2b_events_event_type_check;
  ALTER TABLE b2b_events ADD CONSTRAINT b2b_events_event_type_check CHECK (event_type IN ('lead','intro_booked','intro_shown','sales_call_booked','sales_call_shown','close','call','funnel_visit','vsl_watch','precall_watch','visit_landing','visit_calendar','visit_thankyou','spam_lead','spam_appointment'));
END $$;

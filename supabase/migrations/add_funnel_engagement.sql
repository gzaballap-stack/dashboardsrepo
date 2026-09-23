-- Funnel engagement events: page visits and VSL / pre-call video watch milestones,
-- keyed to the contact so they correlate with shows/closes later.
ALTER TABLE events     ADD COLUMN IF NOT EXISTS progress_pct int;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS progress_pct int;
ALTER TABLE events     DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events     ADD CONSTRAINT events_event_type_check CHECK (
  event_type IN ('dial','lead','appointment_booked','show','no_show','callback_booked','closed','funnel_visit','vsl_watch','precall_watch'));
ALTER TABLE b2b_events DROP CONSTRAINT IF EXISTS b2b_events_event_type_check;
ALTER TABLE b2b_events ADD CONSTRAINT b2b_events_event_type_check CHECK (
  event_type IN ('lead','intro_booked','intro_shown','sales_call_booked','sales_call_shown','close','call','funnel_visit','vsl_watch','precall_watch'));

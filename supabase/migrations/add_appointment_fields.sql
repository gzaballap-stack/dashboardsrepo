-- scheduled_at: when the appointment is scheduled for (occurred_at = when it was booked)
ALTER TABLE events ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- external_id: GHL appointment ID — used by Make to find and flip appointment_booked → show/no_show
ALTER TABLE events ADD COLUMN IF NOT EXISTS external_id text;

-- calendar_name: GHL calendar name — used to distinguish callback requests from real appointments
-- Make sends event_type=callback_booked for callback calendars, so they never get show/no_show updates
ALTER TABLE events ADD COLUMN IF NOT EXISTS calendar_name text;

-- Index for fast lookup by external_id (hit on every show/no-show from Make)
CREATE INDEX IF NOT EXISTS events_external_id_idx ON events (external_id) WHERE external_id IS NOT NULL;

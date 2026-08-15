-- Lead identity
ALTER TABLE events ADD COLUMN IF NOT EXISTS lead_name text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS lead_phone text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS lead_email text;

-- Agent
ALTER TABLE events ADD COLUMN IF NOT EXISTS agent_name text;

-- Dial-specific
ALTER TABLE events ADD COLUMN IF NOT EXISTS direction text;          -- inbound | outbound
ALTER TABLE events ADD COLUMN IF NOT EXISTS call_status text;        -- completed | voicemail | canceled | no_answer
ALTER TABLE events ADD COLUMN IF NOT EXISTS recording_url text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS call_summary text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS phone_number_used text;

-- Appointment-specific
ALTER TABLE events ADD COLUMN IF NOT EXISTS stage_booked text;       -- e.g. "Day 1 AM"

-- Indexes for agent stats queries
CREATE INDEX IF NOT EXISTS events_agent_name_idx ON events (agent_name) WHERE agent_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_lead_phone_idx ON events (lead_phone) WHERE lead_phone IS NOT NULL;

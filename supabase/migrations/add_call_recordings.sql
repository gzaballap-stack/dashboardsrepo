-- Call recordings for CSM conversations and B2B calls.
--
-- Client dial recordings already have a home on events.recording_url. This
-- migration covers the two places that had nowhere to put one: CSM
-- conversations with existing clients, and B2B calls.

-- ── CSM tables ───────────────────────────────────────────────────────
-- These were created directly in Supabase and never captured in schema.sql.
-- Declared here so the repo stays the source of truth.
CREATE TABLE IF NOT EXISTS client_touchpoints (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  occurred_at timestamptz default now(),
  type        text,
  summary     text,
  csm_name    text,
  created_at  timestamptz default now()
);

CREATE TABLE IF NOT EXISTS client_csm_status (
  client_id       uuid primary key references clients(id) on delete cascade,
  cadence_days    integer,
  csm_name        text,
  left_review     boolean,
  review_date     date,
  review_platform text,
  review_link     text,
  upsell_status   text,
  upsell_notes    text,
  upsell_date     date,
  updated_at      timestamptz default now()
);

-- ── Recording fields on CSM touchpoints ──────────────────────────────
ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS recording_url    text;
ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS duration_seconds int;
ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS agent_name       text;
ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS call_status      text;
ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS external_id      text;

-- Idempotent webhook ingestion: one touchpoint per upstream call id, so a
-- replayed Make scenario updates the row instead of duplicating the call.
CREATE UNIQUE INDEX IF NOT EXISTS client_touchpoints_external_id_key
  ON client_touchpoints (external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_touchpoints_recording_idx
  ON client_touchpoints (client_id, occurred_at DESC) WHERE recording_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_touchpoints_csm_idx
  ON client_touchpoints (csm_name) WHERE csm_name IS NOT NULL;

-- ── B2B call events ──────────────────────────────────────────────────
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS recording_url    text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS duration_seconds int;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS agent_name       text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS call_status      text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS call_summary     text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS is_pickup        boolean;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS is_conversation  boolean;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS csm_name         text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS external_id_call text;

-- Links a B2B call to an existing client once that lead converts, so the
-- conversation surfaces on that client's CSM history.
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS client_id uuid references clients(id) on delete set null;

-- 'call' is absent from the original check constraint, so a B2B call cannot be
-- inserted at all until the constraint is replaced.
ALTER TABLE b2b_events DROP CONSTRAINT IF EXISTS b2b_events_event_type_check;
ALTER TABLE b2b_events ADD CONSTRAINT b2b_events_event_type_check CHECK (
  event_type in ('lead','intro_booked','intro_shown','sales_call_booked','sales_call_shown','close','call')
);

CREATE INDEX IF NOT EXISTS b2b_events_recording_idx
  ON b2b_events (occurred_at DESC) WHERE recording_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS b2b_events_client_idx
  ON b2b_events (client_id) WHERE client_id IS NOT NULL;

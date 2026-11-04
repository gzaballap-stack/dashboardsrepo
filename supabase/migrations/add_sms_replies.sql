-- Every inbound SMS reply, read by Claude and tagged in GHL (NOTES.md 2026-11-04).
-- Posted straight from GHL to /api/webhooks/sms with event_type = sms_inbound.
CREATE TABLE IF NOT EXISTS sms_replies (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  external_id      text unique,                 -- dedupe key for re-fired webhooks
  occurred_at      timestamptz not null default now(),
  ghl_contact_id   text,
  lead_name        text,
  lead_phone       text,
  message          text not null,               -- what the homeowner texted
  outbound_message text,                        -- what we sent them, when the workflow passes it
  intent           text not null,               -- interested | question | later | not_interested | wrong_number | stop | unclear | needs_review
  confidence       numeric,                     -- 0..1
  reason           text,                        -- the classifier's one-line why (or the error)
  suggested_reply  text,                        -- a draft next text for a setter
  tag              text,                        -- the GHL tag applied (sms-<intent>)
  tagged           boolean not null default false,
  tag_error        text,
  lead_created     boolean not null default false,
  needs_review     boolean not null default false,
  raw              jsonb,
  created_at       timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS sms_replies_client_time_idx ON sms_replies (client_id, occurred_at desc);
CREATE INDEX IF NOT EXISTS sms_replies_contact_idx ON sms_replies (ghl_contact_id);
ALTER TABLE sms_replies ENABLE ROW LEVEL SECURITY;

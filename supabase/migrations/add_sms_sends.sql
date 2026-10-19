-- SMS blasts sent for a client (the SMS service line). One row per message
-- batch: a per-contact workflow stores messages = 1, a per-blast workflow stores
-- the batch size. Posted straight from GHL to /api/webhooks/sms (no Make).
CREATE TABLE IF NOT EXISTS sms_sends (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  sent_date    date not null,
  occurred_at  timestamptz not null default now(),
  messages     integer not null default 1,
  external_id  text unique,                      -- dedupe key for re-fired webhooks
  ghl_contact_id text,
  raw          jsonb,
  created_at   timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS sms_sends_client_date_idx ON sms_sends (client_id, sent_date);

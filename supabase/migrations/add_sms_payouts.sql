-- Johnny's payout (SMS Dashboard, NOTES.md 2026-11-12): a share of the first
-- month's revenue from each client signed through the B2B SMS system.
--
-- One row per client signed. The 30-day window starts at the client's first SMS
-- blast (sms_sends) unless started_on is set by hand; revenue is the client's
-- paid Client Billing charges inside that window; payout = revenue × pct.
create table if not exists sms_payouts (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null unique references clients(id) on delete cascade,
  close_event_id uuid,                              -- the b2b_events close that signed them; null = added by hand (no FK: V2 has no b2b_events)
  signed_on      date not null,                     -- the close date, or the day it was added by hand
  started_on     date,                              -- set by hand; null = first SMS blast sent for the client
  pct            numeric not null default 30,       -- Johnny's share, per client (starts from app_settings sms_payout_pct)
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sms_payouts_signed_idx on sms_payouts (signed_on);

-- Small key / value store for dashboard-wide settings (first use: the default payout %).
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table sms_payouts  enable row level security;
alter table app_settings enable row level security;

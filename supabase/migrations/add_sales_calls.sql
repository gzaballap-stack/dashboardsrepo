-- Sales Tracker — TM Dashboard
-- Additive only: one new table. Nothing existing is touched.
--
-- One row per sales call Tomsi Media runs, rebuilt from the owner's
-- "Sales Tracker 2026" sheet. Shared by everyone who can open the TM
-- Dashboard (feature b2b_tracking) — it is the business's log, not a person's.

create table if not exists sales_calls (
  id            uuid primary key default gen_random_uuid(),
  call_date     date,
  name          text not null default '',
  source        text not null default '',          -- Ads / Outbound / Referral …
  pitch         text not null default '',          -- pricing / offer pitched
  call_minutes  integer,
  recording_url text not null default '',
  outcome       text not null default 'pending'
                check (outcome in ('won', 'lost', 'dq', 'na', 'pending')),
  emotions      text not null default '',
  conclusion    text not null default '',
  notes         text not null default '',
  contact       text not null default '',
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists sales_calls_date_idx on sales_calls (call_date);

-- Only the server (service role) reads or writes this table; with no policies,
-- the browser keys can't touch it.
alter table sales_calls enable row level security;

-- The pricing / pitches on offer right now. The Sales Tracker's "By pricing"
-- panel shows these by default; every pitch ever used stays in the calls.
create table if not exists sales_pitches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

alter table sales_pitches enable row level security;

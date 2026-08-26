-- Reporting Dashboard — Single Agency
-- Run this ONE file in: Supabase Dashboard > SQL Editor > New query
-- Creates all tables, columns, indexes, and triggers from scratch.
-- Safe to re-run (all statements use IF NOT EXISTS / CREATE OR REPLACE).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Profiles (team login)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id         uuid    primary key references auth.users(id) on delete cascade,
  is_admin   boolean not null default false,
  created_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Clients (lead sources or service lines)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists clients (
  id           uuid    primary key default gen_random_uuid(),
  name         text    not null unique,
  is_live      boolean not null default true,
  share_token  text,
  created_at   timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Agents (setters)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists agents (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null unique,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Events (all GHL events: dials, leads, bookings, shows, no-shows, callbacks)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists events (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    not null references clients(id) on delete cascade,
  event_type  text    not null,
  occurred_at timestamptz default now(),

  -- Call fields
  duration_seconds   int,
  is_pickup          boolean,
  is_conversation    boolean,
  speed_to_lead_seconds numeric,
  direction          text,       -- inbound | outbound
  call_status        text,       -- completed | voicemail | canceled | no_answer
  recording_url      text,
  call_summary       text,
  phone_number_used  text,

  -- Appointment fields
  scheduled_at   timestamptz,   -- when the appointment is scheduled for
  external_id    text,          -- GHL appointment ID — used to flip booked → show/no_show
  calendar_name  text,          -- GHL calendar name
  stage_booked   text,          -- e.g. "Day 1 AM"

  -- Lead identity
  lead_name   text,
  lead_phone  text,
  lead_email  text,

  -- Agent
  agent_name      text,
  ghl_contact_id  text,
  raw             jsonb,

  -- Closed deal
  revenue         numeric not null default 0,

  constraint events_event_type_check check (
    event_type in ('dial', 'lead', 'appointment_booked', 'show', 'no_show', 'callback_booked', 'closed')
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Ad Spend (daily Meta / Google / Local Services spend by client)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists ad_spend (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    not null references clients(id) on delete cascade,
  spend_date  date    not null,
  platform    text    not null,
  amount      numeric not null default 0,
  created_at  timestamptz default now(),
  constraint ad_spend_platform_check check (platform in ('meta', 'google', 'local_services')),
  unique(client_id, spend_date, platform)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Setter Availability (recurring weekly windows per agent)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists setter_availability (
  id          uuid    primary key default gen_random_uuid(),
  agent_id    uuid    not null references agents(id) on delete cascade,
  weekday     text    not null,   -- Monday | Tuesday | ... | Sunday
  time_start  text    not null,   -- HH:MM 24-hour
  time_end    text    not null,
  is_live     boolean not null default true,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Client Calling Windows (when each client/lead-source is dialled each week)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_calling_windows (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    not null references clients(id) on delete cascade,
  weekday     text    not null,
  time_slot_1 text,              -- HH:MM 24-hour
  time_slot_2 text,
  is_live     boolean not null default true,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Watch Schedule (manager assigns setters to specific dates + hours)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists watch_schedule (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references agents(id) on delete cascade,
  scheduled_date date not null,
  slot_hour      int  not null,   -- 8–20 (8am–8pm)
  created_at     timestamptz default now(),
  unique(agent_id, scheduled_date, slot_hour)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. PD Schedule (generated power dialer schedule from watch schedule)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists pd_schedule (
  id             uuid    primary key default gen_random_uuid(),
  client_id      uuid    not null references clients(id) on delete cascade,
  agent_id       uuid    references agents(id) on delete set null,
  scheduled_date date    not null,
  slot_time      text    not null,   -- HH:MM 24-hour
  status         text    not null default 'pending',  -- pending | done | skipped | no_setters
  notes          text,
  created_at     timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Indexes
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists events_client_occurred  on events(client_id, occurred_at desc);
create index if not exists events_type             on events(event_type);
create unique index if not exists events_external_id_unique on events(external_id) where external_id is not null;
create index if not exists events_agent_name_idx   on events(agent_name)   where agent_name is not null;
create index if not exists events_lead_phone_idx   on events(lead_phone)   where lead_phone is not null;
create index if not exists ad_spend_client_date    on ad_spend(client_id, spend_date desc);
create index if not exists watch_schedule_date     on watch_schedule(scheduled_date);
create index if not exists pd_schedule_date        on pd_schedule(scheduled_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Zip Performance (per-client, per-zip tracking)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists zip_performance (
  id           uuid    primary key default gen_random_uuid(),
  client_id    uuid    not null references clients(id) on delete cascade,
  zip_code     text    not null,
  leads        int     not null default 0,
  appointments int     not null default 0,
  shows        int     not null default 0,
  closes       int     not null default 0,
  revenue      numeric(12,2) not null default 0,
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(client_id, zip_code)
);

create index if not exists zip_perf_client on zip_performance(client_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Client Sessions (zip-tool territory sessions attached to a client — the
--     database record teammates share, vs. unattached prospecting sessions
--     which stay local to a browser via localStorage)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists client_sessions (
  id          uuid    primary key default gen_random_uuid(),
  client_id   uuid    references clients(id) on delete cascade,
  name        text    not null,
  pins        jsonb   not null default '[]'::jsonb,
  pin_counter int     not null default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists client_sessions_client on client_sessions(client_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Ad Campaigns (campaign/ad-set/ad level performance, fed by Make.com from
--     each platform's native ads reporting — see ccm-ad-campaigns.blueprint.json.
--     One row per client/date/platform/level/entity; level distinguishes which
--     tier of the hierarchy a row describes.)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists ad_campaigns (
  id             uuid    primary key default gen_random_uuid(),
  client_id      uuid    not null references clients(id) on delete cascade,
  report_date    date    not null,
  platform       text    not null,
  level          text    not null,
  campaign_id    text    not null,
  campaign_name  text    not null,
  adset_id       text    not null default '',
  adset_name     text,
  ad_id          text    not null default '',
  ad_name        text,
  status         text,
  objective      text,
  budget         numeric,
  spend          numeric not null default 0,
  impressions    integer not null default 0,
  reach          integer not null default 0,
  frequency      numeric,
  link_clicks    integer not null default 0,
  unique_clicks  integer,
  cpm            numeric,
  cpc            numeric,
  ctr            numeric,
  unique_ctr     numeric,
  leads          integer not null default 0,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  constraint ad_campaigns_platform_check check (platform in ('meta', 'google', 'local_services')),
  constraint ad_campaigns_level_check    check (level in ('campaign', 'adset', 'ad')),
  unique(client_id, report_date, platform, level, campaign_id, adset_id, ad_id)
);

create index if not exists ad_campaigns_client_date on ad_campaigns(client_id, report_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Ad Campaign Exclusions (per-client hidden campaigns -- ad accounts often carry
--     other agencies' or legacy campaigns alongside the ones actually run by the
--     agency. Opt-out list: absence of a row = included, so new daily syncs never
--     need to re-apply a hidden state on incoming rows.)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists ad_campaign_exclusions (
  client_id    uuid not null references clients(id) on delete cascade,
  campaign_id  text not null,
  created_at   timestamptz default now(),
  primary key (client_id, campaign_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security — every table blocks the public anon key by default (no
-- policies defined); the app only ever reads/writes via the service-role key
-- server-side, which bypasses RLS. Keeps a fresh install from being publicly
-- readable/writable the moment it's created.
-- ─────────────────────────────────────────────────────────────────────────────
alter table profiles               enable row level security;
alter table clients                enable row level security;
alter table agents                 enable row level security;
alter table events                 enable row level security;
alter table ad_spend               enable row level security;
alter table setter_availability    enable row level security;
alter table client_calling_windows enable row level security;
alter table watch_schedule         enable row level security;
alter table pd_schedule            enable row level security;
alter table zip_performance        enable row level security;
alter table client_sessions        enable row level security;
alter table ad_campaigns           enable row level security;
alter table ad_campaign_exclusions enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. B2B Events (intros, sales calls, closes, cash collected — single campaign)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists b2b_events (
  id              uuid    primary key default gen_random_uuid(),
  event_type      text    not null,
  occurred_at     timestamptz default now(),
  lead_name       text,
  lead_phone      text,
  lead_email      text,
  ghl_contact_id  text,
  external_id     text,
  revenue         numeric not null default 0,
  raw             jsonb,
  constraint b2b_events_event_type_check check (
    event_type in ('lead', 'intro_booked', 'intro_shown', 'sales_call_booked', 'sales_call_shown', 'close')
  )
);

create unique index if not exists b2b_events_external_id_unique
  on b2b_events(external_id) where external_id is not null;

create index if not exists b2b_events_type_date on b2b_events(event_type, occurred_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. B2B Ad Spend (daily Meta / Google spend for the B2B campaign)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists b2b_ad_spend (
  id          uuid    primary key default gen_random_uuid(),
  spend_date  date    not null,
  platform    text    not null,
  amount      numeric not null default 0,
  created_at  timestamptz default now(),
  constraint b2b_ad_spend_platform_check check (platform in ('meta', 'google', 'local_services')),
  unique(spend_date, platform)
);

create index if not exists b2b_ad_spend_date on b2b_ad_spend(spend_date desc);

alter table b2b_events    enable row level security;
alter table b2b_ad_spend  enable row level security;

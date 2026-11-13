-- Funnels (Tomsi Media > Funnels, NOTES.md 2026-11-13): the website funnel's
-- versions and what each one produced.
--
-- A funnel is a page on the website (slug = its path). Each version is one
-- saved state of what the page says; one or more are live at a time (more than
-- one = a split test, shared out by weight). Every visitor step is recorded
-- against the version they saw, once per person.
--
-- Additive only: three new tables, nothing existing is changed.

create table if not exists funnels (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,                              -- 'check-your-market'
  name       text not null,
  client_id  uuid references clients(id) on delete set null,    -- null = Tomsi Media's own funnel
  site_url   text,                                              -- where it is served
  created_at timestamptz not null default now()
);

create table if not exists funnel_versions (
  id           uuid primary key default gen_random_uuid(),
  funnel_id    uuid not null references funnels(id) on delete cascade,
  number       int  not null,
  name         text not null default '',
  notes        text not null default '',
  content      jsonb not null default '{}'::jsonb,              -- src/lib/funnel-content.ts
  status       text not null default 'draft' check (status in ('draft', 'live', 'paused', 'archived')),
  weight       int  not null default 100 check (weight between 0 and 100),  -- share of traffic among the live versions
  published_at timestamptz,                                     -- first time it went live; set = content is locked
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (funnel_id, number)
);
create index if not exists funnel_versions_live_idx on funnel_versions (funnel_id, status);

create table if not exists funnel_events (
  id             uuid primary key default gen_random_uuid(),
  funnel_id      uuid not null references funnels(id) on delete cascade,
  version_id     uuid not null references funnel_versions(id) on delete cascade,
  visitor_id     text not null,                                 -- anonymous id kept in the visitor's browser
  event_type     text not null check (event_type in ('visit', 'step', 'disqualified', 'lead', 'calendar', 'booked')),
  step           int  not null default 0,                       -- which question, for 'step' / 'disqualified'
  ghl_contact_id text,                                          -- on 'lead': ties the version to demos, shows and closes
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_content    text,
  utm_term       text,
  occurred_at    timestamptz not null default now(),
  unique (version_id, visitor_id, event_type, step)             -- one of each per person
);
create index if not exists funnel_events_funnel_time_idx on funnel_events (funnel_id, occurred_at);
create index if not exists funnel_events_contact_idx on funnel_events (ghl_contact_id) where ghl_contact_id is not null;

alter table funnels         enable row level security;
alter table funnel_versions enable row level security;
alter table funnel_events   enable row level security;

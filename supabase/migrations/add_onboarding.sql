-- Onboarding board (Clients > Onboarding, NOTES.md 2026-11-12).
--
-- One card per client being onboarded. `items` is the card's own copy of the
-- checklist (taken from the Facebook or SMS template when the service is
-- picked), so editing a template never rewrites a card that is under way.
create table if not exists onboarding_cards (
  id             uuid primary key default gen_random_uuid(),
  client_name    text not null,
  client_id      uuid references clients(id) on delete set null,   -- the Client Roster record, once added
  track          text check (track in ('facebook', 'sms')),        -- null = not picked yet
  stage          text not null default 'not_started' check (stage in ('not_started', 'in_progress', 'done')),
  position       double precision not null default 0,              -- order inside its column
  items          jsonb not null default '[]'::jsonb,
  notes          text,
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  ghl_contact_id text,                                             -- set when the GHL onboarding form made the card
  source         text not null default 'manual',                   -- manual | ghl_form
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index if not exists onboarding_cards_stage_idx on onboarding_cards (stage, position);

-- The two checklists. No row = the built-in list in src/lib/onboarding.ts.
create table if not exists onboarding_templates (
  track      text primary key check (track in ('facebook', 'sms')),
  items      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table onboarding_cards     enable row level security;
alter table onboarding_templates enable row level security;

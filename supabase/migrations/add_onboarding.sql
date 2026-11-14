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

-- New client survey (NOTES.md 2026-11-12): one set of answers per roster client.
-- Never holds card details — cards go on file through Stripe's own page.
create table if not exists client_surveys (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null unique references clients(id) on delete cascade,
  answers           jsonb not null default '{}'::jsonb,
  submitted_by      uuid,
  submitted_by_name text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table client_surveys enable row level security;

-- Card vault (NOTES.md 2026-11-14): a client's card, encrypted by the app
-- before it gets here. The key is in the server's environment, never in this
-- database — these rows are unreadable on their own. Only brand + last four
-- are kept readable. Read lib/card-vault.ts before touching this.
create table if not exists card_vault (
  client_id     uuid primary key references clients(id) on delete cascade,
  ciphertext    text not null,
  iv            text not null,
  tag           text not null,
  key_version   integer not null default 1,
  brand         text,
  last4         text,
  saved_by      uuid,
  saved_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Every save, view, refused attempt and removal. Outlives the card and the client.
create table if not exists card_vault_log (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid,
  client_name text,
  user_id     uuid,
  user_name   text,
  action      text not null check (action in ('saved', 'replaced', 'revealed', 'denied', 'deleted')),
  at          timestamptz not null default now()
);
create index if not exists card_vault_log_client_idx on card_vault_log (client_id, at desc);
create index if not exists card_vault_log_user_idx on card_vault_log (user_id, at desc);

-- Server only: row security on with no policy, and the browser-facing roles
-- lose their table rights as well.
alter table card_vault     enable row level security;
alter table card_vault_log enable row level security;
revoke all on card_vault, card_vault_log from anon, authenticated;

-- Card vault, second layer (NOTES.md 2026-11-14): the vault password. Cards are
-- locked in the browser with public_key; the private key is here locked with a
-- password that is stored nowhere, and locked again with the server key.
create table if not exists card_vault_keys (
  id              smallint primary key default 1 check (id = 1),   -- there is one vault
  public_key      text not null,
  ciphertext      text not null,
  iv              text not null,
  tag             text not null,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table card_vault_keys enable row level security;
revoke all on card_vault_keys from anon, authenticated;

-- The log also records the vault password being set and changed.
alter table card_vault_log drop constraint if exists card_vault_log_action_check;
alter table card_vault_log add constraint card_vault_log_action_check
  check (action in ('saved', 'replaced', 'revealed', 'denied', 'deleted', 'vault_set', 'password_changed'));

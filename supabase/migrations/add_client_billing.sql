-- Client Billing — Payments tab
-- Additive only: four new tables. Nothing existing is touched.
--
-- Tracks, per Client Roster client, which appointments have been charged and
-- which have been credited, the charges made (through Stripe or recorded by
-- hand) and the credit each client holds against their next charge.
--
--   credit balance = credits on appointments + credits added by hand
--                  − credit used on charges that were not cancelled

-- Per-client billing settings.
create table if not exists billing_clients (
  client_id             uuid primary key references clients(id) on delete cascade,
  price_per_appointment numeric not null default 0,
  stripe_customer_id    text,
  updated_at            timestamptz not null default now()
);

-- One row per charge: a batch of appointments, or a one-off amount.
-- Billing history outlives the roster record, so the client's name is kept.
create table if not exists billing_charges (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid references clients(id) on delete set null,
  client_name        text not null default '',
  kind               text not null check (kind in ('appointments', 'custom')),
  description        text not null default '',
  appointment_count  integer not null default 0,
  subtotal           numeric not null default 0,   -- before credit
  credit_applied     numeric not null default 0,   -- credit used on this charge
  total              numeric not null default 0,   -- what the client pays
  method             text not null check (method in ('card', 'invoice', 'manual')),
  status             text not null check (status in ('draft', 'pending', 'paid', 'failed', 'void')),
  stripe_customer_id text,
  stripe_invoice_id  text,
  stripe_invoice_url text,
  error              text,
  request_id         text unique,                  -- one per confirm dialog: a double click can't charge twice
  created_by         uuid,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create index if not exists billing_charges_client_idx on billing_charges (client_id, created_at desc);

-- One row per appointment that has been charged or credited. event_id is the
-- appointment's row in `events`; unique, so an appointment is never charged twice.
-- No foreign key on purpose: the record survives the event being removed.
create table if not exists billing_appointments (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references clients(id) on delete set null,
  event_id       uuid not null unique,
  lead_name      text,
  appointment_at timestamptz,
  charge_id      uuid references billing_charges(id) on delete set null,  -- null = never charged
  price          numeric not null default 0,
  credited_at    timestamptz,                      -- set = credited
  credit_amount  numeric not null default 0,       -- what the credit gave back (0 if it was never charged)
  credit_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists billing_appointments_client_idx on billing_appointments (client_id);
create index if not exists billing_appointments_charge_idx on billing_appointments (charge_id);

-- Credit added by hand, not tied to an appointment.
create table if not exists billing_credits (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references clients(id) on delete set null,
  amount     numeric not null,
  reason     text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists billing_credits_client_idx on billing_credits (client_id);

-- Only the server (service role) reads or writes these tables; with no
-- policies, the browser keys can't touch them.
alter table billing_clients      enable row level security;
alter table billing_charges      enable row level security;
alter table billing_appointments enable row level security;
alter table billing_credits      enable row level security;

-- Profit and Loss — client details
-- Additive only: one new table, scoped per user. Nothing existing is touched.
--
-- A payment line (pnl_lines, kind 'revenue') names its client in `label`. This
-- table holds what we know about that client beyond the name. The two are tied
-- by `name_key` — the name lower-cased and trimmed — so renaming a client means
-- renaming its lines too, which the API does in the same request.

create table if not exists pnl_clients (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name_key     text not null,
  name         text not null,
  contact_name text,
  company      text,
  email        text,
  phone        text,
  website      text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, name_key)
);

-- Only the server (service role) reads or writes this table.
alter table pnl_clients enable row level security;

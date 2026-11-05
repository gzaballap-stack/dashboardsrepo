-- Profit and Loss — expenses that come back every month
-- Additive only: one new table, scoped per user. Nothing existing is touched.
--
-- One row per repeating expense name (rent, groceries, GHL…). The page offers
-- each one blank on every month until an amount is typed; the month's line is
-- an ordinary pnl_lines row. Removing a row here stops the offer; past months
-- keep their lines.

create table if not exists pnl_recurring (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('expense', 'personal')),
  label      text not null,
  label_key  text not null,                       -- label lower-cased, for the unique rule
  leisure    boolean not null default false,      -- personal only
  created_at timestamptz not null default now(),
  unique (user_id, kind, label_key)
);

-- Only the server (service role) reads or writes this table.
alter table pnl_recurring enable row level security;

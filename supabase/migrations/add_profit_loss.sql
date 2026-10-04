-- Profit and Loss — Tools tab
-- Additive only: one new table, scoped per user. Nothing existing is touched.
--
-- One row per line of a month's sheet: a client payment (revenue), a business
-- cost (expense) or a personal cost (personal, split necessary / leisure).
-- Profit is revenue − expenses; personal spending is tracked beside it and
-- never subtracted.

create table if not exists pnl_lines (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  month      date not null,                       -- first day of the month
  kind       text not null check (kind in ('revenue', 'expense', 'personal')),
  label      text not null default '',
  amount     numeric not null default 0,
  leisure    boolean not null default false,      -- personal only: leisure vs necessary
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pnl_lines_user_month_idx on pnl_lines (user_id, month);

-- Only the server (service role) reads or writes this table; with no policies,
-- the browser keys can't touch it.
alter table pnl_lines enable row level security;

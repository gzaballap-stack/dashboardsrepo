-- ABCDE Task Board ("Eat the Frog") — Tools tab
-- Additive only: creates one new table. Nothing existing is touched.

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  notes        text,
  bucket       text not null default 'A',            -- A | B | C | D | E
  priority     int  not null default 1,              -- 1..3 (A1/A2/A3); ignored outside A
  position     double precision not null default 0,  -- ordering within a column
  done         boolean not null default false,
  due_date     date,
  delegate_to  text,                                 -- who/what it's handed to (bucket D)
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_user_idx on tasks (user_id, bucket, position);

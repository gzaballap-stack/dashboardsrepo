-- Lifting Tracker — Tools tab
-- Additive only: two new tables, both scoped per user. Nothing existing is touched.

create table if not exists lift_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  exercises   jsonb not null default '["Incline DB Press","Lat Pulldown Row","Bicep Curl","Tricep Extension","Shoulder Press"]'::jsonb,
  unit        text  not null default 'kg',        -- kg | lb
  length_unit text  not null default 'cm',        -- cm | in
  goal_note   text,
  share_token text unique,                        -- read-only export link, null = sharing off
  updated_at  timestamptz not null default now()
);

create table if not exists lift_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,                       -- Monday of the tracked week
  weight_1   numeric,
  weight_2   numeric,
  weight_3   numeric,
  waist      numeric,
  bicep      numeric,
  lifts      jsonb not null default '{}'::jsonb,  -- { "Bicep Curl": { "load": 14, "reps": 8 }, ... }
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create index if not exists lift_entries_user_week_idx on lift_entries (user_id, week_start);
create index if not exists lift_settings_share_idx on lift_settings (share_token) where share_token is not null;

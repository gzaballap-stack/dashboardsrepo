-- Whoop — Health Tracker connection.
-- Additive only: two new tables, both scoped per user. Nothing existing is touched.

-- One Whoop login per account. Tokens are secrets: read server-side only, never
-- returned to the browser. Refresh tokens rotate on every use, so the row is
-- rewritten each time one is spent.
create table if not exists whoop_connections (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  whoop_user_id   text,
  access_token    text not null,
  refresh_token   text not null,
  expires_at      timestamptz not null,
  scopes          text,
  connected_at    timestamptz not null default now(),
  last_synced_at  timestamptz,
  sync_started_at timestamptz,               -- a lock: two syncs at once would race the rotating refresh token
  last_error      text,
  updated_at      timestamptz not null default now()
);

-- One row per Whoop "day". A Whoop day runs from the moment you wake to the
-- next time you wake, so `day` is the morning you got up, and last night's
-- sleep sits on it.
create table if not exists whoop_days (
  user_id            uuid not null references auth.users(id) on delete cascade,
  day                date not null,
  cycle_id           text,
  recovery_score     numeric,                 -- 0–100
  hrv_ms             numeric,
  resting_hr         numeric,
  spo2               numeric,
  skin_temp_c        numeric,
  sleep_hours        numeric,                 -- main sleep, time actually asleep
  nap_hours          numeric,
  sleep_performance  numeric,                 -- 0–100
  sleep_efficiency   numeric,
  sleep_consistency  numeric,
  respiratory_rate   numeric,
  sleep_stages       jsonb,                   -- { light, deep, rem, awake } in hours
  strain             numeric,                 -- 0–21
  kilojoules         numeric,
  avg_hr             numeric,
  max_hr             numeric,
  workouts           jsonb not null default '[]'::jsonb,
  scored             boolean not null default true,   -- false while Whoop is still scoring the day
  synced_at          timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists whoop_days_user_day_idx on whoop_days (user_id, day desc);

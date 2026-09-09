-- Calendar tab: private Google Calendar iCal feeds, one or more per user.
-- The URL is a secret and is only ever read server-side.
-- Additive only.

create table if not exists calendar_feeds (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text,
  url         text not null,
  created_at  timestamptz not null default now(),
  last_error  text,
  last_synced timestamptz
);

create index if not exists calendar_feeds_user_idx on calendar_feeds (user_id);

-- Creative & Copy Hub: one record per creative (keyed on the same pooled name the
-- creative leaderboard uses), holding what Meta can't tell us — the prompt, the
-- script, what's in the background — plus a cache of what Meta did return for
-- each ad so the copy survives the ad being deleted.
-- Additive only.

create table if not exists creative_hub_entries (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('b2b', 'b2c')),
  pool_key         text not null,           -- lib/creative-key.ts creativeKey(name)
  name             text not null,           -- the name used on the ad
  kind             text,                    -- UGC video / Voiceover video / Talking head / AI image …
  campaign_label   text,                    -- free label, e.g. "Campaign V1"
  launch_date      date,                    -- manual; for work that predates the spend data
  headline         text,                    -- overrides the copy pulled from Meta when set
  primary_text     text,
  prompt           text,                    -- the generation prompt
  script           text,                    -- talking-head / voiceover script
  background_notes text,                    -- what's in the background of a talking head
  notes            text,
  media_url        text,                    -- link to the source file (Drive, Frame.io …)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (scope, pool_key)
);

create table if not exists creative_hub_meta (
  ad_id         text primary key,
  ad_name       text,
  status        text,
  created_time  timestamptz,
  format        text,                       -- Video / Image / Carousel
  headline      text,
  primary_text  text,
  description   text,
  preview_link  text,
  thumbnail_url text,
  image_url     text,
  video_id      text,
  video_url     text,                       -- Meta CDN link; expires, refreshed with the row
  video_length  numeric,
  error         text,                       -- why Meta refused this ad, when it did
  fetched_at    timestamptz not null default now()
);

alter table creative_hub_entries enable row level security;
alter table creative_hub_meta    enable row level security;

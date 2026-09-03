-- Per-zip creative attribution.
--
-- The zip Performance view can source its numbers from two places: a live rollup
-- of the client's own events (real data, V1) or the seeded `zip_performance`
-- table (demo data, V2). The events rollup carries ad attribution on each row,
-- so its creative breakdown comes for free — but `zip_performance` is a single
-- aggregate row per zip with nowhere to record which ad produced what.
--
-- This table fills that gap: one row per zip / metric / ad, whose counts sum
-- back to the matching `zip_performance` figures. `/api/zip-attribution` prefers
-- these rows when present and falls back to the live event breakdown otherwise,
-- so environments without this table (V1) behave exactly as before.

create table if not exists zip_creative_attribution (
  id            uuid    primary key default gen_random_uuid(),
  client_id     uuid    not null references clients(id) on delete cascade,
  zip_code      text    not null,
  metric        text    not null,   -- leads | appointments | shows | closes

  ad_platform   text,
  campaign_id   text,
  campaign_name text,
  adset_id      text,
  adset_name    text,
  ad_id         text,
  ad_name       text,

  count         int     not null default 0,
  revenue       numeric not null default 0,

  created_at    timestamptz default now(),

  constraint zip_creative_attribution_metric_check
    check (metric in ('leads', 'appointments', 'shows', 'closes')),
  constraint zip_creative_attribution_unique
    unique (client_id, zip_code, metric, ad_id)
);

create index if not exists zip_creative_attribution_lookup_idx
  on zip_creative_attribution (client_id, zip_code, metric);

-- RLS on, zero policies: reads go through API routes on the service-role key,
-- which bypasses RLS. The anon key gets nothing. Same pattern as every other
-- table in this schema.
alter table zip_creative_attribution enable row level security;

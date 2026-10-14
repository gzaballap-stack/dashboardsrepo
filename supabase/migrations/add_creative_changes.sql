-- Creative & Copy Hub: a log of the changes made to the ads (paused X, raised
-- budget, new hook…), dated, optionally tied to one creative or one campaign,
-- shown on the timeline. Additive only.
create table if not exists creative_hub_changes (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('b2b', 'b2c')),
  happened_on  date not null,
  note         text not null,
  entry_id     uuid references creative_hub_entries(id) on delete set null,
  campaign_id  text,
  created_at   timestamptz not null default now()
);
create index if not exists creative_hub_changes_scope_idx on creative_hub_changes (scope, happened_on);
alter table creative_hub_changes enable row level security;

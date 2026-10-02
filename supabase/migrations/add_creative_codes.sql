-- Creative & Copy Hub: a short code per creative (e.g. AI-007, UGC-002) and
-- free-form tags for the angle / offer / style, so creatives can be filed and
-- compared independently of how the ad happens to be named in Meta.
-- Additive only.

alter table creative_hub_entries add column if not exists code text;
alter table creative_hub_entries add column if not exists tags text;

create unique index if not exists creative_hub_entries_code_idx
  on creative_hub_entries (scope, lower(code)) where code is not null;

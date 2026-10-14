-- Creative & Copy Hub: copy sets. One set = the texts an ad (or an Advantage+
-- creative) rotates through — up to five primary texts, headlines and
-- descriptions — kept per campaign so a combination can be reused or compared.
-- Additive only.

create table if not exists creative_hub_copy_sets (
  id             uuid primary key default gen_random_uuid(),
  scope          text not null check (scope in ('b2b', 'b2c')),
  name           text not null,
  campaign_label text,
  notes          text,
  bodies         jsonb not null default '[]'::jsonb,   -- primary texts, in order
  headlines      jsonb not null default '[]'::jsonb,
  descriptions   jsonb not null default '[]'::jsonb,
  cta            text,                                 -- e.g. LEARN_MORE
  link           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists creative_hub_copy_sets_scope_idx on creative_hub_copy_sets (scope);
alter table creative_hub_copy_sets enable row level security;

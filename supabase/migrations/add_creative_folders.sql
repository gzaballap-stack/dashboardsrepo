-- Creative & Copy Hub: categories and folders.
-- A creative is filed under a category (AI image, talking head, UGC, voiceover)
-- and optionally a folder inside it (AI image › Slop). Its code is derived from
-- that position — AI/SLOP/001 — and renumbered when it moves. Ads are bound to
-- their creative by id in creative_hub_links, so renaming or recoding never
-- loses an ad's history.
-- Additive only.

create table if not exists creative_hub_folders (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('b2b', 'b2c')),
  category    text not null,              -- AI | TH | UGC | VO (lib/creative-key.ts CATEGORIES)
  name        text not null,              -- "Slop"
  slug        text not null,              -- "SLOP" — the part that goes in the code; never changes
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (scope, category, slug)
);

alter table creative_hub_entries add column if not exists category  text;
alter table creative_hub_entries add column if not exists folder_id uuid references creative_hub_folders(id) on delete set null;
alter table creative_hub_entries add column if not exists seq       integer;

create table if not exists creative_hub_links (
  ad_id      text primary key,
  entry_id   uuid not null references creative_hub_entries(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists creative_hub_links_entry_idx on creative_hub_links (entry_id);

alter table creative_hub_folders enable row level security;
alter table creative_hub_links   enable row level security;
